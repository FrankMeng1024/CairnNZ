/**
 * Memory routes — Memory mode points cloud sync.
 *
 *   POST /api/memory/points    (auth) — upload a batch of visited points
 *   GET  /api/memory/points    (auth) — download all visited points
 *   DELETE /api/memory/points  (auth) — wipe user's memory
 *
 * v0.2.6.3 (K2 fix):
 *   - UNIQUE key is now (user_id, client_id) not (user_id, ts) — multiple
 *     points sharing the same ms (e.g. recordPoint + recordCircleUnlock
 *     in the same tick) no longer collide.
 *   - Server-side fallback for legacy v0.2.6.2 clients that POST
 *     without cid: deterministic hash of (user_id, ts, lat, lng) so
 *     retries from the same client compute the same cid → INSERT IGNORE
 *     dedups correctly.
 *   - GET supports keyset pagination via after_ts + after_cid params
 *     so ts-collisions don't break the cursor.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/authenticate');
const { deterministicCid } = require('../lib/deterministicCid');
const { scheduleMemoryAttribution, scheduleMemoryProjectionReset } = require('../lib/attributeMemoryPoints');
const { reconcilePublicSubmissionsForActivity } = require('../services/publicPublication');
const {
  loadPreparedCoverage,
  loadCoverageSnapshotPage,
  parseViewport,
  synchronizeCoverageEvidenceForClientIds,
  synchronizeCoverageEvidenceForSegments,
  scheduleCoverageMaterialization,
} = require('../services/memoryCoverage');

function schedulePublicMemoryReconciliation(userId, clientActivityId) {
  setImmediate(() => {
    void reconcilePublicSubmissionsForActivity(pool, userId, clientActivityId).catch(error => {
      console.error('[memory/points:public-reconcile]', {
        userId,
        clientActivityId,
        error: error?.message || String(error),
      });
    });
  });
}
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');

const router = express.Router();

function observationDistanceM(aLat, aLng, bLat, bLng) {
  const toRad = value => Number(value) * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(Math.max(0, 1 - x)));
}

// v412: deterministicCid 抽到 lib/deterministicCid.js, sessions.js /save 端点复用同一实现

// Sprint 6 round-30 R30Q3: per-user rate limit on POST /points. Pre-fix,
// only the batch cap of 1000 points enforced any bound. A malicious
// (or badly-behaved retry-loop) client could POST 1000-point batches
// back-to-back → unbounded MySQL write amplification + attributeMemoryPoints
// runs an ST_Contains sweep per batch. Legitimate memory sync fires ~
// every 30-60s during active hiking, so 120/5min/user leaves ~1 req/
// 2.5s of headroom for retry storms without opening a DoS vector. Key
// by userId (authenticate runs first); IP fallback defends the
// unauthenticated-attempt edge that shouldn't happen post-authenticate.
const pointsLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `mempts:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many memory point uploads. Slow down.' },
});

/**
 * POST /api/memory/points
 * Body: { points: [{ lat, lng, ts, cid? }, ...] }
 * Returns: { points: [{ ts, cid } | null, ...] }
 *
 * Response includes the cid for each accepted row so clients on
 * v0.2.6.2 (no cid) can backfill locally on next pull. Null placeholders
 * in the echo array preserve request/response index alignment.
 */
