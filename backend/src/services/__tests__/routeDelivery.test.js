'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  deliverRoute,
  findDelivery,
  listDeliveries,
  removeDelivery,
} = require('../routeDelivery');

function fixturePool() {
  const state = {
    route: {
      id: 10,
      user_id: 1,
      client_route_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: 'Harbour loop',
      description: 'Plan only',
      points: [{ lat: -41.29, lng: 174.77 }, { lat: -41.28, lng: 174.78 }],
      ordered_draft: {
        schemaVersion: 1, draftId: 'draft-1', ownerId: '1', origin: 'plan', revision: 2,
        parts: [{ id: 'p1', resolution: 'draw-manual', points: [{ lat: -41.29, lng: 174.77 }, { lat: -41.28, lng: 174.78 }] }],
        gaps: [],
      },
      resolution_state: 'continuous',
      distance_m: 1200,
      elevation_gain_m: 40,
      content_revision: 3,
    },
    friends: new Set(['1:2', '2:1', '1:3', '3:1']),
    deliveries: [],
    users: new Map([[1, 'Author'], [2, 'Bee'], [3, 'Cee'], [4, 'No friend']]),
  };

  async function execute(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim();
    if (compact.startsWith('SELECT id, user_id, client_route_id')) {
      return [[state.route && state.route.id === params[0] && state.route.user_id === params[1]
        ? { ...state.route }
        : undefined].filter(Boolean)];
    }
    if (compact.startsWith('SELECT friend.friend_id')) {
      const mutual = state.friends.has(`${params[0]}:${params[1]}`)
        && state.friends.has(`${params[1]}:${params[0]}`);
      return [[mutual ? { friend_id: params[1] } : undefined].filter(Boolean)];
    }
    if (compact.includes('WHERE sender_id = ? AND recipient_id = ? AND idempotency_key = ?')) {
      return [[state.deliveries.find(row => row.sender_id === params[0]
        && row.recipient_id === params[1] && row.idempotency_key === params[2])].filter(Boolean)];
    }
    if (compact.includes('AND source_route_key = ? AND content_hash = ?')) {
      return [[state.deliveries.find(row => row.sender_id === params[0]
        && row.recipient_id === params[1] && row.source_route_key === params[2]
        && row.content_hash === params[3])].filter(Boolean)];
    }
    if (compact.includes('AND (idempotency_key = ? OR (source_route_key = ? AND content_hash = ?))')) {
      return [[state.deliveries.find(row => row.sender_id === params[0]
        && row.recipient_id === params[1]
        && (row.idempotency_key === params[2]
          || (row.source_route_key === params[3] && row.content_hash === params[4])))].filter(Boolean)];
    }
    if (compact.startsWith('INSERT INTO shared_route_deliveries')) {
      const [id, sender_id, recipient_id, source_route_id, source_route_key,
        source_content_revision, content_hash, idempotency_key, snapshot] = params;
      state.deliveries.push({
        id, sender_id, recipient_id, source_route_id, source_route_key,
        source_content_revision, content_hash, idempotency_key,
        route_snapshot: JSON.parse(snapshot), removed_at: null,
        delivered_at: `2026-10-13T00:00:0${state.deliveries.length}.000Z`,
      });
      return [{ affectedRows: 1 }];
    }
    if (compact.startsWith('SELECT delivery.*, sender.name')) {
      let rows = state.deliveries.filter(row => row.removed_at == null);
      if (compact.includes('delivery.id = ?')) {
        rows = rows.filter(row => row.id === params[0] && row.recipient_id === params[1]);
      } else {
        rows = rows.filter(row => row.recipient_id === params[0]);
      }
      return [rows.map(row => ({ ...row, sender_name: state.users.get(row.sender_id) }))];
    }
    if (compact.startsWith('UPDATE shared_route_deliveries SET removed_at')) {
      const row = state.deliveries.find(item => item.id === params[0] && item.recipient_id === params[1]);
      if (row && !row.removed_at) row.removed_at = '2026-10-13T01:00:00.000Z';
      return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error(`Unhandled SQL: ${compact}`);
  }
  const connection = {
    execute,
    query: async () => [{ affectedRows: 0 }],
    beginTransaction: async () => undefined,
    commit: async () => undefined,
    rollback: async () => undefined,
    release: () => undefined,
  };
  return { state, execute, getConnection: async () => connection };
}

const keyA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('accepted recipients receive immutable minimal snapshots with partial failure', async () => {
  const pool = fixturePool();
  const result = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2, 4], idempotencyKey: keyA,
  });
  assert.equal(result.delivered.length, 1);
  assert.equal(result.delivered[0].code, 'DELIVERED');
  assert.deepEqual(result.failed, [{ recipient_id: '4', code: 'RECIPIENT_NOT_ELIGIBLE' }]);
  const snapshot = pool.state.deliveries[0].route_snapshot;
  assert.equal(snapshot.source.sender_id, '1');
  assert.equal(snapshot.ordered_draft.parts[0].resolution, 'draw-manual');
  assert.equal('originActivityClientId' in snapshot, false);
  assert.equal('memory' in snapshot, false);
  assert.equal('cairns' in snapshot, false);
  assert.equal('fog' in snapshot, false);
});

