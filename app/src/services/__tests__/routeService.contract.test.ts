const mockAuthenticatedFetch = jest.fn();

jest.mock('../apiService', () => ({
  authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args),
}));

import {
  createRoute,
  deleteRoute,
  deleteRouteByClientId,
  fetchRouteDetail,
  updateRoute,
} from '../routeService';

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: jest.fn(async () => body),
});

const remote = {
  id: 42,
  user_id: 7,
  client_route_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  name: 'Ridge Route',
  description: null,
  points: [{ lat: -45, lng: 168 }, { lat: -45.001, lng: 168.001 }],
  waypoints: [],
  distance_m: 140,
  elevation_gain_m: 10,
  run_count: 0,
  last_run_at: null,
  permission: 'personal',
  creation_origin: 'activity',
  source_activity_client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source_session_id: 72,
  origin_geometry_hash: 'origin-hash',
  created_geometry_hash: 'created-hash',
  geometry_edited_since_creation: 1,
  origin_gap_reconnected: 1,
  created_at: '2026-09-17T00:00:00.000Z',
  updated_at: '2026-09-17T01:00:00.000Z',
};

describe('Route service origin and deployment compatibility', () => {
  beforeEach(() => mockAuthenticatedFetch.mockReset());

  test('modern detail maps durable server origin and current edit evidence', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(200, { route: remote }));
    await expect(fetchRouteDetail('42')).resolves.toMatchObject({
      id: '42',
      remoteId: '42',
      clientRouteId: remote.client_route_id,
      creationOrigin: 'activity',
      originActivityClientId: remote.source_activity_client_id,
      originActivityServerId: 72,
      originGeometryHash: 'origin-hash',
      createdGeometryHash: 'created-hash',
      geometryEditedSinceCreation: true,
      originActivityGapReconnected: true,
      originPersistence: 'durable',
    });
  });

  test('modern create sends stable identity without stale-response idempotency caching', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(201, { route: remote }));
    await createRoute({
      client_route_id: remote.client_route_id,
      name: remote.name,
      points: remote.points,
      distance_m: 140,
      elevation_gain_m: 10,
      source_activity_client_id: remote.source_activity_client_id,
      origin_gap_reconnected: true,
    }, remote.client_route_id);

    const [, options] = mockAuthenticatedFetch.mock.calls[0];
    expect(JSON.parse(options.body)).toMatchObject({
      client_route_id: remote.client_route_id,
      origin_gap_reconnected: true,
    });
    expect(options.headers).toBeUndefined();
  });

  test('old backend retry remains usable but strips fields it cannot persist', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(response(400, {
        error: 'Validation failed.',
        details: [{ field: 'client_route_id', message: 'not allowed' }],
      }))
      .mockResolvedValueOnce(response(201, { route: { ...remote, client_route_id: null, creation_origin: null } }));

    const local = await createRoute({
      client_route_id: remote.client_route_id,
      name: remote.name,
      points: remote.points,
      distance_m: 140,
      elevation_gain_m: 10,
      source_activity_client_id: remote.source_activity_client_id,
      origin_gap_reconnected: true,
    }, remote.client_route_id);

    const [, options] = mockAuthenticatedFetch.mock.calls[1];
    expect(JSON.parse(options.body)).not.toHaveProperty('client_route_id');
    expect(JSON.parse(options.body)).not.toHaveProperty('origin_gap_reconnected');
    expect(options.headers).toEqual({ 'X-Idempotency-Key': remote.client_route_id });
    expect(local).toMatchObject({ creationOrigin: 'legacy_unknown', originPersistence: 'unknown' });
  });

  test('update failure rejects instead of manufacturing success', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(503, { error: 'offline' }));
    await expect(updateRoute('42', { name: 'Draft' })).rejects.toThrow('Route update failed (503)');
  });

  test('generic 404 from client-identity delete is endpoint-unsupported, not confirmed deletion', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(404, {
      error: 'Cannot DELETE /api/routes/client/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    }));

    await expect(deleteRouteByClientId(remote.client_route_id)).resolves.toBe('unsupported');
  });

  test.each([
    [true, 'deleted'],
    [false, 'already-absent'],
  ] as const)('supported client delete deleted=%s returns %s', async (deleted, expected) => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(200, {
      ok: true,
      deleted,
      code: deleted ? 'ROUTE_DELETED' : 'ROUTE_ALREADY_ABSENT',
      client_route_id: remote.client_route_id,
    }));
    await expect(deleteRouteByClientId(remote.client_route_id)).resolves.toBe(expected);
  });

  test('a malformed success cannot falsely confirm client deletion', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(200, { ok: true }));
    await expect(deleteRouteByClientId(remote.client_route_id)).rejects.toMatchObject({
      code: 'ROUTE_DELETE_OUTCOME_UNKNOWN',
      outcomeUnknown: true,
    });
  });

  test('numeric delete accepts only structured owned-resource absence', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(response(404, {
        error: 'Route not found.', code: 'ROUTE_NOT_FOUND', route_id: 42,
      }))
      .mockResolvedValueOnce(response(404, { error: 'Not Found' }));
    await expect(deleteRoute('42')).resolves.toBe('already-absent');
    await expect(deleteRoute('42')).rejects.toMatchObject({
      code: 'ROUTE_DELETE_OUTCOME_UNKNOWN',
      outcomeUnknown: true,
    });
  });

  test.each([401, 403, 500, 503])('HTTP %s cannot become delete success', async (status) => {
    mockAuthenticatedFetch.mockResolvedValueOnce(response(status, { error: 'denied or unavailable' }));
    await expect(deleteRouteByClientId(remote.client_route_id)).rejects.toMatchObject({ status });
  });

  test('transport failure cannot become delete success', async () => {
    mockAuthenticatedFetch.mockRejectedValueOnce(new Error('network failed'));
    await expect(deleteRouteByClientId(remote.client_route_id)).rejects.toThrow('network failed');
  });

  test('a delete timeout is an explicitly unknown outcome', async () => {
    jest.useFakeTimers();
    try {
      mockAuthenticatedFetch.mockReturnValueOnce(new Promise(() => {}));
      const pending = deleteRouteByClientId(remote.client_route_id);
      const assertion = expect(pending).rejects.toMatchObject({
        code: 'ROUTE_REQUEST_TIMEOUT',
        outcomeUnknown: true,
      });
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
