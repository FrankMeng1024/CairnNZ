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
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { signToken } = require('../config/jwt');
const authenticate = require('../middleware/authenticate');
const { sendVerificationCode } = require('../services/emailService');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes.' },
});

// OAuth tokens are short-lived and already validated by Google — brute-force not applicable.
// Higher limit so dev testing doesn't hit the wall.
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again shortly.' },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 1000, max: 2,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Please wait before requesting another code.' },
});

// ── Helpers ────────────────────────────────────────────────────────────────

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', authLimiter, validateBody(schemas.auth.register), async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length < 1)
    return res.status(400).json({ error: 'Name is required.' });
  if (name.trim().length > 100)
    return res.status(400).json({ error: 'Name must be 100 characters or fewer.' });
  if (!email || !validateEmail(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!validatePassword(password))
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

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
    const code = await User.upsertPending(normalEmail, name.trim(), passwordHash);

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

    // Too many attempts
    if (pending.attempts >= 5) {
      await User.deletePending(normalEmail);
      return res.status(400).json({ error: 'Too many incorrect attempts. Please register again.', hint: 'locked' });
    }

    // Wrong code
    if (String(pending.code) !== String(code).trim()) {
      await User.incrementPendingAttempts(normalEmail);
      const remaining = 4 - pending.attempts;
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

    // All good — create real user
    const userId = await User.createUser(pending.name, normalEmail, pending.password_hash);
    await User.deletePending(normalEmail);

    const user = await User.findById(userId);
    const publicUser = User.toPublic(user);
    const token = signToken({ userId: publicUser.id, email: publicUser.email });

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
    const code = await User.upsertPending(normalEmail, pending.name, pending.password_hash);
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

    const publicUser = User.toPublic(user);
    const token = signToken({ userId: publicUser.id, email: publicUser.email });
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
      // Accept tokens from both Web client (Expo/web) and iOS native client
      audience: [
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_IOS_CLIENT_ID,
      ].filter(Boolean),
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email)
      return res.status(401).json({ error: 'Invalid Google token.' });

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
    const token = signToken({ userId: publicUser.id, email: publicUser.email });
    return res.json({ user: publicUser, token });
  } catch (err) {
    console.error('[google]', err);
    return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
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
router.post('/refresh', authenticate, async (req, res) => {
  try {
    const newToken = signToken({ userId: req.user.userId, email: req.user.email });
    return res.json({ token: newToken });
  } catch (err) {
    console.error('[refresh]', err);
    return res.status(500).json({ error: 'Failed to refresh token.' });
  }
});

// ── PATCH /api/auth/password ───────────────────────────────────────────────
// Set password (no current password needed) or change password (requires current)
router.patch('/password', authenticate, validateBody(schemas.auth.passwordChange), async (req, res) => {
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

    return res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('[password]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
