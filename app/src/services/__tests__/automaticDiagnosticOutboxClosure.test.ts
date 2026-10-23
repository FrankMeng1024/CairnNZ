import AsyncStorage from '@react-native-async-storage/async-storage';

const mockAuthenticatedFetch = jest.fn();
jest.mock('../apiService', () => ({ authenticatedFetch: (...args: any[]) => mockAuthenticatedFetch(...args) }));

const mockOnline = { value: false };
const mockCurrentOwner = { value: 'owner-a' as string | null };
jest.mock('../networkMonitor', () => ({
  __esModule: true,
  default: { isOnline: () => mockOnline.value },
  networkMonitor: { isOnline: () => mockOnline.value },
}));
jest.mock('../../store/useAppStore', () => ({
  useAppStore: { getState: () => ({ user: mockCurrentOwner.value ? { id: mockCurrentOwner.value } : null }) },
}));
jest.mock('../../features/activity/activityRegistry', () => ({
  isActivityTombstoned: jest.fn(async () => false),
}));
jest.mock('../routeTombstones', () => ({
  isRouteTombstoned: jest.fn(async () => false),
}));

import {
  _resetAutomaticDiagnosticOutboxForTesting,
  captureAutomaticDiagnosticEvent,
  drainAutomaticDiagnosticOutbox,
  getAutomaticDiagnosticStatus,
  purgeAutomaticDiagnosticsForActivity,
  purgeAutomaticDiagnosticsForRoute,
} from '../automaticDiagnosticOutbox';

