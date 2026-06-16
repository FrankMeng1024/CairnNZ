/**
 * v0.2.5 Phase 3.2 — debug-events bulk INSERT route.
 *
 * POST /api/v025/debug-events
 *   Body: { events: [{ phase, step, seq, sessionInstanceId, timestampUnixMs, outcome, diagnostic }, ...] }
 *   Limits: max 200 events per request (matches TelemetryBatcherV2 flush size).
 *
 * Authenticated: optional. v025 telemetry events ARE associated with a user when
 * possible (telemetryUploader passes the JWT), but the schema's user_id is NULLABLE
 * so we accept anonymous upload from pre-auth flows (e.g. crash before login).
 *
 * Round-1 4-eye fixes (Phase 3 sub#3-2):
 *   - Rate limit (60 req/min/IP) to prevent abuse
 *   - PII strip: lat/lng-looking patterns + emails removed from diagnostic
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const pool = require('../../config/db');
const optionalAuth = require('../../middleware/optionalAuthenticate');

const MAX_EVENTS_PER_REQUEST = 200;
const ALLOWED_OUTCOME_LEN = 32;
const ALLOWED_DIAG_LEN = 1024;
const ALLOWED_FIELD_LEN = 64;

// Round-1 #3-2-A: rate limit. 60 requests/min/IP × 200 events/request =
// 12,000 events/min/IP cap (well above legitimate use; bounds abuse).
const rl = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req, res) => ipKeyGenerator(req, res),
});

// Round-1 #3-2-B: strip lat/lng patterns + emails from diagnostic.
// Patterns:
//   1. lat,lng decimal coords:  /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/
//   2. emails: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
// Replace with `[redacted]` markers so devs can see something was stripped.
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
function stripPii(s) {
    if (typeof s !== 'string' || s.length === 0) return '';
    return s.replace(COORD_RE, '[redacted-coords]').replace(EMAIL_RE, '[redacted-email]');
}

function clampString(s, max) {
    if (typeof s !== 'string') return '';
    return s.length > max ? s.slice(0, max) : s;
}

router.post('/debug-events', rl, optionalAuth, async (req, res) => {
    const events = Array.isArray(req.body?.events) ? req.body.events : null;
    if (!events) {
        return res.status(400).json({ error: 'events_must_be_array' });
    }
    if (events.length === 0) {
        return res.json({ inserted: 0 });
    }
    if (events.length > MAX_EVENTS_PER_REQUEST) {
        return res.status(400).json({ error: 'events_exceeds_max', max: MAX_EVENTS_PER_REQUEST });
    }

    const userId = req.user?.id ?? null;
    const rows = [];
    for (const ev of events) {
        if (!ev || typeof ev !== 'object') continue;
        const sessionInstanceId = clampString(ev.sessionInstanceId, ALLOWED_FIELD_LEN);
        const phase = clampString(ev.phase, ALLOWED_FIELD_LEN);
        const step = clampString(ev.step, ALLOWED_FIELD_LEN);
        const seqNum = Number.isFinite(ev.seq) ? Math.floor(ev.seq) : 0;
        const tsMs = Number.isFinite(ev.timestampUnixMs) ? Math.floor(ev.timestampUnixMs) : Date.now();
        const outcome = clampString(ev.outcome, ALLOWED_OUTCOME_LEN);
        const diagnostic = clampString(stripPii(ev.diagnostic), ALLOWED_DIAG_LEN);
        if (!sessionInstanceId || !phase || !step) continue;
        rows.push([userId, sessionInstanceId, phase, step, seqNum, tsMs, outcome, diagnostic]);
    }

    if (rows.length === 0) {
        return res.status(400).json({ error: 'no_valid_events' });
    }

    try {
        const sql = `INSERT INTO debug_events_v2
            (user_id, session_instance_id, phase, step, seq, timestamp_unix_ms, outcome, diagnostic)
            VALUES ?`;
        const [result] = await pool.query(sql, [rows]);
        return res.json({ inserted: result.affectedRows });
    } catch (err) {
        console.error('[v025/debug-events] insert failed:', err.code, err.message);
        return res.status(500).json({ error: 'insert_failed', code: err.code || 'unknown' });
    }
});

module.exports = router;
