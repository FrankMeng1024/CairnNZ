/**
 * Push routes — /api/push
 *
 * Endpoints:
 * POST   /api/push/register        — Register (or refresh) a device token
 * POST   /api/push/unregister      — Remove a device token (on sign-out)
 * GET    /api/push/preferences     — Get user's notification preferences
 * PATCH  /api/push/preferences     — Update preferences
 * GET    /api/push/log             — Recent notifications for this user
 *
 * All routes require auth.
 */
const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const PushNotification = require('../models/PushNotification');

router.use(authenticate);

// Sprint 6 round-22 R22Q4: rate-limit /register to blunt token-hijack
// enumeration attacks. Expo push tokens are opaque long random strings,
// so an attacker can't guess them — but a token leak (via logs, an
// old crash report, a compromised backup, etc.) combined with our
// R17F7 "delete stale-owner row on register" would let an attacker
// steal a specific user's push routing with a single API call. Cap
// registers to 20 / 15 min / user so the attack becomes noisy (spike
// detectable) and expensive (per-user quota isolates blast radius).
// Legitimate re-registration on boot / permission-grant fires a
// couple of times a day at most.
const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 20,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req, res) => req.user?.userId ? `pushreg:${req.user.userId}` : ipKeyGenerator(req, res),
  message: { error: 'Too many token registrations. Please try again later.' },
});

// ── POST /api/push/register ────────────────────────────────────────────────
// Body: { token: string, platform: 'ios'|'android'|'web' }
// Idempotent — the same (user, token) row is upserted with a fresh
// last_seen_at. Called on app boot and after permission grant.
router.post('/register', registerLimiter, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'token required' });
  // Sprint 6 R67: bound token length. VARCHAR(255) column would
  // ER_DATA_TOO_LONG on oversized input under STRICT_TRANS_TABLES.
  // Real Expo push tokens are 40-50 chars (ExponentPushToken[...]);
  // 255 leaves ample headroom for future Expo format changes.
  // Attacker submitting 10KB token = clean 400 instead of ambiguous 500.
  if (token.length > 255) return res.status(400).json({ error: 'token too long' });
  if (!['ios', 'android', 'web'].includes(platform)) return res.status(400).json({ error: 'invalid platform' });
  try {
    await PushNotification.registerToken(req.user.userId, token, platform);
    return res.json({ message: 'Token registered.' });
  } catch (err) {
    console.error('[push/register]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/push/unregister ──────────────────────────────────────────────
// Body: { token: string }. Called on sign-out so a re-installed app or
// device handoff doesn't keep receiving the previous user's pushes.
router.post('/unregister', async (req, res) => {
  const { token } = req.body || {};
  // Sprint 6 R67: same validation as /register — type + length bound.
  // Pre-fix, an object body-field would coerce to '[object Object]' in
  // the WHERE clause, resulting in a mysterious no-op 200 response.
  // Clean 400 makes the failure obvious to the client.
  if (!token || typeof token !== 'string' || token.length > 255) {
    return res.status(400).json({ error: 'token required (string, max 255 chars)' });
  }
  try {
    // Sprint 6 round-12 R12B1: pass user_id so we don't cross-user delete
    // when the same Expo token exists for multiple accounts (shared device
    // / restore-from-backup).
    await PushNotification.unregisterToken(token, req.user.userId);
    return res.json({ message: 'Token removed.' });
  } catch (err) {
    console.error('[push/unregister]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/push/preferences ──────────────────────────────────────────────
router.get('/preferences', async (req, res) => {
  try {
    const prefs = await PushNotification.getPreferences(req.user.userId);
    // Null → user has no device registered; return defaults so the UI has
    // something coherent to render.
    return res.json(prefs || {
      friendRequests: true,
      markerReplies: true,
      memoryHits: true,
      announcements: true,
    });
  } catch (err) {
    console.error('[push/preferences]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/push/preferences ────────────────────────────────────────────
// Body: any of pref_friend_requests / pref_marker_replies / pref_memory_hits
// / pref_announcements (0 or 1). Updates every device_token row for this
// user so all devices agree.
router.patch('/preferences', async (req, res) => {
  const body = req.body || {};
  const dbPrefs = {};
  if (body.friendRequests != null) dbPrefs.pref_friend_requests = body.friendRequests ? 1 : 0;
  if (body.markerReplies  != null) dbPrefs.pref_marker_replies  = body.markerReplies  ? 1 : 0;
  if (body.memoryHits     != null) dbPrefs.pref_memory_hits     = body.memoryHits     ? 1 : 0;
  if (body.announcements  != null) dbPrefs.pref_announcements   = body.announcements  ? 1 : 0;
  try {
    await PushNotification.updatePreferences(req.user.userId, dbPrefs);
    const updated = await PushNotification.getPreferences(req.user.userId);
    // Sprint 6 review C4: getPreferences may return null when the user
    // has neither a user_push_prefs row nor a device_tokens row. That
    // shouldn't happen right after updatePreferences (which upserts),
    // but if it does, fall back to defaults so the client never sees {}.
    return res.json(updated || {
      friendRequests: true, markerReplies: true,
      memoryHits: true, announcements: true,
    });
  } catch (err) {
    console.error('[push/preferences PATCH]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/push/log ──────────────────────────────────────────────────────
// Recent notifications for in-app notification list UI. Limit clamped to 200.
router.get('/log', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  try {
    const rows = await PushNotification.listRecent(req.user.userId, limit);
    return res.json(rows);
  } catch (err) {
    console.error('[push/log]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