const ACTIVITY_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function event(streamId: string, ordinal: number, sourceType: 'activity' | 'app' = 'app') {
  return {
    ownerUserId: 'owner-a',
    stream: {
      streamId,
      sourceType,
      ...(sourceType === 'activity' ? { clientActivityId: ACTIVITY_ID, activityMode: 'hiking' as const } : {}),
    },
    eventCode: 'DIAGNOSTIC_CLOSURE_EVENT',
    sourceModule: 'automaticDiagnosticOutboxClosure',
    eventAt: 1_761_177_600_000 + ordinal,
    details: { ordinal },
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

async function authorize(ownerUserId = 'owner-a', expiresAt: string | null = null) {
  mockCurrentOwner.value = ownerUserId;
  mockOnline.value = true;
  mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse({
    enabled: true,
    tier: 'tier_a',
    consentVersion: 'owner-qa-v1',
    expiresAt,
  }));
  await drainAutomaticDiagnosticOutbox(ownerUserId, { reason: 'hydrate' });
  mockAuthenticatedFetch.mockClear();
  mockOnline.value = false;
}

async function readOwnerMeta(ownerUserId = 'owner-a') {
  const key = (await AsyncStorage.getAllKeys()).find(item => (
    item.includes(`automatic-diagnostics:v1:${encodeURIComponent(ownerUserId)}:`) && item.endsWith(':meta')
  ));
  const raw = key ? await AsyncStorage.getItem(key) : null;
  return { key, raw, parsed: raw ? JSON.parse(raw) : null };
}

describe('automatic diagnostic pre-deployment closure', () => {
  jest.setTimeout(120_000);

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOnline.value = false;
    mockCurrentOwner.value = 'owner-a';
    await AsyncStorage.clear();
    await _resetAutomaticDiagnosticOutboxForTesting();
  });

  afterEach(() => jest.restoreAllMocks());

  test('fails closed before the first policy check and for absent or unauthorized policy endpoints', async () => {
    await captureAutomaticDiagnosticEvent(event('app:unknown-policy', 1));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:unknown-policy')).toMatchObject({
      pendingCount: 0,
      quality: 'UNKNOWN',
    });

    for (const status of [401, 403, 404]) {
      await AsyncStorage.clear();
      await _resetAutomaticDiagnosticOutboxForTesting();
      mockAuthenticatedFetch.mockReset();
      mockOnline.value = true;
      mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse({ code: `HTTP_${status}` }, status));
      await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'hydrate' });
      mockOnline.value = false;
      await captureAutomaticDiagnosticEvent(event(`app:policy-${status}`, status));
      expect(await getAutomaticDiagnosticStatus('owner-a', `app:policy-${status}`)).toMatchObject({
        pendingCount: 0,
        quality: 'UNKNOWN',
      });
    }
  });

  test('uses only a fresh cached enrollment offline and survives a process relaunch', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await authorize('owner-a', new Date(1_100_000).toISOString());
    await captureAutomaticDiagnosticEvent(event('app:cached-policy', 1));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:cached-policy')).toMatchObject({ pendingCount: 1 });

    await _resetAutomaticDiagnosticOutboxForTesting();
    await captureAutomaticDiagnosticEvent(event('app:after-relaunch', 2));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:after-relaunch')).toMatchObject({ pendingCount: 1 });

    now.mockReturnValue(1_100_001);
    await captureAutomaticDiagnosticEvent(event('app:expired-policy', 3));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:expired-policy')).toMatchObject({
      pendingCount: 0,
      quality: 'UNKNOWN',
    });

    mockOnline.value = true;
    mockAuthenticatedFetch.mockReset();
    mockAuthenticatedFetch
      .mockResolvedValueOnce(jsonResponse({
        enabled: true,
        tier: 'tier_a',
        consentVersion: 'owner-qa-v2',
        expiresAt: new Date(1_500_000).toISOString(),
      }))
      .mockResolvedValue(jsonResponse({ ok: true }));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    mockOnline.value = false;
    await captureAutomaticDiagnosticEvent(event('app:renewed-policy', 4));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:renewed-policy')).toMatchObject({ pendingCount: 1 });

    now.mockReturnValue(1_000_100);
    mockCurrentOwner.value = 'owner-b';
    await captureAutomaticDiagnosticEvent(event('app:stale-owner', 5));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:stale-owner')).toMatchObject({ pendingCount: 0 });
  });

  test('known disabled policy prevents capture and server revocation erases already queued evidence', async () => {
    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse({ enabled: false, tier: 'disabled' }));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'hydrate' });
    mockOnline.value = false;
    await captureAutomaticDiagnosticEvent(event('app:disabled', 1));
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:disabled')).toMatchObject({
      pendingCount: 0,
      quality: 'POLICY_DISABLED',
    });

    await AsyncStorage.clear();
    await _resetAutomaticDiagnosticOutboxForTesting();
    mockAuthenticatedFetch.mockReset();
    await authorize();
    await captureAutomaticDiagnosticEvent(event('app:revoked', 2));
    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValueOnce(jsonResponse({ code: 'DIAGNOSTIC_POLICY_DISABLED' }, 403));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:revoked')).toMatchObject({
      pendingCount: 0,
      quality: 'POLICY_DISABLED',
    });
  });

  test('quarantines permanent 400/413 failures, truncates oversized details, and drains another stream', async () => {
    await authorize();
    const hugeDetails = Object.fromEntries(Array.from({ length: 700 }, (_, index) => [`metric_${index}`, index]));
    await captureAutomaticDiagnosticEvent({ ...event('app:bad-413', 1), details: hugeDetails });
    await captureAutomaticDiagnosticEvent(event('app:bad-400', 2));
    await captureAutomaticDiagnosticEvent(event('app:valid', 3));
    mockOnline.value = true;
    const attempted: Array<{ streamId: string; body: any }> = [];
    mockAuthenticatedFetch.mockImplementation(async (_path: string, request: any) => {
      const body = JSON.parse(request.body);
      attempted.push({ streamId: body.stream.streamId, body });
      if (body.stream.streamId === 'app:bad-413') {
        return jsonResponse({ code: 'DIAGNOSTIC_EVENT_TOO_LARGE' }, 413);
      }
      if (body.stream.streamId === 'app:bad-400') {
        return jsonResponse({ code: 'DIAGNOSTIC_SCHEMA_INVALID' }, 400);
      }
      return jsonResponse({ ok: true });
    });
    const result = await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect(result).toMatchObject({ acknowledgedEvents: 1, failedBatches: 2 });
    expect(attempted.map(item => item.streamId)).toEqual(['app:bad-413', 'app:bad-400', 'app:valid']);
    expect(Buffer.byteLength(JSON.stringify(attempted[0].body.events[0].details))).toBeLessThanOrEqual(8 * 1024);
    expect(attempted[0].body.events[0].details).toMatchObject({ diagnosticDetailsTruncated: true });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:bad-413')).toMatchObject({
      pendingCount: 1,
      quality: 'UPLOAD_INCOMPLETE',
      quarantinedCount: 1,
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:bad-400')).toMatchObject({
      pendingCount: 1,
      quality: 'UPLOAD_INCOMPLETE',
      quarantinedCount: 1,
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:valid')).toMatchObject({ pendingCount: 0 });

    mockAuthenticatedFetch.mockClear();
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });

  test('keeps Tier A uploads free of nested coordinates, indirect aliases, credentials and free text', async () => {
    await authorize();
    await captureAutomaticDiagnosticEvent({
      ...event('app:privacy', 1),
      details: {
        accuracyM: 7,
        nested: {
          path: [[174.7633, -36.8485]],
          destinationLongitude: 174.7633,
          center_lat: -36.8485,
          accessToken: 'secret-token',
          note: 'private free text',
        },
      },
    });
    mockOnline.value = true;
    let uploaded = '';
    mockAuthenticatedFetch.mockImplementation(async (_path: string, request: any) => {
      uploaded = request.body;
      return jsonResponse({ ok: true });
    });
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect(uploaded).toContain('accuracyM');
    expect(uploaded).not.toMatch(/174\.7633|-36\.8485|secret-token|private free text/);
  });

  test('applies independent 503/429 backoff without starving eligible streams and stops globally on 401', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(50_000_000);
    await authorize();
    await captureAutomaticDiagnosticEvent(event('app:retry-503', 1));
    await captureAutomaticDiagnosticEvent(event('app:retry-429', 2));
    await captureAutomaticDiagnosticEvent(event('app:valid-after-retry', 3));
    mockOnline.value = true;
    mockAuthenticatedFetch.mockImplementation(async (_path: string, request: any) => {
      const streamId = JSON.parse(request.body).stream.streamId;
      if (streamId === 'app:retry-503') return jsonResponse({ code: 'TEMPORARY' }, 503);
      if (streamId === 'app:retry-429') return jsonResponse({ code: 'RATE_LIMIT' }, 429, { 'Retry-After': '120' });
      return jsonResponse({ ok: true });
    });
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:valid-after-retry')).toMatchObject({ pendingCount: 0 });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:retry-503')).toMatchObject({
      pendingCount: 1,
      nextAttemptAt: expect.any(Number),
    });
    expect((await getAutomaticDiagnosticStatus('owner-a', 'app:retry-429')).nextAttemptAt).toBeGreaterThanOrEqual(50_120_000);

    await captureAutomaticDiagnosticEvent(event('app:auth-401-a', 4));
    await captureAutomaticDiagnosticEvent(event('app:auth-401-b', 5));
    now.mockReturnValue(50_200_000);
    mockAuthenticatedFetch.mockReset();
    mockAuthenticatedFetch.mockResolvedValue(jsonResponse({ code: 'AUTH_REQUIRED' }, 401));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:auth-401-b')).toMatchObject({ pendingCount: 1 });
  });

  test('continues after Activity/Route 410 and fences an owner change while a request is in flight', async () => {
    await authorize();
    await captureAutomaticDiagnosticEvent(event('activity:tombstoned', 1, 'activity'));
    await captureAutomaticDiagnosticEvent({
      ...event('route:tombstoned', 2),
      stream: {
        streamId: 'route:tombstoned',
        sourceType: 'route',
        clientRouteId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        routeEditSessionId: 'route-edit-tombstoned',
      },
    });
    await captureAutomaticDiagnosticEvent(event('app:after-tombstone', 3));
    mockOnline.value = true;
    mockAuthenticatedFetch.mockImplementation(async (_path: string, request: any) => {
      const streamId = JSON.parse(request.body).stream.streamId;
      if (streamId === 'activity:tombstoned') {
        return jsonResponse({ code: 'DIAGNOSTIC_ACTIVITY_DELETED' }, 410);
      }
      if (streamId === 'route:tombstoned') {
        return jsonResponse({ code: 'DIAGNOSTIC_ROUTE_DELETED' }, 410);
      }
      return jsonResponse({ ok: true });
    });
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'activity:tombstoned')).toMatchObject({ pendingCount: 0 });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'route:tombstoned')).toMatchObject({ pendingCount: 0 });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:after-tombstone')).toMatchObject({ pendingCount: 0 });

    await captureAutomaticDiagnosticEvent(event('app:owner-change-a', 4));
    await captureAutomaticDiagnosticEvent(event('app:owner-change-b', 5));
    mockAuthenticatedFetch.mockReset();
    mockAuthenticatedFetch.mockImplementationOnce(async () => {
      mockCurrentOwner.value = 'owner-b';
      return jsonResponse({ ok: true });
    });
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:owner-change-a')).toMatchObject({ pendingCount: 0 });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'app:owner-change-b')).toMatchObject({ pendingCount: 1 });
  });

  test('bounds 1000 ACK-only stream metadata and deletes ACKed Activity metadata', async () => {
    mockOnline.value = true;
    mockAuthenticatedFetch.mockImplementation(async (path: string) => (
      path.endsWith('/policy')
        ? jsonResponse({ enabled: true, tier: 'tier_a', consentVersion: 'owner-qa-v1', expiresAt: null })
        : jsonResponse({ ok: true })
    ));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'hydrate' });
    const snapshots: Record<string, { bytes: number; streamCount: number }> = {};
    for (let ordinal = 1; ordinal <= 1_000; ordinal += 1) {
      await captureAutomaticDiagnosticEvent(event(`app:acked-${ordinal}`, ordinal));
      await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
      if (ordinal === 1 || ordinal === 100 || ordinal === 1_000) {
        const meta = await readOwnerMeta();
        snapshots[String(ordinal)] = {
          bytes: Buffer.byteLength(meta.raw ?? ''),
          streamCount: Object.keys(meta.parsed?.streams ?? {}).length,
        };
      }
    }
    if (process.env.CAIRN_METADATA_BENCH_OUTPUT) {
      require('node:fs').writeFileSync(process.env.CAIRN_METADATA_BENCH_OUTPUT, `${JSON.stringify({
        schema: 'cairn-automatic-diagnostic-metadata-benchmark',
        runtime: 'jest-node-v8-with-asyncstorage-mock-not-iphone-hermes',
        acknowledgedDistinctStreams: 1_000,
        snapshots,
      }, null, 2)}\n`);
    }
    expect(snapshots['1000'].streamCount).toBeLessThanOrEqual(128);

    await captureAutomaticDiagnosticEvent(event('activity:acked-delete', 1_001, 'activity'));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect((await readOwnerMeta()).parsed.streams['activity:acked-delete']).toBeDefined();
    await purgeAutomaticDiagnosticsForActivity('owner-a', ACTIVITY_ID);
    expect((await readOwnerMeta()).parsed.streams['activity:acked-delete']).toBeUndefined();

    await captureAutomaticDiagnosticEvent({
      ...event('route:acked-delete', 1_002),
      stream: {
        streamId: 'route:acked-delete',
        sourceType: 'route',
        clientRouteId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        routeEditSessionId: 'route-edit-acked-delete',
      },
    });
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' });
    expect((await readOwnerMeta()).parsed.streams['route:acked-delete']).toBeDefined();
    await purgeAutomaticDiagnosticsForRoute('owner-a', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect((await readOwnerMeta()).parsed.streams['route:acked-delete']).toBeUndefined();
  });
});
