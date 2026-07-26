/**
 * Session routes:
 *   POST   /api/sessions                      (authenticated) — save a session (legacy: all-in-one)
 *   POST   /api/sessions/start                (authenticated) — create empty row, return id (incremental flow)
 *   PATCH  /api/sessions/:id/append-points    (authenticated) — append GPS points to active session
 *   PATCH  /api/sessions/:id                  (authenticated) — finalize a session (legacy, v411-)
 *   PATCH  /api/sessions/:id/save             (authenticated) — v412 原子事务 save (route_points + raw + memory_points)
 *   GET    /api/sessions                      (authenticated) — list user's sessions
 *   GET    /api/sessions/:id                  (authenticated) — get session with route_points + flags
 *   DELETE /api/sessions/:id                  (authenticated) — delete a session
 */
const express = require('express');
const Session = require('../models/Session');
const authenticate = require('../middleware/authenticate');
const idempotency = require('../middleware/idempotency');
const { validateBody } = require('../middleware/validate');
const schemas = require('../middleware/schemas');
const pool = require('../config/db');
const { deterministicCid } = require('../lib/deterministicCid');

const router = express.Router();

// ── POST /api/sessions (LEGACY - REMOVED 2026-07-20) ──────────────────────
// v411 legacy 一次性保存 endpoint 已删除。v412+ 使用 start + append-points + save
// 三步原子保存流程。若旧 client 仍调 POST /api/sessions,将得到 404。
// 30d nginx log: 0 次调用。前端源码: 0 处 fetch。

