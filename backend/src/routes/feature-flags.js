/**
 * Feature Flags Routes — /api/feature-flags
 *
 * v0.2.5 Phase 0.15: read-only public endpoint exposing the feature_flags table.
 * Used by app/src/services/v025/featureFlagsClient.ts at app boot.
 *
 * Endpoints:
 *   GET /api/feature-flags
 *     Response: { flags: { key: stringValue, ... }, fetchedAt: iso8601 }
 *
 * Security posture (see ADR-008):
 *   - Unauthenticated by design — flag values are not secret; clients must learn
 *     them BEFORE sign-in to decide which UI path to render. If a flag must be
 *     private (e.g. payment routing), it goes in a different table + authed route.
 *   - LIMIT 1000 on the SELECT to bound response size against accidental row bloat
 *     and amplification abuse (1KB per row * 1000 = ~1MB max body).
 *   - No rate limit at this layer: client fetches once at boot + at most once per
 *     app session; abusive callers will be caught by the global Express rate limiter.
 *
 * 500 fallback: client falls back to HARD_DEFAULTS (fail-closed: useV025=false).
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const FEATURE_FLAGS_LIMIT = 1000;

router.get('/', async (req, res) => {
    try {
        const [rows] = await pool.execute(
            'SELECT flag_key, flag_value FROM feature_flags LIMIT ?',
            [FEATURE_FLAGS_LIMIT]
        );
        const flags = {};
        for (const r of rows) flags[r.flag_key] = r.flag_value;
        res.json({ flags, fetchedAt: new Date().toISOString() });
    } catch (err) {
        // Log code + message for ops triage (e.g. ER_NO_SUCH_TABLE → migration not run).
        console.error('[feature-flags] read failed:', err.code, err.message);
        res.status(500).json({ error: 'feature_flags_read_failed', code: err.code || 'unknown' });
    }
});

module.exports = router;
