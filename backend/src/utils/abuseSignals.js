/**
 * Append-only abuse-signal logger. Best-effort, never blocks the calling
 * route on DB failure (we'd rather drop one telemetry row than reject a
 * legit user request). Used by /vote handler for every server-side
 * rejection (gps_too_far, replay_nonce_invalid, etc.) — see
 * algorithm-思想-v6.md §三 reporter trust weighting (v2 model trains on
 * this table).
 */
const pool = require('../config/db');

function log(req, { kind, userId = null, markerId = null, payload = null }) {
  // Fire-and-forget. Caller does not await.
  const ip =
    (req && (req.ip || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim())) || null;
  const payloadJson = payload ? JSON.stringify(payload) : null;
  pool
    .execute(
      `INSERT INTO abuse_signals (user_id, marker_id, kind, payload, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, markerId, kind, payloadJson, ip],
    )
    .catch((err) => {
      // Don't throw — log to stderr so it lands in container logs without
      // affecting user response.
      console.warn('[abuse_signals] insert failed:', err.message);
    });
}

module.exports = { log };
