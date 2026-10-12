'use strict';

const crypto = require('crypto');
const { authorizeRouteGeometry } = require('./routeGeometryAuthority');

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function deliverySnapshot(route) {
  return {
    schema_version: 1,
    name: route.name,
    description: route.description ?? null,
    points: parseJson(route.points, []),
    ordered_draft: parseJson(route.ordered_draft, null),
    resolution_state: route.resolution_state ?? 'continuous',
    distance_m: Number(route.distance_m ?? 0),
    elevation_gain_m: Number(route.elevation_gain_m ?? 0),
    source: {
      sender_id: String(route.user_id),
      route_key: route.client_route_id || `server:${route.id}`,
      content_revision: Number(route.content_revision ?? 1),
    },
  };
}

function snapshotHash(snapshot) {
  // Delivery identity is the content the recipient can use, not the sender's
  // mutable database revision counter. A permission-only write or retry with
  // an unchanged plan must not manufacture a second independent copy.
  const { content_revision: _revision, ...stableSource } = snapshot.source;
  return crypto.createHash('sha256').update(JSON.stringify({
    ...snapshot,
    source: stableSource,
  })).digest('hex');
}

function publicDelivery(row, includeSnapshot = false) {
  const snapshot = parseJson(row.route_snapshot, null);
  return {
    id: row.id,
    sender: { id: String(row.sender_id), name: row.sender_name ?? null },
    source_route_key: row.source_route_key,
    source_content_revision: Number(row.source_content_revision),
    content_hash: row.content_hash,
    delivered_at: row.delivered_at,
    read_only: true,
    ...(includeSnapshot ? { route: snapshot } : {
      name: snapshot?.name ?? 'Shared Route',
      distance_m: Number(snapshot?.distance_m ?? 0),
      resolution_state: snapshot?.resolution_state ?? 'continuous',
    }),
  };
}

async function acceptedFriendForUpdate(conn, senderId, recipientId) {
  const [rows] = await conn.execute(
    `SELECT friend.friend_id
       FROM friends friend
       JOIN friends reverse_friend
         ON reverse_friend.user_id = friend.friend_id
        AND reverse_friend.friend_id = friend.user_id
       JOIN users recipient ON recipient.id = friend.friend_id AND recipient.deleted_at IS NULL
      WHERE friend.user_id = ? AND friend.friend_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM blocked_users blocked
           WHERE (blocked.blocker_id = ? AND blocked.blocked_id = ?)
              OR (blocked.blocker_id = ? AND blocked.blocked_id = ?)
        )
      LIMIT 1 FOR SHARE`,
    [senderId, recipientId, senderId, recipientId, recipientId, senderId],
  );
  return Boolean(rows[0]);
}

