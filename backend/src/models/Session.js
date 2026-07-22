/**
 * Session model — wraps sessions table queries.
 */
const pool = require('../config/db');

/**
 * mysql2 returns JSON columns as JS arrays/objects on modern MySQL+driver
 * combos (the JSON type is auto-parsed). Older driver versions returned
 * strings. Both are still legal — code that reads route_points/flags
 * needs to handle either. This helper normalises to a JS value.
 */
function parseJsonCol(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  // Already parsed by the driver — return as-is.
  return v;
}

const Session = {
  async create({ userId, routeId, type, startTime, endTime, distanceM, durationS, routePoints, routePointsRaw, flags, name }) {
    const [result] = await pool.execute(
      `INSERT INTO sessions (user_id, route_id, type, start_time, end_time, distance_m, duration_s, name, route_points, route_points_raw, flags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId, routeId ?? null, type, startTime, endTime,
        distanceM ?? 0, durationS ?? 0,
        name ?? null,
        routePoints ? JSON.stringify(routePoints) : null,
        routePointsRaw ? JSON.stringify(routePointsRaw) : null,
        flags ? JSON.stringify(flags) : null,
      ]
    );
    return result.insertId;
  },

  async findByUser(userId) {
    // v429 fix: exclude dangling / unfinished rows (session_start called but
    // no PATCH /save ever reached the server — usually app kill mid-hike).
    // finalized_at IS NULL AND distance_m=0 AND duration_s=0 = ghost row.
    // Keep older v3.3-flagged sessions (finalized_at IS NOT NULL) OR sessions
    // that have real data (distance or duration > 0, even if PATCH never
    // completed due to network — user can still see them and manually delete).
    const [rows] = await pool.execute(
      `SELECT id, user_id, route_id, type, start_time, end_time, distance_m, duration_s, name, created_at
       FROM sessions
       WHERE user_id = ?
         AND (finalized_at IS NOT NULL OR distance_m > 0 OR duration_s > 0)
       ORDER BY start_time DESC`,
      [userId]
    );
    return rows;
  },

  async deleteByIdAndUser(id, userId) {
    const [result] = await pool.execute(
      `DELETE FROM sessions WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    return result.affectedRows > 0;
  },

  async findByIdAndUser(id, userId) {
    const [rows] = await pool.execute(
      `SELECT id, user_id, route_id, type, start_time, end_time, distance_m, duration_s, name, route_points, route_points_raw, flags, created_at
       FROM sessions WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!rows[0]) return null;
    const s = rows[0];
    return {
      ...s,
      route_points: parseJsonCol(s.route_points) ?? [],
      route_points_raw: parseJsonCol(s.route_points_raw) ?? null,
      flags: parseJsonCol(s.flags) ?? [],
    };
  },

  /**
   * Create an empty session row at the start of tracking. Returns the
   * insert id so the client can use it for incremental append + final
   * finalize calls.
   *
   * end_time is set equal to start_time as a placeholder; finalize()
   * will overwrite it with the real end time. Without this placeholder
   * the NOT NULL constraint on end_time would reject the insert.
   */
  async createEmpty({ userId, type, startTime }) {
    const [result] = await pool.execute(
      `INSERT INTO sessions (user_id, type, start_time, end_time, distance_m, duration_s, route_points, flags)
       VALUES (?, ?, ?, ?, 0, 0, JSON_ARRAY(), NULL)`,
      [userId, type, startTime, startTime]
    );
    return result.insertId;
  },

  /**
   * Append a batch of GPS points to a session's route_points JSON array.
   * Used by the incremental backup flow during an active session.
   *
   * Implementation: read-merge-write (MySQL has no native JSON_ARRAY_APPEND
   * with multi-element batch in older versions). We use JSON_ARRAY_INSERT
   * via a server-side merge for safety: read existing, concat, write back.
   */
  async appendPoints(id, userId, points) {
    if (!Array.isArray(points) || points.length === 0) return false;

    // v80 review-fix: wrap in a transaction with SELECT ... FOR UPDATE.
    // Two concurrent flushes for the same session_id (e.g. queued retry
    // firing while a fresh flush dispatches) could both SELECT the
    // baseline, both compute disjoint dedupe sets, and the second UPDATE
    // would clobber the first. The row lock serialises read-modify-write
    // so the dedupe Set sees the latest committed state.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [rows] = await conn.execute(
        `SELECT route_points FROM sessions WHERE id = ? AND user_id = ? FOR UPDATE`,
        [id, userId]
      );
      if (!rows[0]) {
        await conn.rollback();
        return false;
      }
      const existing = parseJsonCol(rows[0].route_points) ?? [];
      const existingArr = Array.isArray(existing) ? existing : [];

      // Defensive dedupe — see comment about idempotency middleware.
      // v80 review-fix: include longitude in the dedupe key so the
      // (theoretical but possible) "same ms + same 6dp lat / different
      // lng" collision can't ever drop a real point. Cost: one extra
      // toFixed per point.
      const ts = (p) => typeof p?.t === 'number'
        ? p.t
        : (typeof p?.timestamp === 'number' ? p.timestamp : Date.parse(p?.t ?? p?.timestamp ?? ''));
      const seen = new Set();
      for (const p of existingArr) {
        const t = ts(p);
        if (Number.isFinite(t)) {
          seen.add(`${t}|${(p?.lat ?? 0).toFixed(6)}|${(p?.lng ?? 0).toFixed(6)}`);
        }
      }
      const newPoints = [];
      for (const p of points) {
        const t = ts(p);
        if (!Number.isFinite(t)) { newPoints.push(p); continue; }
        const key = `${t}|${(p?.lat ?? 0).toFixed(6)}|${(p?.lng ?? 0).toFixed(6)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        newPoints.push(p);
      }
      if (newPoints.length === 0) {
        // All caller-sent points were already on file → idempotent no-op.
        // Return true so the client doesn't retry; no UPDATE needed.
        await conn.commit();
        return true;
      }
      const merged = existingArr.concat(newPoints);
      await conn.execute(
        `UPDATE sessions SET route_points = ? WHERE id = ? AND user_id = ?`,
        [JSON.stringify(merged), id, userId]
      );
      await conn.commit();
      return true;
    } catch (err) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw err;
    } finally {
      conn.release();
    }
  },

  /**
   * Finalize a session at stop time: overwrite end_time, distance_m,
   * duration_s, and (optionally) name. Called from stopTracking after
   * the final point flush.
   *
   * v77: optional routePointsRaw — full audit track including stationary
   * drift + low-accuracy fixes (everything except teleport-rejected).
   * Stored once at finalize, not in per-60s appendPoints flushes.
   *
   * v6.4: optional routePoints — Mapbox-snapped clean polyline computed on
   * the client at stop time. Replaces the per-append raw aggregate as the
   * canonical "route" geometry shown to the user. routePointsRaw stays as
   * the immutable backup. Caller may pass null to clear (fall back to raw).
   */
  async finalize(id, userId, { endTime, distanceM, durationS, name, routePoints, routePointsRaw }) {
    const fields = [];
    const values = [];
    if (endTime != null) { fields.push('end_time = ?'); values.push(endTime); }
    if (distanceM != null) { fields.push('distance_m = ?'); values.push(distanceM); }
    if (durationS != null) { fields.push('duration_s = ?'); values.push(durationS); }
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (routePoints !== undefined) {
      fields.push('route_points = ?');
      values.push(routePoints ? JSON.stringify(routePoints) : null);
    }
    if (routePointsRaw !== undefined) {
      fields.push('route_points_raw = ?');
      values.push(routePointsRaw ? JSON.stringify(routePointsRaw) : null);
    }
    if (fields.length === 0) return false;
    // v412 §1.9 (backend subagent B4): 旧 finalize 端点也写 finalized_at,
    // 保证 v411 client 用旧端点后, v3.3 新逻辑不误认为"未 finalize"
    fields.push('finalized_at = ?');
    values.push(new Date());
    values.push(id, userId);
    const [result] = await pool.execute(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`,
      values
    );
    return result.affectedRows > 0;
  },
};

module.exports = Session;
