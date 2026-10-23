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

import {
  _resetAutomaticDiagnosticOutboxForTesting,
  captureAutomaticDiagnosticEvent,
  drainAutomaticDiagnosticOutbox,
  getAutomaticDiagnosticStatus,
  purgeAutomaticDiagnosticsForActivity,
  purgeAutomaticDiagnosticsForOwner,
} from '../automaticDiagnosticOutbox';

const event = (ordinal: number, ownerUserId = 'owner-a') => ({
  ownerUserId,
  stream: {
    streamId: 'activity-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sourceType: 'activity' as const,
    clientActivityId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    activityMode: 'hiking' as const,
  },
  eventCode: 'ACTIVITY_WAL_COMMITTED',
  sourceModule: 'activityStageLedger',
  severity: 'info' as const,
  eventAt: 1_000 + ordinal,
  monotonicMs: 100 + ordinal,
  details: { ordinal, acceptedCount: 1 },
});

async function authorizeTestOwner(ownerUserId: string) {
  mockCurrentOwner.value = ownerUserId;
  mockOnline.value = true;
  mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({
    enabled: true, tier: 'tier_a', consentVersion: 'owner-qa-v1', expiresAt: null,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await drainAutomaticDiagnosticOutbox(ownerUserId, { reason: 'hydrate' });
  mockAuthenticatedFetch.mockClear();
  mockOnline.value = false;
}

describe('automatic owner-scoped diagnostic outbox', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockOnline.value = false;
    mockCurrentOwner.value = 'owner-a';
    await AsyncStorage.clear();
    await _resetAutomaticDiagnosticOutboxForTesting();
    await authorizeTestOwner('owner-a');
  });

  afterEach(() => jest.restoreAllMocks());

  test('durably queues offline without HTTP and drains bounded batches on reconnect', async () => {
    const captureDurationsMs: number[] = [];
    for (let ordinal = 0; ordinal < 75; ordinal += 1) {
      const startedAt = performance.now();
      await captureAutomaticDiagnosticEvent(event(ordinal));
      captureDurationsMs.push(performance.now() - startedAt);
    }
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 75,
      droppedCount: 0,
      lastCapturedAt: 1_074,
      lastDurablyQueuedAt: expect.any(Number),
      lastServerAckAt: null,
      quality: 'UPLOAD_PENDING',
    });

    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true, batch_id: 'ack', duplicate: false, server_ingested_at: '2026-10-23T00:00:00.000Z',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const drained = await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'network_online' });
    expect(drained).toMatchObject({ acknowledgedEvents: 75, failedBatches: 0 });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    for (const [, request] of mockAuthenticatedFetch.mock.calls) {
      const body = JSON.parse(request.body);
      expect(body.events.length).toBeLessThanOrEqual(50);
      expect(body.batchId).toMatch(/^diag-v1-/);
      expect(body).not.toHaveProperty('ownerUserId');
    }
    const finalStatus = await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId);
    expect(finalStatus).toMatchObject({
      pendingCount: 0,
      lastServerAckAt: expect.any(Number),
      coverageStart: 1_000,
      coverageEnd: 1_074,
      sourceTypesAvailable: ['activity'],
      quality: 'SERVER_ACKED',
    });
    if (process.env.CAIRN_OUTBOX_BENCH_OUTPUT) {
      const sorted = captureDurationsMs.slice().sort((left, right) => left - right);
      const uploadBodies = mockAuthenticatedFetch.mock.calls.map(([, request]) => request.body as string);
      require('node:fs').writeFileSync(process.env.CAIRN_OUTBOX_BENCH_OUTPUT, `${JSON.stringify({
        schema: 'cairn-automatic-outbox-overhead-benchmark',
        runtime: 'jest-node-v8-with-asyncstorage-mock-not-iphone-hermes',
        events: 75,
        localStorageSetCalls: (AsyncStorage.setItem as jest.Mock).mock.calls.length,
        uploadRequests: uploadBodies.length,
        policyRequests: 1,
        uploadedJsonBytes: uploadBodies.reduce((sum, body) => sum + Buffer.byteLength(body), 0),
        captureP50Ms: Number(sorted[Math.floor(sorted.length * 0.50)].toFixed(4)),
        captureP95Ms: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(4)),
        captureMaxMs: Number(Math.max(...sorted).toFixed(4)),
        longTasksOver50Ms: sorted.filter(value => value > 50).length,
        finalStatus,
        nativeBatteryMeasured: false,
      }, null, 2)}\n`);
    }
  });

  test('keeps a stable idempotent batch after server failure and never crosses owners', async () => {
    const baseNow = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(baseNow);
    await captureAutomaticDiagnosticEvent(event(1, 'owner-a'));
    await authorizeTestOwner('owner-b');
    await captureAutomaticDiagnosticEvent(event(2, 'owner-b'));
    mockCurrentOwner.value = 'owner-a';
    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response('{}', { status: 503 }));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    const firstBody = JSON.parse(mockAuthenticatedFetch.mock.calls[0][1].body);
    now.mockReturnValue(baseNow + 100_000);
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    const retryBody = JSON.parse(mockAuthenticatedFetch.mock.calls[1][1].body);
    expect(retryBody.batchId).toBe(firstBody.batchId);
    expect(retryBody.events.map((item: any) => item.details.ordinal)).toEqual([1]);
    expect(await getAutomaticDiagnosticStatus('owner-b', event(0).stream.streamId)).toMatchObject({ pendingCount: 1 });
    now.mockRestore();
  });

  test('activity deletion and owner deletion fence queued evidence', async () => {
    await captureAutomaticDiagnosticEvent(event(1, 'owner-a'));
    await captureAutomaticDiagnosticEvent({
      ...event(2, 'owner-a'),
      stream: { ...event(2).stream, streamId: 'memory-session-a', sourceType: 'memory' as const, clientActivityId: undefined },
    });
    await purgeAutomaticDiagnosticsForActivity('owner-a', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 0, quality: 'NOT_CAPTURED',
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', 'memory-session-a')).toMatchObject({ pendingCount: 1 });
    await purgeAutomaticDiagnosticsForOwner('owner-a');
    expect((await AsyncStorage.getAllKeys()).some(key => key.includes('automatic-diagnostics'))).toBe(false);
  });

  test('bounds offline retention and exposes exact truncation rather than blocking capture', async () => {
    for (let ordinal = 0; ordinal < 700; ordinal += 1) {
      await captureAutomaticDiagnosticEvent(event(ordinal));
    }
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 600,
      droppedCount: 100,
      quality: 'RETENTION_TRUNCATED',
    });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });

  test('repairs a corrupted durable event as explicit truncation without stalling later evidence', async () => {
    await captureAutomaticDiagnosticEvent(event(1));
    await captureAutomaticDiagnosticEvent(event(2));
    const eventKeys = (await AsyncStorage.getAllKeys()).filter(key => key.includes(':event:')).sort();
    await AsyncStorage.setItem(eventKeys[0], '{not-json');

    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 1,
      droppedCount: 1,
      lastFailure: 'LOCAL_DIAGNOSTIC_EVENT_CORRUPT',
      quality: 'RETENTION_TRUNCATED',
    });
    expect(await AsyncStorage.getItem(eventKeys[0])).toBeNull();
  });

  test('fails soft on local write rejection and fences account-switch upload', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk-full'));
    await expect(captureAutomaticDiagnosticEvent(event(1))).resolves.toBeUndefined();
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 0,
      failedWriteCount: 1,
      quality: 'UNKNOWN',
    });
    await captureAutomaticDiagnosticEvent(event(2));
    mockOnline.value = true;
    mockCurrentOwner.value = 'owner-b';
    await expect(drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' })).resolves.toMatchObject({
      acknowledgedEvents: 0, skipped: true,
    });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();

    mockCurrentOwner.value = null;
    await expect(drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' })).resolves.toMatchObject({
      acknowledgedEvents: 0, skipped: true,
    });
    expect(mockAuthenticatedFetch).not.toHaveBeenCalled();
  });

  test('replays the same server-committed batch after local ACK persistence fails', async () => {
    const baseNow = Date.now();
    const now = jest.spyOn(Date, 'now').mockReturnValue(baseNow);
    await captureAutomaticDiagnosticEvent(event(1));
    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    (AsyncStorage.multiRemove as jest.Mock).mockRejectedValueOnce(new Error('ack-write-loss'));
    await expect(drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' })).resolves.toMatchObject({
      acknowledgedEvents: 0, failedBatches: 1,
    });
    const committed = JSON.parse(mockAuthenticatedFetch.mock.calls[0][1].body);
    now.mockReturnValue(baseNow + 100_000);
    await _resetAutomaticDiagnosticOutboxForTesting();
    await drainAutomaticDiagnosticOutbox('owner-a', { reason: 'foreground' });
    const replayed = JSON.parse(mockAuthenticatedFetch.mock.calls[1][1].body);
    expect(replayed.batchId).toBe(committed.batchId);
    expect(replayed.events).toEqual(committed.events);
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 0, quality: 'SERVER_ACKED',
    });
  });

  test('fails closed and erases queued evidence when the server revokes enrollment', async () => {
    await captureAutomaticDiagnosticEvent(event(1));
    mockOnline.value = true;
    mockAuthenticatedFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      code: 'DIAGNOSTIC_POLICY_DISABLED',
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }));

    await expect(drainAutomaticDiagnosticOutbox('owner-a', { reason: 'sync' })).resolves.toMatchObject({
      acknowledgedEvents: 0, failedBatches: 1,
    });
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 0, quality: 'POLICY_DISABLED',
    });
    await captureAutomaticDiagnosticEvent(event(2));
    expect(await getAutomaticDiagnosticStatus('owner-a', event(0).stream.streamId)).toMatchObject({
      pendingCount: 0, quality: 'POLICY_DISABLED',
    });
  });
});
