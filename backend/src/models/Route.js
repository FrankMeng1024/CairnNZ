/**
 * Route model — wraps routes table queries.
 */
const pool = require('../config/db');
const crypto = require('crypto');

/**
 * Normalise a JSON column value. mysql2 auto-parses JSON columns on
 * modern driver+server combos (returns the JS value directly). Older
 * combos return a string. Accept both — anything that's already a
 * non-string value is returned as-is; strings are JSON.parsed.
 */
function parseJsonCol(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return null; }
  }
  return v; // already an object/array (mysql2 auto-parse)
}

function geometryHash(points) {
  const parsed = parseJsonCol(points) ?? [];
  const canonical = parsed.map((point) => [
    Number(point.lat.toFixed(7)),
    Number(point.lng.toFixed(7)),
    point.alt == null ? null : Number(point.alt.toFixed(2)),
  ]);
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

const Route = {
  async create({
    userId, name, description, points, waypoints, distanceM, elevationGainM, permission,
    clientRouteId, sourceActivityClientId, sourceSessionId, originGapReconnected,
  }) {
    // v120 fix: explicitly validate + stringify so mysql2 doesn't fall
    // through to Array.toString() for the JSON column. The "[object
    // Object],[object Object]" corruption seen in route id=1 happened
    // because mysql2 received a non-string value for a JSON column —
    // its default conversion is .toString() on arrays.
    const pointsJson = typeof points === 'string' ? points : JSON.stringify(points);
    const waypointsJson = typeof waypoints === 'string' ? waypoints : JSON.stringify(waypoints ?? []);
    // Sprint 67 Story-528: persist routes.permission (added by migration 018).
    // Caller (routes.js POST handler) has already rejected 'public' per v4 H1
    // and rejected unknown values. Accept ('personal','friend') and default to
    // 'personal' when undefined to preserve previous behavior.
    const perm = permission === 'friend' ? 'friend' : 'personal';
    const originHash = geometryHash(points);
    const hasActivityOrigin = Boolean(sourceActivityClientId || sourceSessionId);

    // Match Activity deletion's users-row/session-row lock order. A Route
    // either commits before deletion (and legitimately survives it) or the
    // deletion wins and this mutation is rejected; there is no check/create
    // race that can turn a deleted Detail into a new Route.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      if (clientRouteId) {
        const [tombstones] = await conn.execute(
          `SELECT client_route_id FROM route_client_tombstones
           WHERE user_id = ? AND client_route_id = ? FOR UPDATE`,
          [userId, clientRouteId],
        );
        if (tombstones[0]) {
          const error = new Error('Route was deleted by the client.');
          error.code = 'ROUTE_TOMBSTONED';
          throw error;
        }
      }

      let sourceId = null;
      let sourceClientId = sourceActivityClientId ?? null;
      let sourceGeometryHash = null;
      if (hasActivityOrigin) {
        const [activities] = sourceActivityClientId
          ? await conn.execute(
          `SELECT id, client_activity_id, route_points FROM sessions
           WHERE user_id = ? AND client_activity_id = ? AND finalized_at IS NOT NULL
           LIMIT 1 FOR UPDATE`,
          [userId, sourceActivityClientId],
          )
          : await conn.execute(
          `SELECT id, client_activity_id, route_points FROM sessions
           WHERE user_id = ? AND id = ? AND finalized_at IS NOT NULL
           LIMIT 1 FOR UPDATE`,
          [userId, sourceSessionId],
          );
        if (!activities[0]) {
          let code = 'SOURCE_ACTIVITY_NOT_FOUND';
          if (sourceActivityClientId) {
            const [deleted] = await conn.execute(
              `SELECT client_activity_id FROM activity_client_tombstones
               WHERE user_id = ? AND client_activity_id = ? LIMIT 1`,
              [userId, sourceActivityClientId],
            );
            if (deleted[0]) {
              code = 'SOURCE_ACTIVITY_DELETED';
            } else {
              const [known] = await conn.execute(
                `SELECT user_id, finalized_at FROM sessions
                 WHERE client_activity_id = ? LIMIT 1`,
                [sourceActivityClientId],
              );
              if (known[0]?.user_id !== undefined && known[0].user_id !== userId) {
                code = 'SOURCE_ACTIVITY_UNAUTHORIZED';
              } else if (known[0] && !known[0].finalized_at) {
                code = 'SOURCE_ACTIVITY_NOT_READY';
              }
            }
          } else if (sourceSessionId) {
            const [known] = await conn.execute(
              'SELECT user_id, finalized_at FROM sessions WHERE id = ? LIMIT 1',
              [sourceSessionId],
            );
            if (!known[0]) code = 'SOURCE_ACTIVITY_DELETED';
            else if (known[0].user_id !== userId) code = 'SOURCE_ACTIVITY_UNAUTHORIZED';
            else if (!known[0].finalized_at) code = 'SOURCE_ACTIVITY_NOT_READY';
          }
          const error = new Error(code === 'SOURCE_ACTIVITY_NOT_READY'
            ? 'Source Activity has not completed syncing.'
            : 'Source Activity is not available.');
          error.code = code;
          throw error;
        }
        sourceId = activities[0].id;
        sourceClientId = activities[0].client_activity_id ?? sourceClientId;
        sourceGeometryHash = geometryHash(activities[0].route_points ?? []);
      }

      let routeId = null;
      if (clientRouteId) {
        const [existing] = await conn.execute(
          `SELECT id, created_geometry_hash, permission, audience_epoch FROM routes
           WHERE user_id = ? AND client_route_id = ? LIMIT 1 FOR UPDATE`,
          [userId, clientRouteId],
        );
        if (existing[0]) {
          // A retry after response loss may carry a newer durable local draft.
          // Converge mutable Route content while the server-owned origin fields
          // remain immutable. This is safe because client_route_id is unique per
          // owner and ordinary update cannot rewrite provenance.
          const edited = existing[0].created_geometry_hash !== originHash ? 1 : 0;
          const permissionChanged = existing[0].permission !== perm;
          if (permissionChanged) {
            await conn.execute(
              `UPDATE route_audience_epochs SET ends_at = UTC_TIMESTAMP(3)
                WHERE route_id = ? AND audience_epoch = ? AND ends_at IS NULL`,
              [existing[0].id, existing[0].audience_epoch],
            );
          }
          await conn.execute(
            `UPDATE routes
             SET name = ?, description = ?, points = CAST(? AS JSON),
                 waypoints = CAST(? AS JSON), distance_m = ?, elevation_gain_m = ?,
                 permission = ?, geometry_edited_since_creation = GREATEST(geometry_edited_since_creation, ?),
                 audience_epoch = audience_epoch + ?,
                 audience_changed_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP(3) ELSE audience_changed_at END,
                 updated_at = NOW()
             WHERE id = ? AND user_id = ?`,
            [name, description ?? null, pointsJson, waypointsJson, distanceM ?? 0,
              elevationGainM ?? 0, perm, edited, permissionChanged ? 1 : 0,
              permissionChanged ? 1 : 0, existing[0].id, userId],
          );
          routeId = existing[0].id;
        }
      }
      if (!routeId) {
        const [result] = await conn.execute(
          `INSERT INTO routes
           (user_id, client_route_id, creation_origin, source_activity_client_id,
            source_session_id, origin_geometry_hash, created_geometry_hash, geometry_edited_since_creation,
            origin_gap_reconnected, name, description, points, waypoints,
            distance_m, elevation_gain_m, permission)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?)`,
          [userId, clientRouteId ?? null, hasActivityOrigin ? 'activity' : 'manual',
            sourceClientId, sourceId, sourceGeometryHash ?? originHash, originHash,
            originGapReconnected ? 1 : 0, name, description ?? null, pointsJson,
            waypointsJson, distanceM ?? 0, elevationGainM ?? 0, perm],
        );
        routeId = result.insertId;
      }
      await conn.execute(
        `INSERT IGNORE INTO route_audience_epochs
           (route_id, owner_id, audience_epoch, visibility, starts_at)
         SELECT id, user_id, audience_epoch,
                CASE WHEN permission = 'friend' THEN 'friend' ELSE 'personal' END,
                audience_changed_at
           FROM routes WHERE id = ? AND user_id = ?`,
        [routeId, userId],
      );
      await conn.commit();
      return routeId;
    } catch (error) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw error;
    } finally {
      conn.release();
    }
  },

  // List — omits heavy points JSON for performance
  async findByUser(userId) {
    const [rows] = await pool.execute(
      `SELECT id, user_id, client_route_id, creation_origin,
              source_activity_client_id, source_session_id, origin_geometry_hash,
              created_geometry_hash, geometry_edited_since_creation, origin_gap_reconnected,
              name, description, distance_m, elevation_gain_m, run_count, last_run_at, permission, created_at, updated_at
       FROM routes WHERE user_id = ? ORDER BY run_count DESC, created_at DESC`,
      [userId]
    );
    return rows;
  },

  // Detail — includes full points + waypoints
  async findByIdAndUser(id, userId) {
    const [rows] = await pool.execute(
      `SELECT id, user_id, client_route_id, creation_origin,
              source_activity_client_id, source_session_id, origin_geometry_hash,
              created_geometry_hash, geometry_edited_since_creation, origin_gap_reconnected,
              name, description, points, waypoints, distance_m, elevation_gain_m, run_count, last_run_at, permission, created_at, updated_at
       FROM routes WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    return {
      ...r,
      points:    parseJsonCol(r.points)    ?? [],
      waypoints: parseJsonCol(r.waypoints) ?? [],
    };
  },

  async update(id, userId, { name, description, points, waypoints, distanceM, elevationGainM, permission }) {
    const conn = await pool.getConnection();
    const updates = [];
    const values = [];
    try {
      await conn.beginTransaction();
      const [currentRows] = await conn.execute(
        `SELECT id, permission, audience_epoch FROM routes
          WHERE id = ? AND user_id = ? FOR UPDATE`,
        [id, userId],
      );
      if (!currentRows[0]) {
        await conn.rollback();
        return 0;
      }
      const current = currentRows[0];
      if (name !== undefined)           { updates.push('name = ?');             values.push(name); }
      if (description !== undefined)    { updates.push('description = ?');      values.push(description); }
      if (points !== undefined) {
        updates.push('points = ?');
        values.push(JSON.stringify(points));
        updates.push('geometry_edited_since_creation = CASE WHEN created_geometry_hash IS NULL OR created_geometry_hash <> ? THEN 1 ELSE geometry_edited_since_creation END');
        values.push(geometryHash(points));
      }
      if (waypoints !== undefined)      { updates.push('waypoints = ?');        values.push(JSON.stringify(waypoints)); }
      if (distanceM !== undefined)      { updates.push('distance_m = ?');       values.push(distanceM); }
      if (elevationGainM !== undefined) { updates.push('elevation_gain_m = ?'); values.push(elevationGainM); }
      if (permission !== undefined && (permission === 'personal' || permission === 'friend')) {
        updates.push('permission = ?');
        values.push(permission);
        if (permission !== current.permission) {
          await conn.execute(
            `UPDATE route_audience_epochs SET ends_at = UTC_TIMESTAMP(3)
              WHERE route_id = ? AND audience_epoch = ? AND ends_at IS NULL`,
            [id, current.audience_epoch],
          );
          updates.push('audience_epoch = audience_epoch + 1');
          updates.push('audience_changed_at = UTC_TIMESTAMP(3)');
        }
      }
      if (updates.length === 0) {
        await conn.rollback();
        return 0;
      }
      updates.push('updated_at = NOW()');
      values.push(id, userId);
      const [result] = await conn.execute(
        `UPDATE routes SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
        values,
      );
      await conn.execute(
        `INSERT IGNORE INTO route_audience_epochs
           (route_id, owner_id, audience_epoch, visibility, starts_at)
         SELECT id, user_id, audience_epoch,
                CASE WHEN permission = 'friend' THEN 'friend' ELSE 'personal' END,
                audience_changed_at
           FROM routes WHERE id = ? AND user_id = ?`,
        [id, userId],
      );
      await conn.commit();
      return result.affectedRows;
    } catch (error) {
      try { await conn.rollback(); } catch { /* noop */ }
      throw error;
    } finally {
      conn.release();
    }
  },

  async delete(id, userId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [owned] = await conn.execute(
        'SELECT id FROM routes WHERE id = ? AND user_id = ? FOR UPDATE',
        [id, userId],
      );
      if (!owned[0]) {
        await conn.rollback();
        return 0;
      }
      await conn.execute('DELETE FROM shared_route_leases WHERE route_id = ?', [id]);
      await conn.execute('DELETE FROM route_audience_epochs WHERE route_id = ?', [id]);
      const [result] = await conn.execute('DELETE FROM routes WHERE id = ? AND user_id = ?', [id, userId]);
      await conn.commit();
      return result.affectedRows;
    } catch (error) {
      try { await conn.rollback(); } catch { /* noop */ }
      throw error;
    } finally {
      conn.release();
    }
  },

  async deleteByClientId(clientRouteId, userId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
      await conn.execute(
        `INSERT INTO route_client_tombstones (user_id, client_route_id)
         VALUES (?, ?) ON DUPLICATE KEY UPDATE deleted_at = deleted_at`,
        [userId, clientRouteId],
      );
      const [owned] = await conn.execute(
        `SELECT id FROM routes WHERE user_id = ? AND client_route_id = ? FOR UPDATE`,
        [userId, clientRouteId],
      );
      if (owned[0]) {
        await conn.execute('DELETE FROM shared_route_leases WHERE route_id = ?', [owned[0].id]);
        await conn.execute('DELETE FROM route_audience_epochs WHERE route_id = ?', [owned[0].id]);
      }
      const [result] = await conn.execute(
        'DELETE FROM routes WHERE user_id = ? AND client_route_id = ?',
        [userId, clientRouteId],
      );
      await conn.commit();
      return result.affectedRows;
    } catch (error) {
      try { await conn.rollback(); } catch { /* ignore */ }
      throw error;
    } finally {
      conn.release();
    }
  },

  async incrementRunCount(id, userId) {
    const [result] = await pool.execute(
      'UPDATE routes SET run_count = run_count + 1, last_run_at = NOW() WHERE id = ? AND user_id = ?',
      [id, userId]
    );
    return result.affectedRows;
  },
};

module.exports = Route;
module.exports.geometryHash = geometryHash;
