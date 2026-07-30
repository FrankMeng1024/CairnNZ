/**
 * Auth routes — Sprint 40 rebuild
 *
 * POST /api/auth/register        — submit form → send verification code
 * POST /api/auth/verify          — submit 6-digit code → create real user + JWT
 * POST /api/auth/resend          — resend code (rate limited)
 * POST /api/auth/login           — email + password
 * POST /api/auth/google          — Google id_token
 * GET  /api/auth/me              — get current user (protected)
 * PATCH /api/auth/password       — set/change password (protected)
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const TokenBlacklist = require('../models/TokenBlacklist');
const PasswordReset = require('../models/PasswordReset');
const { signToken } = require('../config/jwt');
const authenticate = require('../middleware/authenticate');
const {
  sendVerificationCode,
  sendPasswordResetCode,
  sendAccountDeletionConfirmation,
} = require('../services/emailService');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  // Sprint 6 round-11 R11B5: IPv6-safe keyGenerator. Without this,
  // v7+ warns ERR_ERL_KEY_GEN_IPV6 and buckets all users of a carrier
  // /64 together — either global lockout or trivial bypass.
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  message: { error: 'Too many attempts. Please wait 15 minutes.' },
});

// OAuth tokens are short-lived and already validated by Google — brute-force not applicable.
// Higher limit so dev testing doesn't hit the wall.
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  message: { error: 'Too many requests. Please try again shortly.' },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 1000, max: 2,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  message: { error: 'Please wait before requesting another code.' },
});

// Sprint 6 round-14 R14B2 fix: /password-reset/request needs uniform
// response timing regardless of branch (rate-limited, validation-fail,
// 500, success, non-existent email). Custom rate limiter that returns
// the SAME 200 body + 250ms floor so an attacker can't distinguish
// "authLimiter 429" from "real 200" by timing or body.
const resetRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => ipKeyGenerator(req, res),
  handler: async (req, res) => {
    await new Promise(r => setTimeout(r, 250));
    return res.json({ message: 'If an account exists for this email, a code has been sent.' });
  },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// O18 AUTH-06: returns whole-year age (birthday-aware) or null if the
// input is not a parseable date.
function ageInYears(isoDate) {
  if (!isoDate) return null;
  const dob = new Date(isoDate);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1;
  return age;
}

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', authLimiter, validateBody(schemas.auth.register), async (req, res) => {
  const { name, email, password, dateOfBirth } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 1)
    return res.status(400).json({ error: 'Name is required.' });
  if (name.trim().length > 100)
    return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
  if (!email || !validateEmail(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!validatePassword(password))
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  // O18 AUTH-06: enforce age >= 13 (COPPA + App Store).
  const age = ageInYears(dateOfBirth);
  if (age === null) return res.status(400).json({ error: 'Please enter a valid date of birth.' });
  if (age < 13) return res.status(400).json({ error: 'Cairn is only available for people aged 13 and up.', hint: 'age_gate' });

  const normalEmail = email.toLowerCase().trim();

  try {
    const existing = await User.findByEmail(normalEmail);
    if (existing) {
      // Check if they signed up via OAuth (no password)
      const providers = await User.getUserProviders(existing.id);
      if (providers.length > 0 && !existing.password_hash) {
        return res.status(409).json({
          error: `This email is linked to a ${providers[0]} account. Sign in with ${providers[0]}, then add a password in Settings if needed.`,
          hint: 'use_oauth',
          provider: providers[0],
        });
      }
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    const passwordHash = await User.hashPassword(password);
    // Store DOB in pending so verify step carries it to the real users row.
    const code = await User.upsertPending(normalEmail, name.trim(), passwordHash, dateOfBirth);

    // Send email (non-blocking — don't fail registration if email fails)
    sendVerificationCode(normalEmail, name.trim(), code).catch(err =>
      console.error('[email] failed to send verification code:', err.message)
    );

    // DEV MODE: return code in response so dev can test without email setup
    const devPayload = process.env.NODE_ENV !== 'production' ? { dev_code: code } : {};
    return res.status(200).json({ message: 'Verification code sent.', email: normalEmail, ...devPayload });
  } catch (err) {
    console.error('[register]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/verify ──────────────────────────────────────────────────
router.post('/verify', authLimiter, validateBody(schemas.auth.verify), async (req, res) => {
  const { email, code } = req.body;

  if (!email || !code)
    return res.status(400).json({ error: 'Email and code are required.' });

  const normalEmail = email.toLowerCase().trim();

  try {
    const pending = await User.findPending(normalEmail);

    if (!pending)
      return res.status(400).json({ error: 'No pending registration found. Please register again.' });

    // Expired
    if (new Date() > new Date(pending.expires_at)) {
      await User.deletePending(normalEmail);
      return res.status(400).json({ error: 'This code has expired. Please register again.', hint: 'expired' });
    }

    // Sprint 6 review B1 fix: compare the code BEFORE the too-many-attempts
    // gate so a legit user who typed a wrong digit on attempt 4 can still
    // successfully verify on attempt 5. Pre-fix, the `>= 5` guard fired
    // BEFORE the compare, wiping the pending row and locking out even the
    // correct code.
    const codeMatches = String(pending.code) === String(code).trim();

    // Wrong code path (increment + check attempts)
    if (!codeMatches) {
      await User.incrementPendingAttempts(normalEmail);
      const nextAttempts = (pending.attempts || 0) + 1;
      if (nextAttempts >= 5) {
        await User.deletePending(normalEmail);
        return res.status(400).json({ error: 'Too many incorrect attempts. Please register again.', hint: 'locked' });
      }
      const remaining = 5 - nextAttempts;
      return res.status(400).json({ error: `Incorrect code. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.` });
    }

    // Check if real user appeared in the meantime (e.g. Google OAuth raced)
    const existingUser = await User.findByEmail(normalEmail);
    if (existingUser) {
      await User.deletePending(normalEmail);
      return res.status(409).json({
        error: 'This email was registered via Google Sign In while you were verifying. Please sign in with Google.',
        hint: 'use_oauth',
        provider: 'google',
      });
    }

    // All good — create real user (with DOB carried over from pending row).
    const userId = await User.createUser(pending.name, normalEmail, pending.password_hash, pending.date_of_birth);
    await User.deletePending(normalEmail);

    const user = await User.findById(userId);
    const publicUser = User.toPublic(user);
    // Sprint 6 round-44 R44B5: include token_version in every issued
    // token so future mass-revoke (bumpTokenVersion on password change /
    // restore) invalidates ONLY tokens whose baseline is older than the
    // bumped version. Missing claim defaults to 0 in authenticate.js,
    // which used to work by accident — but explicit inclusion is
    // future-proof and consistent with R15B2/R16F7 password paths.
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      token_version: Number(user.token_version || 0),
    });

    return res.status(201).json({ user: publicUser, token });
  } catch (err) {
    console.error('[verify]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/resend ──────────────────────────────────────────────────
router.post('/resend', resendLimiter, validateBody(schemas.auth.resend), async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  const normalEmail = email.toLowerCase().trim();

  try {
    const pending = await User.findPending(normalEmail);
    if (!pending)
      return res.status(400).json({ error: 'No pending registration found. Please register again.' });

    // Issue new code
    // Sprint 6 round-4 review R4B1 fix: pass through the existing DOB
    // when issuing a fresh code. Pre-fix, resend upserted with
    // dateOfBirth=undefined → normalizeDob → NULL → verify created the
    // user with no DOB → legacy-backfill modal fires on next login AND
    // the age-gate the user just passed at register is silently
    // discarded.
    const code = await User.upsertPending(normalEmail, pending.name, pending.password_hash, pending.date_of_birth);
    sendVerificationCode(normalEmail, pending.name, code).catch(err =>
      console.error('[email] resend failed:', err.message)
    );

    return res.json({ message: 'New code sent.' });
  } catch (err) {
    console.error('[resend]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', authLimiter, validateBody(schemas.auth.login), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password are required.' });

  try {
    const user = await User.findByEmail(email.toLowerCase().trim());

    if (!user) {
      await User.comparePassword(password, '$2a$12$invalid_hash_to_waste_time_only');
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    // OAuth-only account — no password set
    if (!user.password_hash) {
      const providers = await User.getUserProviders(user.id);
      return res.status(401).json({
        error: `This account uses ${providers[0] || 'social'} sign in. Please use the social login button.`,
        hint: 'use_oauth',
        provider: providers[0] || null,
      });
    }

    const match = await User.comparePassword(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    // O18 AUTH-01: soft-deleted account — return 200 with pending_deletion hint
    // so client can show restore modal. Token still issued so restore endpoint
    // can authenticate the caller.
    const publicUser = User.toPublic(user);
    // Sprint 6 round-44 R44B5: include token_version — see /verify above.
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      token_version: Number(user.token_version || 0),
    });

    if (user.deleted_at) {
      const deletedAt = new Date(user.deleted_at);
      const restoreDeadline = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return res.json({
        user: publicUser,
        token,
        hint: 'pending_deletion',
        restore_deadline: restoreDeadline.toISOString(),
      });
    }

    return res.json({ user: publicUser, token });
  } catch (err) {
    console.error('[login]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/google ──────────────────────────────────────────────────
router.post('/google', oauthLimiter, validateBody(schemas.auth.google), async (req, res) => {
  const { id_token } = req.body;
  if (!id_token)
    return res.status(400).json({ error: 'id_token is required.' });

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email)
      return res.status(401).json({ error: 'Invalid Google token.' });

    // Sprint 6 round-33 R33B7: reject tokens where email_verified !== true.
    // Pre-fix, we matched an existing Cairn account by email alone. A
    // Google Workspace admin can set arbitrary email aliases on their
    // tenant; a malicious admin creates victim@gmail.com as an alias,
    // gets a Google id_token with that email (verified=false in the
    // token), and our findByEmail returns the victim's Cairn account.
    // linkOAuth then silently attaches the attacker's googleSub to the
    // victim's account → attacker signs in as victim forever via Google.
    // This is the classic "Sign in with Google" account-takeover CVE
    // pattern (Microsoft/Auth0 2021 advisories). Google sets
    // email_verified=true only for real gmail.com addresses and for
    // Workspace domains that the admin has proven ownership of via DNS;
    // aliases and unverified addresses get email_verified=false.
    if (payload.email_verified !== true) {
      return res.status(401).json({
        error: 'Google account email is not verified. Please verify your email with Google first.',
      });
    }

    const email = payload.email.toLowerCase();
    const name = payload.name || payload.email.split('@')[0];
    const googleSub = payload.sub;

    // Delete any pending registration for this email (it becomes void)
    await User.deletePending(email);

    // Find existing user by email or by google oauth link
    let user = await User.findByEmail(email);

    if (!user) {
      // Check if already linked via provider_id (different email scenario)
      const oauthRow = await User.findOAuth('google', googleSub);
      if (oauthRow) {
        user = await User.findById(oauthRow.user_id);
      }
    }

    if (!user) {
      // New user — create
      const userId = await User.createOAuthUser(name, email);
      await User.linkOAuth(userId, 'google', googleSub);
      user = await User.findById(userId);
    } else {
      // Existing user — ensure OAuth link exists (first time Google login on password account)
      await User.linkOAuth(user.id, 'google', googleSub);
    }

    const publicUser = User.toPublic(user);
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      // Sprint 6 R44B5: include token_version — see /verify above.
      token_version: Number(user.token_version || 0),
    });

    // O18 AUTH-01: soft-deleted account — same restore-modal hint as /login.
    if (user.deleted_at) {
      const deletedAt = new Date(user.deleted_at);
      const restoreDeadline = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return res.json({
        user: publicUser,
        token,
        hint: 'pending_deletion',
        restore_deadline: restoreDeadline.toISOString(),
      });
    }

    return res.json({ user: publicUser, token });
  } catch (err) {
    console.error('[google]', err);
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// ── POST /api/auth/apple (O18 batch 6.6 AUTH-02) ──────────────────────────
// Sign in with Apple. Client sends the identity_token returned by
// expo-apple-authentication. Server verifies signature against Apple's
// JWKS + audience matches our bundle ID, then upserts a users row + links
// via user_oauth (provider='apple'). First-time signup gets name from
// `name` in the request body (client-supplied — Apple only sends it once,
// on very first authorize).
router.post('/apple', oauthLimiter, validateBody(schemas.auth.apple), async (req, res) => {
  const { identity_token, name: providedName, raw_nonce } = req.body || {};
  if (!identity_token) return res.status(400).json({ error: 'identity_token is required.' });
  const audience = process.env.APPLE_BUNDLE_ID || process.env.APPLE_CLIENT_ID;
  if (!audience) {
    console.error('[apple] APPLE_BUNDLE_ID env not set');
    return res.status(500).json({ error: 'Apple sign-in not configured on server.' });
  }
  try {
    const { verifyAppleIdentityToken } = require('../services/appleAuth');
    const payload = await verifyAppleIdentityToken(identity_token, audience);
    if (!payload || !payload.sub) return res.status(401).json({ error: 'Invalid Apple token.' });

    // Sprint 6 review C7 fix: verify nonce to prevent identity_token replay
    // attacks. Client generated a random rawNonce, hashed it (SHA-256), and
    // sent the hash to Apple. Apple echoed the HASH in the JWT's `nonce`
    // claim. We hash the raw_nonce the client sent and compare — mismatch
    // means someone is replaying a token they intercepted.
    if (raw_nonce) {
      const crypto = require('crypto');
      const expected = crypto.createHash('sha256').update(String(raw_nonce)).digest('hex');
      // Apple returns nonce as HEX in the JWT claim (per Apple docs).
      // Case-insensitive compare for safety.
      if (!payload.nonce || String(payload.nonce).toLowerCase() !== expected.toLowerCase()) {
        console.warn('[apple] nonce mismatch — potential replay attack');
        return res.status(401).json({ error: 'Apple sign-in failed. Please try again.', hint: 'nonce_mismatch' });
      }
    } else {
      // No raw_nonce sent by client — accept for backward compat with pre-C7
      // TestFlight builds, but log a warning. Remove this allow-list once
      // the C7-fixed client is the only one in circulation.
      console.warn('[apple] no raw_nonce sent by client (pre-C7 build?)');
    }
    // Apple's `sub` is a stable per-user, per-app hash. Email is present
    // only on the first authorize (or when the user consents to share it).
    const appleSub = payload.sub;
    const email = (payload.email || '').toLowerCase();
    const emailVerified = payload.email_verified === true || payload.email_verified === 'true';
    // Delete any pending registration for this email (it becomes void)
    if (email) await User.deletePending(email);

    // Find existing user by oauth link first, then by email if a fallback.
    // Sprint 6 round-33 R33B7: when matching an existing account BY EMAIL
    // (not by oauth link), require email_verified. Mirrors the /google
    // fix — a malicious Apple ID whose email isn't confirmed shouldn't
    // be able to takeover an existing password-based Cairn account
    // that happens to share the email. Match-by-appleSub (line 433) is
    // always safe because sub is cryptographically bound to Apple's
    // per-user per-app identity.
    let user = null;
    const oauthRow = await User.findOAuth('apple', appleSub);
    if (oauthRow) {
      user = await User.findById(oauthRow.user_id);
    } else if (email && emailVerified) {
      user = await User.findByEmail(email);
    }

    if (!user && email) {
      // New user — create with the client-provided name (Apple only sends
      // it on first authorize, hence the fallback to email local-part).
      const displayName = (providedName && String(providedName).trim().slice(0, 60))
        || email.split('@')[0]
        || 'Cairn user';
      const userId = await User.createOAuthUser(displayName, email);
      await User.linkOAuth(userId, 'apple', appleSub);
      user = await User.findById(userId);
    } else if (user) {
      await User.linkOAuth(user.id, 'apple', appleSub);
    }

    if (!user) {
      // No email + no existing link — Apple withheld the email (private
      // relay) and this is a fresh signup. We cannot create a user row
      // without SOME email since email is the unique identifier for
      // account recovery + friend-lookup. Ask the client to prompt the
      // user or hand off to a manual email-entry step.
      return res.status(400).json({
        error: 'Apple did not share your email. Please sign up with email instead.',
        hint: 'apple_no_email',
      });
    }

    const publicUser = User.toPublic(user);
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      // Sprint 6 R44B5: include token_version — see /verify above.
      token_version: Number(user.token_version || 0),
    });

    // Soft-delete handoff (same as /login and /google).
    if (user.deleted_at) {
      const deletedAt = new Date(user.deleted_at);
      const restoreDeadline = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      return res.json({
        user: publicUser,
        token,
        hint: 'pending_deletion',
        restore_deadline: restoreDeadline.toISOString(),
      });
    }
    return res.json({ user: publicUser, token, emailVerified });
  } catch (err) {
    console.error('[apple]', err.message);
    return res.status(401).json({ error: 'Apple sign-in failed. Please try again.' });
  }
});

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    const providers = await User.getUserProviders(user.id);
    return res.json({ user: { ...User.toPublic(user), providers } });
  } catch (err) {
    console.error('[me]', err);
    // DB unavailable — return minimal user from JWT payload so frontend stays logged in
    return res.json({ user: { id: req.user.userId, email: req.user.email, name: req.user.email?.split('@')[0] ?? 'User', providers: [] } });
  }
});

// ── POST /api/auth/refresh (Sprint 72 STORY-00550) ─────────────────────────
// Trades an existing valid JWT for a fresh one with a new expiry.
// Used by:
//   1. Frontend hydrate-time pre-expiry check (if <3 days left)
//   2. useTrackingStore periodic refresh during active hiking (every 30 min)
// Any 401 here means the token is truly invalid — frontend treats this as
// a hard signout signal (see apiService.ts iron rule).
// Sprint 6 review C5: rate-limit refresh so a stolen token cannot be
// looped to keep issuing new jtis indefinitely. 30/hour/IP is well
// above legit periodic-refresh usage (client refreshes every 30 min
// during active hiking = 2/hour).
// Sprint 6 round-11 R11B5 + round-15 R15B3: /refresh is authenticated,
// but express-rate-limit runs BEFORE authenticate in the chain (order
// below), so req.user is not yet populated at key-eval time. The old
// keyGenerator claimed userId keying but always fell through to IP —
// meaning a shared-NAT office shared one 30/hr bucket instead of
// per-user 30/hr. Fix: swap middleware order so authenticate runs
// first, THEN limiter reads req.user.userId. Note: on invalid tokens
// authenticate short-circuits with 401 and the limiter never runs —
// this is intentional (invalid tokens don't consume real-user quota).
const refreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.userId ? `refresh:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many refresh attempts. Please sign in again.' },
});
router.post('/refresh', authenticate, refreshLimiter, async (req, res) => {
  try {
    // Sprint 6 R44B5: propagate token_version from the old token so
    // the refreshed token carries the same version. If a bump happens
    // AFTER refresh, both old + new tokens invalidate together — which
    // is the intended universal-sign-out behavior. Fresh refresh should
    // NOT preemptively re-fetch server version (that would let a
    // just-refreshed token survive a subsequent password change on
    // another device, defeating the mass-revoke).
    const newToken = signToken({
      userId: req.user.userId,
      email: req.user.email,
      token_version: Number(req.user.token_version || 0),
    });
    return res.json({ token: newToken });
  } catch (err) {
    console.error('[refresh]', err);
    return res.status(500).json({ error: 'Failed to refresh token.' });
  }
});

// Sprint 6 round-15 R15B1: /password (change) had no rate limit. Auth
// middleware runs first (authenticated token required), so keying by
// userId is safe and consistent. 10 attempts / 15 min matches authLimiter
// but scoped per-user so a shared-NAT office isn't collectively locked.
const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.userId ? `pwchange:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many password change attempts. Please wait 15 minutes.' },
});

// ── PATCH /api/auth/password ───────────────────────────────────────────────
// Set password (no current password needed) or change password (requires current)
// Sprint 6 round-15 R15B1: authenticate MUST run before the limiter so
// req.user is populated when keyGenerator fires (express-rate-limit resolves
// key before the handler, but middleware chain order is respected — placing
// authenticate first sets req.user, then the limiter reads it).
router.patch('/password', authenticate, passwordChangeLimiter, validateBody(schemas.auth.passwordChange), async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!validatePassword(newPassword))
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    if (user.password_hash) {
      // Change existing password — require current
      if (!currentPassword)
        return res.status(400).json({ error: 'Current password is required.' });
      const match = await User.comparePassword(currentPassword, user.password_hash);
      if (!match)
        return res.status(401).json({ error: 'Current password is incorrect.' });
    }
    // else: setting password for first time (OAuth user) — no current needed

    const hash = await User.hashPassword(newPassword);
    await User.setPassword(user.id, hash);
    // Sprint 6 round-15 R15B2: bump token_version so ALL other devices
    // sign out on next request. Password change = universal sign-out
    // (industry standard). Without this, an attacker who compromised a
    // device could keep using its old token even after the legitimate
    // owner changes the password. Pattern mirrors /account/restore.
    // Re-fetch user for new token_version, then issue a fresh token so
    // the CALLER stays signed in on this device (their old token would
    // otherwise fail authenticate.js's serverVer > jwtVer check).
    await User.bumpTokenVersion(user.id);
    // Sprint 6 round-16 R16F7: also revoke caller's OLD jti explicitly.
    // token_version bump alone would work (LRU cache expiry = 5min), but
    // during that window a jti-cached-as-valid check would let an attacker
    // on ANOTHER device slip through if they had the same old token. Belt
    // + suspenders: revoke the specific old jti so any peer verification
    // relying on the LRU rejects it immediately. Mirrors /account/restore.
    if (req.user.jti) {
      const expUnixMs = req.user.exp ? req.user.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
      try {
        await TokenBlacklist.revoke(req.user.jti, req.user.userId, new Date(expUnixMs));
      } catch (blErr) {
        // Blacklist is defense-in-depth; token_version bump is authoritative.
        console.warn('[password] blacklist revoke failed:', blErr.message);
      }
    }
    const refreshed = await User.findById(user.id);
    const newToken = signToken({
      userId: refreshed.id,
      email: refreshed.email,
      token_version: Number(refreshed.token_version || 0),
    });

    return res.json({ message: 'Password updated.', token: newToken });
  } catch (err) {
    console.error('[password]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/auth/logout (O18 AUTH-08) ────────────────────────────────────
// Revokes the current jti so the token can no longer be used, even if not
// expired. Auth middleware LRU cache picks it up within 5 min; direct DB
// check is authoritative. Idempotent — repeated calls with the same jti
// simply refresh the row via ON DUPLICATE KEY.
router.post('/logout', authenticate, async (req, res) => {
  try {
    // Sprint 6 review C9 fix: also delete THIS user's push tokens so a
    // cold-boot logout (where the client no longer has the token cached
    // in memory) still stops pushes reaching the previous account. If
    // the client passes an explicit push_token in the body we prefer
    // that (deletes only the current device); otherwise fall back to
    // unregistering ALL tokens for this user (safer default).
    try {
      const PushNotification = require('../models/PushNotification');
      if (req.body?.push_token && typeof req.body.push_token === 'string') {
        // Sprint 6 round-12 R12B1: pass user_id so we don't cross-user delete.
        await PushNotification.unregisterToken(req.body.push_token, req.user.userId);
      } else {
        await PushNotification.unregisterAllForUser(req.user.userId);
      }
    } catch (pushErr) {
      console.error('[logout] push unregister failed:', pushErr.message);
    }

    if (!req.user.jti) {
      // Legacy token without jti — can't revoke. Return 200 so frontend
      // still clears local state.
      return res.json({ message: 'Signed out.' });
    }
    // jti expiry = token expiry (from `exp` claim, unix seconds).
    const expUnixMs = req.user.exp ? req.user.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
    await TokenBlacklist.revoke(req.user.jti, req.user.userId, new Date(expUnixMs));
    res.set('X-Cairn-Auth-Invalid', 'true');
    return res.json({ message: 'Signed out.' });
  } catch (err) {
    console.error('[logout]', err);
    // Fail open — frontend still clears local state on 200
    return res.json({ message: 'Signed out.' });
  }
});

// ── POST /api/auth/password-reset/request (O18 AUTH-04) ───────────────────
// Issues a 6-digit code emailed to the user. Returns 200 regardless of
// whether the email exists (prevent enumeration). Rate limited to prevent
// spam. Actual code delivery via email service.
router.post('/password-reset/request', resetRequestLimiter, validateBody(schemas.auth.passwordResetRequest), async (req, res) => {
  const { email } = req.body;
  const normalEmail = email.toLowerCase().trim();

  // Sprint 6 round-13 R13B5 fix: pad the response to a fixed budget so
  // an attacker can't tell a real-account POST (SELECT users + INSERT
  // reset_code + kick email = ~15-30ms) from a non-existent-account
  // POST (SELECT users only = ~2ms). We race the real work against a
  // 250ms floor. All branches wait the same total time before responding.
  const responsePad = new Promise(resolve => setTimeout(resolve, 250));

  try {
    const user = await User.findByEmail(normalEmail);
    // Always return 200 — do not leak account existence.
    if (!user || !user.password_hash) {
      // OAuth-only or non-existent: no code issued, but wait for the
      // pad so timing matches the real branch.
      await responsePad;
      return res.json({ message: 'If an account exists for this email, a code has been sent.' });
    }

    // Sprint 6 review C3: issueCode may throw rate_limited — catch and
    // return the same generic 200 body (privacy uniform).
    let code;
    try {
      code = await PasswordReset.issueCode(normalEmail);
    } catch (issueErr) {
      if (issueErr && issueErr.rateLimited) {
        await responsePad;
        return res.json({ message: 'If an account exists for this email, a code has been sent.' });
      }
      throw issueErr;
    }
    sendPasswordResetCode(normalEmail, code).catch(err =>
      console.error('[email] password reset send failed:', err.message)
    );

    const devPayload = process.env.NODE_ENV !== 'production' ? { dev_code: code } : {};
    await responsePad;
    return res.json({ message: 'If an account exists for this email, a code has been sent.', ...devPayload });
  } catch (err) {
    console.error('[password-reset/request]', err);
    // Sprint 6 round-14 R14B2 fix: pad the 500 branch too — pre-fix, a
    // DB blip returned sub-5ms 500 while success returned 250ms 200,
    // giving an attacker a "existing account errored" vs "non-existent
    // 200" distinguisher. Now: always wait for the pad + return the
    // same 200 body regardless. Ops sees the failure in server logs.
    await responsePad;
    return res.json({ message: 'If an account exists for this email, a code has been sent.' });
  }
});

// ── POST /api/auth/password-reset/verify (O18 AUTH-04) ────────────────────
// Verifies the emailed 6-digit code + sets a new password in one shot.
// Uses timingSafeEqual internally. On success: password updated, all codes
// for this email marked used, new JWT issued (with fresh jti).
router.post('/password-reset/verify', authLimiter, validateBody(schemas.auth.passwordResetVerify), async (req, res) => {
  const { email, code, new_password } = req.body;
  const normalEmail = email.toLowerCase().trim();

  if (!validatePassword(new_password))
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  try {
    const result = await PasswordReset.consumeCode(normalEmail, code);
    if (!result.ok) {
      // Sprint 6 round-13 R13B5 fix: collapse `not_found` and `mismatch`
      // into one identical response so an attacker POSTing random codes
      // can't enumerate emails via the error string. Retain distinct
      // strings only for terminal states (used / expired / too_many)
      // where the response is state-agnostic (once the user has burned
      // a code, telling them why is fine).
      const errorMap = {
        not_found:          'Incorrect or expired code. Please try again.',
        used:               'This code has already been used.',
        expired:            'This code has expired. Please request a new one.',
        too_many_attempts:  'Too many incorrect attempts. Please request a new code.',
        mismatch:           'Incorrect or expired code. Please try again.',
      };
      // Sprint 6 round-14 R14B6 fix: DO NOT expose `hint: result.reason`
      // in production — it defeated R13B5's error collapse by leaking
      // the internal state (not_found vs mismatch etc.). Client callers
      // that need the reason (e.g. auto-hide the code input on
      // too_many_attempts) still get it in dev builds.
      const body = { error: errorMap[result.reason] || 'Invalid code.' };
      if (process.env.NODE_ENV !== 'production') body.hint = result.reason;
      return res.status(400).json(body);
    }

    const user = await User.findByEmail(normalEmail);
    if (!user) {
      // Race: user deleted between code issue and verify. Rare, defensive.
      return res.status(400).json({ error: 'Account not found.' });
    }

    const hash = await User.hashPassword(new_password);
    await User.setPassword(user.id, hash);
    // Sprint 6 round-15 R15B2: bump token_version so ALL prior devices
    // sign out. Password reset via email code is the classic
    // account-takeover recovery path — a compromised device MUST NOT
    // survive it. Mirror of /password path.
    await User.bumpTokenVersion(user.id);
    const refreshed = await User.findById(user.id);

    // Issue fresh token (new jti + new token_version — old tokens on other
    // devices fail authenticate.js's serverVer > jwtVer check on next call).
    const publicUser = User.toPublic(refreshed);
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      token_version: Number(refreshed.token_version || 0),
    });
    return res.json({ user: publicUser, token });
  } catch (err) {
    console.error('[password-reset/verify]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── DELETE /api/auth/account (O18 AUTH-01) ─────────────────────────────────
// Soft-delete: sets users.deleted_at. Cron sweep hard-deletes after 7 days.
// User can restore during grace period via POST /account/restore. Also
// revokes the current jti so the token is immediately unusable.
//
// Sprint 6 R60: rate-limit to prevent confirmation-email spam. Endpoint is
// idempotent (repeated calls return same deletedAt), but each call still
// fires sendAccountDeletionConfirmation. Attacker on a compromised session
// could POST DELETE /account 100x → 100 confirmation emails to victim.
// Cap 3/day/user matches R59 wipe cadence — one legitimate delete + retry
// on failure has plenty of headroom.
const deleteAccountLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 3,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.userId ? `deleteAcct:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many delete-account requests. Please try again tomorrow.' },
});
router.delete('/account', authenticate, deleteAccountLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });

    // Idempotent: already deleted → return existing deadline.
    let deletedAtIso;
    if (user.deleted_at) {
      deletedAtIso = new Date(user.deleted_at).toISOString();
    } else {
      await User.softDelete(user.id);
      const updated = await User.findById(user.id);
      deletedAtIso = new Date(updated.deleted_at).toISOString();
    }

    const restoreDeadline = new Date(new Date(deletedAtIso).getTime() + 7 * 24 * 60 * 60 * 1000);

    // Send confirmation email with restore instructions (non-blocking).
    sendAccountDeletionConfirmation(user.email, user.name, restoreDeadline).catch(err =>
      console.error('[email] deletion confirmation failed:', err.message)
    );

    // Revoke current jti so the client is signed out immediately.
    if (req.user.jti) {
      const expUnixMs = req.user.exp ? req.user.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
      await TokenBlacklist.revoke(req.user.jti, req.user.userId, new Date(expUnixMs)).catch(err =>
        console.error('[logout during delete] revoke failed:', err.message)
      );
    }
    // Sprint 6 review M9 fix: also unregister all push tokens for the
    // soft-deleted user. Their choice to delete should stop notifications
    // immediately, not wait for the 7-day cron sweep.
    try {
      const PushNotification = require('../models/PushNotification');
      await PushNotification.unregisterAllForUser(req.user.userId);
    } catch (pushErr) {
      console.error('[account delete] push unregister failed:', pushErr.message);
    }
    res.set('X-Cairn-Auth-Invalid', 'true');
    return res.json({
      message: 'Account scheduled for deletion.',
      deleted_at: deletedAtIso,
      restore_deadline: restoreDeadline.toISOString(),
    });
  } catch (err) {
    console.error('[account delete]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── POST /api/auth/account/restore (O18 AUTH-01) ──────────────────────────
// Undoes soft-delete during grace period. After 7 days the cron sweep has
// already hard-deleted the row; this returns 404 in that case.
// Called from the restore modal which is triggered by hint: 'pending_deletion'
// on login. Token in Authorization header is the one just issued by /login,
// which is still valid because auth middleware allows it (row exists, jti
// not blacklisted).
router.post('/account/restore', authenticate, async (req, res) => {
  try {
    const restored = await User.restoreDeleted(req.user.userId);
    if (!restored) {
      // Either the user was never soft-deleted, or the row is already gone
      // (past grace period). Either way, no-op — return current state.
      const user = await User.findById(req.user.userId);
      if (!user) return res.status(404).json({ error: 'Account not found. It may have been permanently deleted.' });
      return res.json({ user: User.toPublic(user), message: 'Account is active.' });
    }
    // Sprint 6 round-9 R9B8 fix: bump token_version BEFORE issuing the
    // new token. Every existing token (including our current one) had
    // the pre-bump token_version claim (or none for pre-migration
    // tokens); they'll all be rejected on next request by authenticate
    // middleware. Then we mint a fresh JWT that includes the new
    // token_version so THIS caller keeps working.
    await User.bumpTokenVersion(req.user.userId);
    // Reload user to get the new token_version.
    const user = await User.findById(req.user.userId);
    const publicUser = User.toPublic(user);
    const token = signToken({
      userId: publicUser.id,
      email: publicUser.email,
      token_version: Number(user.token_version || 0),
    });
    // Also revoke the caller's current jti for defense in depth (belt
    // and suspenders with token_version).
    if (req.user.jti) {
      const expUnixMs = req.user.exp ? req.user.exp * 1000 : Date.now() + 30 * 24 * 60 * 60 * 1000;
      await TokenBlacklist.revoke(req.user.jti, req.user.userId, new Date(expUnixMs)).catch(err =>
        console.error('[restore] revoke old jti failed:', err.message)
      );
    }
    return res.json({ user: publicUser, token, message: 'Account restored.' });
  } catch (err) {
    console.error('[account restore]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// ── PATCH /api/auth/dob (O18 AUTH-06) ─────────────────────────────────────
// Legacy DOB backfill. Users who registered before AUTH-06 migration have
// dateOfBirth = null and get a modal on login prompting them to enter it.
// Enforces >= 13 same as register. Cannot change DOB once set (prevents
// gaming age gate).
router.patch('/dob', authenticate, validateBody(schemas.auth.setDob), async (req, res) => {
  const { dateOfBirth } = req.body;

  const age = ageInYears(dateOfBirth);
  if (age === null) return res.status(400).json({ error: 'Please enter a valid date of birth.' });
  if (age < 13) return res.status(400).json({ error: 'Cairn is only available for people aged 13 and up.', hint: 'age_gate' });

  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (user.date_of_birth) {
      return res.status(409).json({ error: 'Date of birth already set. Contact support to change.' });
    }
    await User.setDateOfBirth(user.id, dateOfBirth);
    const updated = await User.findById(user.id);
    return res.json({ user: User.toPublic(updated) });
  } catch (err) {
    console.error('[dob patch]', err);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

module.exports = router;