test('identical retry is idempotent; revised content creates a second delivery', async () => {
  const pool = fixturePool();
  const first = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  const retry = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  assert.equal(retry.delivered[0].delivery_id, first.delivered[0].delivery_id);
  assert.equal(retry.delivered[0].code, 'ALREADY_DELIVERED');
  assert.equal(pool.state.deliveries.length, 1);

  pool.state.route.points = [...pool.state.route.points, { lat: -41.27, lng: 174.79 }];
  pool.state.route.ordered_draft.parts[0].points = pool.state.route.points;
  pool.state.route.content_revision = 4;
  const revised = await deliverRoute(pool, {
    senderId: 1,
    routeId: 10,
    recipientIds: [2],
    idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  });
  assert.equal(revised.delivered[0].code, 'DELIVERED');
  assert.equal(pool.state.deliveries.length, 2);
  assert.notEqual(pool.state.deliveries[0].content_hash, pool.state.deliveries[1].content_hash);
  assert.equal(pool.state.deliveries[0].route_snapshot.points.length, 2);
});

test('revision-only changes do not manufacture a duplicate content delivery', async () => {
  const pool = fixturePool();
  const first = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  pool.state.route.content_revision = 99;
  const retry = await deliverRoute(pool, {
    senderId: 1,
    routeId: 10,
    recipientIds: [2],
    idempotencyKey: 'abababab-abab-4bab-8bab-abababababab',
  });
  assert.equal(retry.delivered[0].delivery_id, first.delivered[0].delivery_id);
  assert.equal(retry.delivered[0].code, 'ALREADY_DELIVERED');
  assert.equal(pool.state.deliveries.length, 1);
});

test('recipient removal is durable and exact re-share never resurrects it', async () => {
  const pool = fixturePool();
  const first = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  const deliveryId = first.delivered[0].delivery_id;
  assert.equal(await removeDelivery(pool, 2, deliveryId), true);
  const retry = await deliverRoute(pool, {
    senderId: 1,
    routeId: 10,
    recipientIds: [2],
    idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  });
  assert.equal(retry.delivered[0].code, 'REMOVED_NOT_RESTORED');
  assert.equal((await listDeliveries(pool, 2)).length, 0);
  assert.equal(await findDelivery(pool, 2, deliveryId), null);
});

test('unfriending changes future delivery only and leaves received history intact', async () => {
  const pool = fixturePool();
  const first = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  const deliveryId = first.delivered[0].delivery_id;
  pool.state.friends.delete('1:2');
  pool.state.route.points = [...pool.state.route.points, { lat: -41.27, lng: 174.79 }];
  pool.state.route.ordered_draft.parts[0].points = pool.state.route.points;
  const next = await deliverRoute(pool, {
    senderId: 1,
    routeId: 10,
    recipientIds: [2],
    idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  });
  assert.deepEqual(next.failed, [{ recipient_id: '2', code: 'RECIPIENT_NOT_ELIGIBLE' }]);
  assert.equal((await findDelivery(pool, 2, deliveryId)).route.points.length, 2);
});

test('ordinary source deletion or mutation cannot change an existing snapshot', async () => {
  const pool = fixturePool();
  const first = await deliverRoute(pool, {
    senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA,
  });
  const deliveryId = first.delivered[0].delivery_id;
  pool.state.route = null;
  pool.state.deliveries[0].source_route_id = null; // ON DELETE SET NULL
  const delivery = await findDelivery(pool, 2, deliveryId);
  assert.equal(delivery.route.name, 'Harbour loop');
  assert.equal(delivery.route.points.length, 2);
});

test('unresolved multipart drafts cannot be shared', async () => {
  const pool = fixturePool();
  const first = pool.state.route.ordered_draft.parts[0];
  const second = {
    id: 'p2', resolution: 'draw-manual',
    points: [{ lat: -41.2, lng: 174.9 }, { lat: -41.19, lng: 174.91 }],
  };
  pool.state.route.ordered_draft.parts = [first, second];
  pool.state.route.ordered_draft.gaps = [{ id: 'gap-1', afterPartId: first.id, reason: 'activity-gap' }];
  pool.state.route.points = [...first.points, ...second.points];
  pool.state.route.resolution_state = 'unresolved_gaps';
  await assert.rejects(
    deliverRoute(pool, { senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA }),
    error => error.code === 'ROUTE_UNRESOLVED_GAPS',
  );
  assert.equal(pool.state.deliveries.length, 0);
});

test('a poisoned flat shortcut cannot bypass ordered Route continuity at share time', async () => {
  const pool = fixturePool();
  pool.state.route.ordered_draft.parts[0].points = [
    pool.state.route.points[0],
    { lat: -40.1, lng: 175.9 },
    pool.state.route.points[1],
  ];
  await assert.rejects(
    deliverRoute(pool, { senderId: 1, routeId: 10, recipientIds: [2], idempotencyKey: keyA }),
    error => error.code === 'ROUTE_POINTS_MISMATCH',
  );
  assert.equal(pool.state.deliveries.length, 0);
});