async function deliverRoute(pool, {
  senderId,
  routeId,
  recipientIds,
  idempotencyKey,
}) {
  const conn = await pool.getConnection();
  const delivered = [];
  const failed = [];
  try {
    await conn.beginTransaction();
    const [routes] = await conn.execute(
      `SELECT id, user_id, client_route_id, name, description, points, ordered_draft,
              resolution_state, distance_m, elevation_gain_m, content_revision
         FROM routes WHERE id = ? AND user_id = ? LIMIT 1 FOR SHARE`,
      [routeId, senderId],
    );
    const route = routes[0];
    if (!route) {
      const error = new Error('Route not available');
      error.code = 'ROUTE_NOT_FOUND';
      throw error;
    }
    const authoritativeGeometry = authorizeRouteGeometry({
      ownerId: route.user_id,
      points: parseJson(route.points, []),
      orderedDraft: parseJson(route.ordered_draft, null),
      resolutionState: route.resolution_state,
    });
    if (authoritativeGeometry.resolutionState !== 'continuous') {
      const error = new Error('Repair Route gaps before sharing.');
      error.code = 'ROUTE_UNRESOLVED_GAPS';
      throw error;
    }
    const snapshot = deliverySnapshot(route);
    if (!Array.isArray(snapshot.points) || snapshot.points.length < 2) {
      const error = new Error('Route has no usable geometry.');
      error.code = 'ROUTE_NOT_USABLE';
      throw error;
    }
    const contentHash = snapshotHash(snapshot);
    const sourceRouteKey = snapshot.source.route_key;

    for (const [index, recipientId] of recipientIds.entries()) {
      const savepoint = `route_delivery_${index}`;
      await conn.query(`SAVEPOINT ${savepoint}`);
      try {
        if (String(recipientId) === String(senderId)
          || !(await acceptedFriendForUpdate(conn, senderId, recipientId))) {
          failed.push({ recipient_id: String(recipientId), code: 'RECIPIENT_NOT_ELIGIBLE' });
          await conn.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }
        const [attemptRows] = await conn.execute(
          `SELECT id, content_hash, removed_at FROM shared_route_deliveries
            WHERE sender_id = ? AND recipient_id = ? AND idempotency_key = ?
            LIMIT 1 FOR UPDATE`,
          [senderId, recipientId, idempotencyKey],
        );
        if (attemptRows[0]) {
          delivered.push({
            recipient_id: String(recipientId),
            delivery_id: attemptRows[0].id,
            code: attemptRows[0].removed_at ? 'REMOVED_NOT_RESTORED' : 'ALREADY_DELIVERED',
          });
          await conn.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }
        const [contentRows] = await conn.execute(
          `SELECT id, removed_at FROM shared_route_deliveries
            WHERE sender_id = ? AND recipient_id = ?
              AND source_route_key = ? AND content_hash = ?
            LIMIT 1 FOR UPDATE`,
          [senderId, recipientId, sourceRouteKey, contentHash],
        );
        if (contentRows[0]) {
          delivered.push({
            recipient_id: String(recipientId),
            delivery_id: contentRows[0].id,
            code: contentRows[0].removed_at ? 'REMOVED_NOT_RESTORED' : 'ALREADY_DELIVERED',
          });
          await conn.query(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }
        const deliveryId = crypto.randomUUID();
        await conn.execute(
          `INSERT INTO shared_route_deliveries
             (id, sender_id, recipient_id, source_route_id, source_route_key,
              source_content_revision, content_hash, idempotency_key, route_snapshot)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [deliveryId, senderId, recipientId, route.id, sourceRouteKey,
            snapshot.source.content_revision, contentHash, idempotencyKey,
            JSON.stringify(snapshot)],
        );
        delivered.push({ recipient_id: String(recipientId), delivery_id: deliveryId, code: 'DELIVERED' });
        await conn.query(`RELEASE SAVEPOINT ${savepoint}`);
      } catch (error) {
        await conn.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        if (error?.code === 'ER_DUP_ENTRY') {
          // A concurrent retry may win either unique key after our locking
          // read. Resolve that race to the already-created immutable snapshot
          // instead of reporting a false delivery failure.
          const [concurrentRows] = await conn.execute(
            `SELECT id, removed_at FROM shared_route_deliveries
              WHERE sender_id = ? AND recipient_id = ?
                AND (idempotency_key = ? OR (source_route_key = ? AND content_hash = ?))
              ORDER BY delivered_at ASC LIMIT 1 FOR UPDATE`,
            [senderId, recipientId, idempotencyKey, sourceRouteKey, contentHash],
          );
          if (concurrentRows[0]) {
            delivered.push({
              recipient_id: String(recipientId),
              delivery_id: concurrentRows[0].id,
              code: concurrentRows[0].removed_at ? 'REMOVED_NOT_RESTORED' : 'ALREADY_DELIVERED',
            });
          } else {
            failed.push({ recipient_id: String(recipientId), code: 'DELIVERY_FAILED' });
          }
        } else {
          failed.push({ recipient_id: String(recipientId), code: 'DELIVERY_FAILED' });
        }
        await conn.query(`RELEASE SAVEPOINT ${savepoint}`);
      }
    }
    await conn.commit();
    return { content_hash: contentHash, delivered, failed };
  } catch (error) {
    try { await conn.rollback(); } catch { /* noop */ }
    throw error;
  } finally {
    conn.release();
  }
}

async function listDeliveries(pool, recipientId) {
  const [rows] = await pool.execute(
    `SELECT delivery.*, sender.name AS sender_name
       FROM shared_route_deliveries delivery
       JOIN users sender ON sender.id = delivery.sender_id
      WHERE delivery.recipient_id = ? AND delivery.removed_at IS NULL
      ORDER BY delivery.delivered_at DESC, delivery.id DESC
      LIMIT 1000`,
    [recipientId],
  );
  return rows.map(row => publicDelivery(row, false));
}

async function findDelivery(pool, recipientId, deliveryId) {
  const [rows] = await pool.execute(
    `SELECT delivery.*, sender.name AS sender_name
       FROM shared_route_deliveries delivery
       JOIN users sender ON sender.id = delivery.sender_id
      WHERE delivery.id = ? AND delivery.recipient_id = ? AND delivery.removed_at IS NULL
      LIMIT 1`,
    [deliveryId, recipientId],
  );
  return rows[0] ? publicDelivery(rows[0], true) : null;
}

async function removeDelivery(pool, recipientId, deliveryId) {
  const [result] = await pool.execute(
    `UPDATE shared_route_deliveries SET removed_at = COALESCE(removed_at, UTC_TIMESTAMP(3))
      WHERE id = ? AND recipient_id = ?`,
    [deliveryId, recipientId],
  );
  return result.affectedRows > 0;
}

module.exports = {
  deliverRoute,
  deliverySnapshot,
  findDelivery,
  listDeliveries,
  publicDelivery,
  removeDelivery,
  snapshotHash,
};