router.post('/points', authenticate, pointsLimiter, validateBody(schemas.memory.points), async (req, res) => {
  const userId = req.user.userId;
  const points = Array.isArray(req.body?.points) ? req.body.points : [];
  const presenceWitnesses = Array.isArray(req.body?.presence_witnesses) ? req.body.presence_witnesses : [];

  if (points.length === 0 && presenceWitnesses.length === 0) {
    return res.json({ points: [], presence_witnesses: [] });
  }
  if (points.length > 1000) {
    return res.status(400).json({ error: 'batch too large (max 1000 points)' });
  }

  const tsUpperBound = Date.now() + 24 * 60 * 60 * 1000;
  const rows = [];
  const echo = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (
      typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || typeof p?.ts !== 'number' ||
      !isFinite(p.lat) || !isFinite(p.lng) || !isFinite(p.ts) ||
      // M6: ts must be integer; fractional ts breaks deterministic-cid hashing.
      !Number.isInteger(p.ts) ||
      p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 ||
      p.ts <= 0 || p.ts > tsUpperBound || p.ts > Number.MAX_SAFE_INTEGER
    ) {
      // M5: emit a null placeholder so request/response array indices stay aligned.
      echo.push(null);
      continue;
    }
    // Sprint 6 round-18 R18 note: `client_id` column collation is
    // utf8mb4_0900_ai_ci (case + accent insensitive). Two clients sending
    // `cid='ABC123'` and `cid='abc123'` would collide on the UNIQUE key
    // uk_user_cid and one point would be silently dropped via
    // ON DUPLICATE KEY. Odds are zero in practice: Expo UUIDs are
    // lowercase and `deterministicCid` returns hex — both already stable
    // casing. Left as-is to preserve client-side sync-id parity; a
    // future ALTER to utf8mb4_bin (or lowercase-normalization here)
    // would need coordinated client rollout so the echo doesn't diverge
    // from the client's locally cached cid. Filed as backlog risk item.
    const cid = (typeof p.cid === 'string' && p.cid.length > 0 && p.cid.length <= 36)
      ? p.cid
      : deterministicCid(userId, p.ts, p.lat, p.lng);
    const evidenceSource = ['activity_real', 'passive_real', 'historical_unknown'].includes(p.evidence_source)
      ? p.evidence_source
      : 'historical_unknown';
    const sourceActivityClientId = evidenceSource === 'activity_real' && typeof p.source_activity_client_id === 'string'
      ? p.source_activity_client_id
      : null;
    const sourceSegmentId = ['activity_real', 'passive_real'].includes(evidenceSource)
      && typeof p.source_segment_id === 'string'
      ? p.source_segment_id.slice(0, 80)
      : null;
    const horizontalAccuracyM = Number.isFinite(p.horizontal_accuracy_m) ? p.horizontal_accuracy_m : null;
    let continuityState = ['accepted', 'gap', 'unknown'].includes(p.continuity_state)
      ? p.continuity_state
      : 'unknown';
    // Passive clients may propose evidence, but cannot make an individual
    // point accepted by assertion alone. The server promotes it only after a
    // qualifying same-segment continuity witness is durable below.
    if (evidenceSource === 'passive_real') continuityState = 'unknown';
    rows.push([
      userId, p.lat, p.lng, p.ts, cid, evidenceSource,
      sourceActivityClientId, sourceSegmentId, horizontalAccuracyM, continuityState,
    ]);
    echo.push({ batch_index: i, ts: p.ts, cid });
  }

  const presenceRows = [];
  const presenceEcho = [];
  for (const witness of presenceWitnesses) {
    const firstObservedAtMs = Number(witness?.first_observed_at_ms);
    const observedAtMs = Number(witness?.observed_at_ms);
    const source = witness?.evidence_source;
    const sourceActivityClientId = source === 'activity_real'
      && typeof witness?.source_activity_client_id === 'string'
      ? witness.source_activity_client_id
      : null;
    const sourceSegmentId = ['activity_real', 'passive_real'].includes(source)
      && typeof witness?.source_segment_id === 'string'
      ? witness.source_segment_id.slice(0, 80)
      : null;
    const firstLat = Number(witness?.first_lat);
    const firstLng = Number(witness?.first_lng);
    const lat = Number(witness?.lat);
    const lng = Number(witness?.lng);
    const accuracyM = Number(witness?.horizontal_accuracy_m);
    const durationMs = observedAtMs - firstObservedAtMs;
    const distanceM = observationDistanceM(firstLat, firstLng, lat, lng);
    const plausibleSpeedMps = durationMs > 0 ? distanceM / (durationMs / 1000) : 0;
    if (!Number.isFinite(firstObservedAtMs) || !Number.isInteger(firstObservedAtMs)
      || !Number.isFinite(observedAtMs) || !Number.isInteger(observedAtMs)
      || firstObservedAtMs <= 0 || observedAtMs < firstObservedAtMs || observedAtMs > tsUpperBound
      || !['activity_real', 'passive_real'].includes(source)
      || (source === 'activity_real' && (!sourceActivityClientId || !sourceSegmentId))
      || !sourceSegmentId || typeof witness?.cid !== 'string' || witness.cid.length < 1 || witness.cid.length > 36
      || !Number.isFinite(firstLat) || !Number.isFinite(firstLng) || !Number.isFinite(lat) || !Number.isFinite(lng)
      || Math.abs(firstLat) > 90 || Math.abs(lat) > 90 || Math.abs(firstLng) > 180 || Math.abs(lng) > 180
      || !Number.isFinite(accuracyM) || accuracyM <= 0 || accuracyM > 50
      || witness?.continuity_state !== 'accepted') continue;
    const serverContinuity = source === 'passive_real'
      ? (durationMs >= 15_000 && plausibleSpeedMps <= 15 ? 'accepted' : 'unknown')
      : 'accepted';
    // The witness table contains only evidence accepted by server policy.
    // Unqualified passive claims leave their matching coverage points unknown
    // instead of attempting to persist an impossible enum value.
    if (serverContinuity !== 'accepted') continue;
    presenceRows.push([
      userId,
      witness.cid,
      firstLat,
      firstLng,
      firstObservedAtMs,
      lat,
      lng,
      observedAtMs,
      source,
      sourceActivityClientId,
      sourceSegmentId,
      accuracyM,
      serverContinuity,
    ]);
    presenceEcho.push({ cid: witness.cid, observed_at_ms: observedAtMs });
  }

  if (rows.length === 0 && presenceRows.length === 0) {
    return res.json({ points: [], presence_witnesses: [] });
  }

  try {
    // M2 fix (v0.2.6.3): use INSERT ... ON DUPLICATE KEY UPDATE so non-
    // dedup errors surface as exceptions (vs INSERT IGNORE which
    // silently drops them — leading the client to mark non-stored
    // points as synced and lose them).
    //
    // The ON DUPLICATE clause is a no-op (`client_id=client_id`) — we
    // just need any expression so MySQL doesn't error on the conflict.
    // Then we SELECT the affected cids to confirm what really landed.
    if (rows.length > 0) {
      await pool.query(
        `INSERT INTO memory_points
         (user_id, lat, lng, ts, client_id, evidence_source,
          source_activity_client_id, source_segment_id, horizontal_accuracy_m, continuity_state)
       VALUES ?
       ON DUPLICATE KEY UPDATE
         evidence_source = CASE
           WHEN VALUES(evidence_source) = 'activity_real' THEN 'activity_real'
           WHEN evidence_source = 'historical_unknown' AND VALUES(evidence_source) = 'passive_real' THEN 'passive_real'
           ELSE evidence_source END,
         source_activity_client_id = COALESCE(VALUES(source_activity_client_id), source_activity_client_id),
         source_segment_id = COALESCE(VALUES(source_segment_id), source_segment_id),
         horizontal_accuracy_m = COALESCE(VALUES(horizontal_accuracy_m), horizontal_accuracy_m),
         continuity_state = CASE
           WHEN VALUES(continuity_state) = 'accepted' THEN 'accepted'
           ELSE continuity_state END`,
        [rows]
      );
    }
    // memory_points is already committed. Region attribution is a derived,
    // idempotent projection and must not block the source upload response.
    if (rows.length > 0) {
      const tsList = rows.map((r) => r[3]); // rows[i] = [user_id, lat, lng, ts, client_id]
      scheduleMemoryAttribution(pool, userId, Math.min(...tsList), Math.max(...tsList));
    }
    // Confirm storage by selecting back the cids we just inserted.
    const validEcho = echo.filter((e) => e !== null);
    const cidList = validEcho.map((e) => e.cid);
    const [confirmedRows] = cidList.length > 0
      ? await pool.query(
          `SELECT client_id FROM memory_points WHERE user_id = ? AND client_id IN (?)`,
          [userId, cidList]
        )
      : [[]];
    const confirmedSet = new Set(confirmedRows.map((r) => r.client_id));
    // Emit echo preserving null placeholders so client can align by index.
    const finalEcho = echo.map((e) => {
      if (e === null) return null;
      return confirmedSet.has(e.cid) ? e : null;
    });
    if (presenceRows.length > 0) {
      await pool.query(
        `INSERT INTO memory_presence_witnesses
           (user_id, client_id, first_lat, first_lng, first_observed_at_ms,
            lat, lng, observed_at_ms, evidence_source, source_activity_client_id,
            source_segment_id, horizontal_accuracy_m, continuity_state)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           first_lat = IF(VALUES(first_observed_at_ms) < first_observed_at_ms, VALUES(first_lat), first_lat),
           first_lng = IF(VALUES(first_observed_at_ms) < first_observed_at_ms, VALUES(first_lng), first_lng),
           first_observed_at_ms = LEAST(first_observed_at_ms, VALUES(first_observed_at_ms)),
           lat = IF(VALUES(observed_at_ms) > observed_at_ms, VALUES(lat), lat),
           lng = IF(VALUES(observed_at_ms) > observed_at_ms, VALUES(lng), lng),
           horizontal_accuracy_m = IF(
             VALUES(observed_at_ms) > observed_at_ms,
             VALUES(horizontal_accuracy_m),
             horizontal_accuracy_m
           ),
           source_segment_id = COALESCE(VALUES(source_segment_id), source_segment_id),
           observed_at_ms = GREATEST(observed_at_ms, VALUES(observed_at_ms)),
           continuity_state = CASE
             WHEN continuity_state='accepted' OR VALUES(continuity_state)='accepted' THEN 'accepted'
             ELSE 'unknown' END`,
        [presenceRows],
      );
      // Promote passive coverage only from a server-validated continuity
      // witness for the same account and segment. This closes the direct
      // client `continuity_state: accepted` shortcut while preserving the
      // independent passive recorder's normal 15-second lifecycle.
      await pool.query(
        `UPDATE memory_points point
          JOIN memory_presence_witnesses witness
            ON witness.user_id=point.user_id
           AND witness.evidence_source='passive_real'
           AND witness.source_segment_id=point.source_segment_id
           AND witness.continuity_state='accepted'
           AND point.ts BETWEEN witness.first_observed_at_ms AND witness.observed_at_ms
           SET point.continuity_state='accepted'
         WHERE point.user_id=? AND point.evidence_source='passive_real'
           AND point.horizontal_accuracy_m IS NOT NULL
           AND point.horizontal_accuracy_m>0 AND point.horizontal_accuracy_m<=50`,
        [userId],
      );
    }
    const presenceCids = presenceEcho.map(entry => entry.cid);
    const [confirmedPresenceRows] = presenceCids.length > 0
      ? await pool.query(
        'SELECT client_id FROM memory_presence_witnesses WHERE user_id = ? AND client_id IN (?)',
        [userId, presenceCids],
      )
      : [[]];
    const confirmedPresence = new Set(confirmedPresenceRows.map(row => row.client_id));
    const finalPresenceEcho = presenceEcho.filter(entry => confirmedPresence.has(entry.cid));
    await synchronizeCoverageEvidenceForClientIds(
      pool,
      userId,
      finalEcho.filter(Boolean).map(entry => entry.cid),
    );
    // A passive continuity witness can promote points that were ACKed by an
    // earlier upload. Materialize that bounded segment synchronously before
    // this witness is acknowledged, so the client's immediate prepared read
    // cannot miss legitimate newly accepted history.
    await synchronizeCoverageEvidenceForSegments(
      pool,
      userId,
      presenceRows.map(row => row[10]),
    );
    // A marker may have reached the server before its qualifying Memory
    // evidence. Once these source rows are durable, re-evaluate only the
    // exact Activities represented by this request. Public remains isolated:
    // its failure cannot turn a successful Memory upload into a retry storm.
    const sourceActivityClientIds = new Set([
      ...rows.map(row => row[6]),
      ...presenceRows.map(row => row[9]),
    ].filter(Boolean));
    for (const clientActivityId of sourceActivityClientIds) {
      schedulePublicMemoryReconciliation(userId, clientActivityId);
    }
    scheduleCoverageMaterialization(pool, userId);
    // The ACK is emitted only after both bounded coverage-evidence sync calls
    // above complete. A subsequent Mine snapshot reads that same primary
    // evidence/state authority; it cannot legitimately predate this ACK.
    // O1: dropped accepted/duplicates/rejected — client 只用 points echo,
    // 三个数字纯 debug 遗留(memorySync 从不 read)。
    return res.json({ points: finalEcho, presence_witnesses: finalPresenceEcho });
  } catch (err) {
    console.error('[memory/points:insert]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /api/memory/points
 * Query: ?after_ts=<n>&after_cid=<s>&limit=<n>&until=<n>
 *   - Keyset pagination: returns points where (ts > after_ts) OR
 *     (ts == after_ts AND cid > after_cid), ordered (ts ASC, cid ASC).
 *     Tolerates ts-collisions which are now possible since UNIQUE
 *     moved to cid.
 *   - `until` (optional): only return points with ts <= until — used
 *     by clients to bound a paginated pull to the snapshot at start
 *     time so concurrent writes don't extend the loop forever.
 *   - limit defaults to 5000, max 10000.
 *
 * Returns: { points: [{ lat, lng, ts, cid }, ...] }
 *
 * Backwards compat: if no query params, returns all points (subject to
 * default limit) — old v0.2.6.2 clients work unchanged.
 */
router.get('/points', authenticate, async (req, res) => {
  const userId = req.user.userId;
  // Sprint 6 R85 BUG-3: clamp to finite non-negative. Pre-fix, `Number("Infinity")`
  // returns Infinity (truthy, || 0 doesn't trigger), which mysql2 would
  // serialize into a BIGINT parameter → SQL type error → 500. Same for
  // NaN via crafted input. Now: force finite integer, default to 0 for
  // afterTs and MAX_SAFE_INTEGER for until.
  const rawAfterTs = Number(req.query.after_ts);
  const afterTs = Number.isFinite(rawAfterTs) && rawAfterTs >= 0 ? rawAfterTs : 0;
  const afterCid = typeof req.query.after_cid === 'string' ? req.query.after_cid.slice(0, 36) : '';
  const rawUntil = Number(req.query.until);
  const until = Number.isFinite(rawUntil) && rawUntil >= 0 ? rawUntil : Number.MAX_SAFE_INTEGER;
  const requested = Number(req.query.limit);
  const limit = Math.max(1, Math.min(10000, Number.isFinite(requested) ? requested : 5000));
  try {
    const [rows] = await pool.query(
      `SELECT lat, lng, ts, client_id, evidence_source, source_activity_client_id,
              source_segment_id, horizontal_accuracy_m, continuity_state
       FROM memory_points
       WHERE user_id = ?
         AND ts <= ?
         AND ((ts > ?) OR (ts = ? AND client_id > ?))
       ORDER BY ts ASC, client_id ASC
       LIMIT ?`,
      [userId, until, afterTs, afterTs, afterCid, limit]
    );
    return res.json({
      points: rows.map((r) => ({
        lat: Number(r.lat),
        lng: Number(r.lng),
        ts: Number(r.ts),
        cid: r.client_id,
        evidence_source: r.evidence_source || 'historical_unknown',
        source_activity_client_id: r.source_activity_client_id || null,
        source_segment_id: r.source_segment_id || null,
        horizontal_accuracy_m: r.horizontal_accuracy_m === null ? null : Number(r.horizontal_accuracy_m),
        continuity_state: r.continuity_state || 'unknown',
      })),
    });
  } catch (err) {
    console.error('[memory/points:query]', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Sprint 6 R59: rate-limit the wipe endpoint. Pre-fix, DELETE
// /memory/points had no throttle — a bug or malicious action could
// trigger a full data wipe with a single call. Legitimate use is
// "user taps Clear my memory in Settings" once (with client-side
// confirmation dialog). Cap at 3 wipes / day / user — allows a
// user to retry after failure but blunts accidental-loop / abuse
// scenarios. If a user really needs to wipe multiple times in a
// day, they can wait or contact support.
const wipeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, max: 3,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user?.userId ? `memwipe:${req.user.userId}` : ipKeyGenerator(req.ip),
  message: { error: 'Too many memory wipe requests. Please try again tomorrow.' },
});

/**
 * DELETE /api/memory/points
 * Wipes all of the authenticated user's memory points. Used by the
 * Settings → "Clear my memory" action.
 */
router.delete('/points', authenticate, wipeLimiter, async (req, res) => {
  const userId = req.user.userId;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [regionsResult] = await conn.query(
      'DELETE FROM unlocked_regions WHERE user_id = ?',
      [userId]
    );
    const [result] = await conn.query(
      'DELETE FROM memory_points WHERE user_id = ?',
      [userId]
    );
    const [presenceResult] = await conn.query(
      'DELETE FROM memory_presence_witnesses WHERE user_id = ?',
      [userId]
    );
    await conn.query('DELETE FROM memory_coverage_tiles WHERE owner_id = ?', [userId]);
    await conn.query('DELETE FROM memory_coverage_source_state WHERE owner_id = ?', [userId]);
    // A wipe changes every outgoing projection even when the directional
    // grant itself remains active. Advance authorization atomically so warm
    // recipients cannot mistake a pre-wipe envelope for current coverage.
    await conn.query(
      `UPDATE memory_share_grants
          SET authorization_version = authorization_version + 1
        WHERE owner_id = ? AND status = 'active'
          AND coverage_scope = 'full_history_delayed_v1'`,
      [userId],
    );
    await conn.commit();
    scheduleMemoryProjectionReset(pool, userId);
    return res.json({
      deleted: result.affectedRows ?? 0,
      presence_witnesses_deleted: presenceResult.affectedRows ?? 0,
      unlocked_regions_deleted: regionsResult.affectedRows ?? 0,
    });
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignore */ }
    console.error('[memory/points:delete]', err.message);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    conn.release();
  }
});

// Additive all-regions contract. Existing /coverage remains unchanged for O92
// and older installed clients; snapshot pages are complete only after the
// terminal page and all manifest counts have been verified by the caller.
router.get('/coverage-snapshot', authenticate, async (req, res) => {
  const startedAt = Date.now();
  try {
    const result = await loadCoverageSnapshotPage(pool, req.user.userId, 'mine', {
      snapshotId: typeof req.query.snapshot_id === 'string' ? req.query.snapshot_id : undefined,
      visibleAt: typeof req.query.as_of === 'string' ? req.query.as_of : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      pageSize: req.query.page_size,
      snapshotAuthority: `mine:${req.user.userId}`,
    });
    return res.json({
      ...result,
      source_owner_id: String(req.user.userId),
      total_ms: Date.now() - startedAt,
    });
  } catch (error) {
    const status = Number(error?.httpStatus) || 500;
    if (status >= 500) console.error('[memory/coverage-snapshot]', error.message);
    return res.status(status).json({
      error: status >= 500 ? 'Server error' : error.message,
      code: error?.code ?? 'COVERAGE_SNAPSHOT_FAILED',
    });
  }
});

router.get('/coverage', authenticate, async (req, res) => {
  const viewport = parseViewport(typeof req.query.bbox === 'string'
    ? req.query.bbox.split(',')
    : null);
  if (!viewport) return res.status(400).json({ error: 'Valid bbox is required' });
  const startedAt = Date.now();
  try {
    const coverage = await loadPreparedCoverage(pool, req.user.userId, 'mine', viewport);
    return res.json({
      ...coverage,
      source_owner_id: String(req.user.userId),
      total_ms: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[memory/coverage]', error.message);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