// ── GET /api/sessions ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const sessions = await Session.findByUser(req.user.userId);
    return res.json({ sessions });
  } catch (err) {
    console.error('[sessions/list]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── GET /api/sessions/unfinished ───────────────────────────────────────────
// v430: return the most-recent session where POST /start was called but no
// PATCH /save ever succeeded (finalized_at IS NULL). Client uses this to
// detect kill-app-mid-hike scenarios where disk-side active file may have
// been lost (e.g. user killed app before startHikeTrack finished writing).
router.get('/unfinished', authenticate, async (req, res) => {
  try {
    const row = await Session.findLatestUnfinished(req.user.userId);
    return res.json({ session: row });
  } catch (err) {
    console.error('[sessions/unfinished]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── POST /api/sessions/start ───────────────────────────────────────────────
// Begin an active session — creates an empty row, returns its id.
// Client uses the returned id for subsequent /append-points and final
// PATCH calls. This decouples "start tracking" from "finish tracking" so
// crashes mid-session don't lose data.
router.post('/start', authenticate, validateBody(schemas.session.start), idempotency, async (req, res) => {
  const { type, start_time } = req.body;
  if (!type || !['hiking', 'running'].includes(type)) {
    return res.status(400).json({ error: 'type must be "hiking" or "running".' });
  }
  if (!start_time || isNaN(Date.parse(start_time))) {
    return res.status(400).json({ error: 'start_time must be a valid ISO date.' });
  }
  try {
    const id = await Session.createEmpty({
      userId: req.user.userId,
      type,
      startTime: new Date(start_time),
    });
    return res.status(201).json({ id });
  } catch (err) {
    console.error('[sessions/start]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/sessions/:id/append-points ──────────────────────────────────
// Append a batch of GPS points to an active session. Used by the 60-second
// incremental backup interval during tracking.
router.patch('/:id/append-points', authenticate, validateBody(schemas.session.appendPoints), idempotency, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const { points } = req.body;
  if (!Array.isArray(points)) {
    return res.status(400).json({ error: 'points must be an array.' });
  }
  if (points.length === 0) {
    return res.status(200).json({ ok: true, appended: 0 });
  }
  try {
    const ok = await Session.appendPoints(id, req.user.userId, points);
    if (!ok) return res.status(404).json({ error: 'Session not found.' });
    return res.status(200).json({ ok: true, appended: points.length });
  } catch (err) {
    console.error('[sessions/append-points]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/sessions/:id ────────────────────────────────────────────────
// DEPRECATED as of O1 (2026-07-26): client 已迁到 PATCH /:id/save
// (saveHikeAtomic 一体化端点)。保留此 handler 只为兼容 offlineQueue 里
// 可能残留的 v411 及更早 client 发的历史 session_finalize op。新 client
// 从 v412 起不发 PATCH /:id。若 v460+ 时 offlineQueue 已完全排空,可删。
//
// Finalize a session at stop time: write end_time, distance_m, duration_s,
// and (optional) name.
router.patch('/:id', authenticate, validateBody(schemas.session.update), idempotency, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const { end_time, distance_m, duration_s, name, route_points, route_points_raw } = req.body;
  const fields = {};
  if (end_time !== undefined) {
    if (isNaN(Date.parse(end_time))) {
      return res.status(400).json({ error: 'end_time must be a valid ISO date.' });
    }
    fields.endTime = new Date(end_time);
  }
  if (distance_m !== undefined) {
    if (typeof distance_m !== 'number' || distance_m < 0) {
      return res.status(400).json({ error: 'distance_m must be a non-negative number.' });
    }
    fields.distanceM = distance_m;
  }
  if (duration_s !== undefined) {
    if (typeof duration_s !== 'number' || duration_s < 0) {
      return res.status(400).json({ error: 'duration_s must be a non-negative number.' });
    }
    fields.durationS = duration_s;
  }
  if (name !== undefined) fields.name = name;
  // v77: optional raw audit track. Sent once at session finalize (not in
  // 60s flushes since it's debug-only). Accept null to clear.
  if (route_points_raw !== undefined) {
    if (route_points_raw !== null && !Array.isArray(route_points_raw)) {
      return res.status(400).json({ error: 'route_points_raw must be an array or null.' });
    }
    fields.routePointsRaw = route_points_raw;
  }
  // v6.4: optional snapped polyline. Client computes Mapbox /matching on
  // the raw GPS at stop time and ships the cleaned polyline here so cross-
  // device loads, fresh installs, and brush-edit baselines all see the
  // same clean geometry. The raw audit track stays in route_points_raw
  // forever as a backup. Accept null to clear / fall back to raw.
  if (route_points !== undefined) {
    if (route_points !== null && !Array.isArray(route_points)) {
      return res.status(400).json({ error: 'route_points must be an array or null.' });
    }
    fields.routePoints = route_points;
  }
  try {
    // Reject finalization if the session has no drawable path.
    // The incremental flow (start → append-points → finalize) may result in
    // zero or one GPS points if the user started and immediately stopped.
    const existing = await Session.findByIdAndUser(id, req.user.userId);
    if (!existing) return res.status(404).json({ error: 'Session not found.' });
    const pointCount = Array.isArray(existing.route_points) ? existing.route_points.length : 0;
    if (pointCount < 2) {
      // Delete the empty/too-short session — no reason to keep it on disk.
      await Session.deleteByIdAndUser(id, req.user.userId);
      return res.status(422).json({ error: 'Session has no drawable path (fewer than 2 GPS points). Not saved.' });
    }

    const ok = await Session.finalize(id, req.user.userId, fields);
    if (!ok) return res.status(404).json({ error: 'Session not found or no changes.' });
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sessions/finalize]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── PATCH /api/sessions/:id/save ───────────────────────────────────────────
// v412 原子事务端点: 一次请求完成 4 件事 (要么全成一起, 要么全不发生):
//   1. UPDATE sessions: end_time / distance_m / duration_s / name / route_points /
//      route_points_raw / finalized_at
//   2. INSERT memory_points 批量 (chunk=50)
// (markers 独立不进事务, 见 v412 design §0.10)
//
// 幂等: idempotency middleware 通过 X-Idempotency-Key header 或 body client_op_id
// 若 finalized_at 已非 NULL, 拒绝重放业务, 直接 200 返回当前状态 (§1.3)
//
// 事务任何一步失败 → rollback → 5xx → client 走离线分支 (§0.9 pendingSyncStore)
router.patch('/:id/save', authenticate, validateBody(schemas.session.save), idempotency, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  const userId = req.user.userId;
  const {
    end_time,
    distance_m,
    duration_s,
    name,
    route_points,
    route_points_raw,
    memory_points,
  } = req.body;

  // ── 输入校验 (在进事务前做, 失败直接 400 不占 conn)
  if (!end_time || isNaN(Date.parse(end_time))) {
    return res.status(400).json({ error: 'end_time must be a valid ISO date.' });
  }
  if (typeof distance_m !== 'number' || distance_m < 0) {
    return res.status(400).json({ error: 'distance_m must be a non-negative number.' });
  }
  if (typeof duration_s !== 'number' || duration_s < 0) {
    return res.status(400).json({ error: 'duration_s must be a non-negative number.' });
  }
  if (!Array.isArray(route_points)) {
    return res.status(400).json({ error: 'route_points must be an array.' });
  }
  // v412 review 视角 B blocker 1: 校验每个 route point 合法, 防 client 塞垃圾 JSON
  for (let i = 0; i < route_points.length; i++) {
    const p = route_points[i];
    if (!p || typeof p !== 'object' ||
        typeof p.lat !== 'number' || !isFinite(p.lat) || p.lat < -90 || p.lat > 90 ||
        typeof p.lng !== 'number' || !isFinite(p.lng) || p.lng < -180 || p.lng > 180 ||
        typeof p.t !== 'number' || !isFinite(p.t) || p.t <= 0) {
      return res.status(400).json({ error: `route_points[${i}] invalid: expect {lat, lng, t}` });
    }
  }
  if (route_points_raw !== null && route_points_raw !== undefined && !Array.isArray(route_points_raw)) {
    return res.status(400).json({ error: 'route_points_raw must be an array or null.' });
  }
  // route_points_raw 允许多字段 (acc/alt 等), 但基础 lat/lng/t 必须合法
  if (Array.isArray(route_points_raw)) {
    for (let i = 0; i < route_points_raw.length; i++) {
      const p = route_points_raw[i];
      if (!p || typeof p !== 'object' ||
          typeof p.lat !== 'number' || !isFinite(p.lat) || p.lat < -90 || p.lat > 90 ||
          typeof p.lng !== 'number' || !isFinite(p.lng) || p.lng < -180 || p.lng > 180 ||
          typeof p.t !== 'number' || !isFinite(p.t) || p.t <= 0) {
        return res.status(400).json({ error: `route_points_raw[${i}] invalid: expect {lat, lng, t, ...}` });
      }
    }
  }
  if (memory_points !== null && memory_points !== undefined && !Array.isArray(memory_points)) {
    return res.status(400).json({ error: 'memory_points must be an array or null.' });
  }
  const memPts = Array.isArray(memory_points) ? memory_points : [];
  if (memPts.length > 1000) {
    return res.status(400).json({ error: 'memory_points batch too large (max 1000).' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. FOR UPDATE 锁行, 校验归属 + 未 finalize
    const [rows] = await conn.execute(
      `SELECT id, start_time, end_time, finalized_at FROM sessions
       WHERE id=? AND user_id=? FOR UPDATE`,
      [id, userId]
    );
    if (!rows[0]) {
      await conn.rollback();
      return res.status(404).json({ error: 'Session not found.' });
    }

    // v3.3 已 finalize 判定 (backend subagent B2 修): finalized_at 非 NULL OR
    // 老数据 end_time != start_time (v411 时代靠这个判 finalize)
    // 加 isFinite 防御 '0000-00-00' 之类无效日期 → NaN 比较永远假
    const startTs = rows[0].start_time ? new Date(rows[0].start_time).getTime() : NaN;
    const endTs = rows[0].end_time ? new Date(rows[0].end_time).getTime() : NaN;
    const alreadyFinalized =
      rows[0].finalized_at !== null ||
      (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs !== startTs);

    if (alreadyFinalized) {
      // 幂等: 返回当前 server 状态, idempotent_replay=true
      // 若 idempotency middleware 已 cache 命中, 这段不会跑到 (middleware 直接 replay)
      // 但若 middleware 因 cache 过期 miss, 这里作为兜底再次幂等
      await conn.rollback();
      return res.status(200).json({
        ok: true,
        session_id: id,
        finalized_at: rows[0].finalized_at || rows[0].end_time,
        memory: { accepted: 0, rejected: 0 },
        idempotent_replay: true,
      });
    }

    // 2. UPDATE sessions (含 finalized_at = NOW())
    const finalizedAtDate = new Date();
    await conn.execute(
      `UPDATE sessions SET
         end_time=?, distance_m=?, duration_s=?, name=?,
         route_points=?, route_points_raw=?, finalized_at=?
       WHERE id=? AND user_id=?`,
      [
        new Date(end_time),
        distance_m,
        duration_s,
        name || null,
        JSON.stringify(route_points),
        route_points_raw && route_points_raw.length > 0
          ? JSON.stringify(route_points_raw)
          : null,
        finalizedAtDate,
        id,
        userId,
      ],
    );

    // 3. Bulk INSERT memory_points (chunk=50 防事务过长锁行)
    let accepted = 0;
    let rejected = 0;
    if (memPts.length > 0) {
      const tsUpperBound = Date.now() + 24 * 60 * 60 * 1000;
      const validRows = [];
      for (const p of memPts) {
        if (
          typeof p?.lat !== 'number' || typeof p?.lng !== 'number' || typeof p?.ts !== 'number' ||
          !isFinite(p.lat) || !isFinite(p.lng) || !isFinite(p.ts) ||
          !Number.isInteger(p.ts) ||
          p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180 ||
          p.ts <= 0 || p.ts > tsUpperBound
        ) {
          rejected++;
          continue;
        }
        // v412: server 端算 cid, client 不算 (§1.7 保证跨端一致)
        const cid = deterministicCid(userId, p.ts, p.lat, p.lng);
        validRows.push([userId, p.lat, p.lng, p.ts, cid]);
      }
      const CHUNK = 50;
      for (let i = 0; i < validRows.length; i += CHUNK) {
        const slice = validRows.slice(i, i + CHUNK);
        await conn.query(
          `INSERT INTO memory_points (user_id, lat, lng, ts, client_id) VALUES ?
           ON DUPLICATE KEY UPDATE client_id=VALUES(client_id)`,
          [slice],
        );
        accepted += slice.length;
      }
      // v439: attribute newly-inserted points to unlocked_regions inside
      // the same transaction so panel reads see fresh unlocks immediately
      // after this /save call returns.
      try {
        const { attributeMemoryPoints } = require('../lib/attributeMemoryPoints');
        const tsList = validRows.map((r) => r[3]);
        const minTs = Math.min(...tsList);
        const maxTs = Math.max(...tsList);
        await attributeMemoryPoints(conn, userId, minTs, maxTs);
      } catch (attrErr) {
        console.error(`[sessions/save] ATTR_ERR user=${userId} session=${id} err=${attrErr.message}`);
        // Do NOT rollback for attribution errors — the memory_points are
        // already inserted correctly. Attribution can be recomputed via
        // backfill script if it drifts.
      }
    }

    await conn.commit();

    return res.status(200).json({
      ok: true,
      session_id: id,
      finalized_at: finalizedAtDate.toISOString(),
      memory: { accepted, rejected },
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollErr) {
      console.error('[sessions/save] rollback failed', rollErr);
    }
    console.error('[sessions/save]', err);
    return res.status(500).json({ error: 'Server error.' });
  } finally {
    conn.release();
  }
});

// ── GET /api/sessions/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    const session = await Session.findByIdAndUser(id, req.user.userId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.json({ session });
  } catch (err) {
    console.error('[sessions/get]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

// ── DELETE /api/sessions/:id ───────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Invalid session ID.' });
  }
  try {
    const deleted = await Session.deleteByIdAndUser(id, req.user.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Session not found.' });
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[sessions/delete]', err);
    return res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
