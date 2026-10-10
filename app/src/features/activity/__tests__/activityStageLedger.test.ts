import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-application', () => ({
  nativeApplicationVersion: '0.2.6',
  nativeBuildVersion: '63',
  applicationId: 'com.yiiling.cairn',
}));
jest.mock('expo-updates', () => ({
  updateId: 'update-field03',
  runtimeVersion: '0.2.6-o66',
  channel: 'production',
  isEmbeddedLaunch: false,
  isEmergencyLaunch: false,
}));

import {
  activityStageLedgerOwnerPrefix,
  exportLatestActivityStageLedger,
  flushActivityStageLedger,
  purgeActivityStageLedgerForOwner,
  recordActivityStageEvent,
  summarizeActivityObservability,
} from '../activityStageLedger';

describe('local owner-exportable Activity stage ledger', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    const values = (globalThis as any).__cairnTestAsyncStorage as Map<string, string>;
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => values.get(key) ?? null);
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => { values.set(key, value); });
    (AsyncStorage.getAllKeys as jest.Mock).mockImplementation(async () => [...values.keys()]);
    (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => keys.forEach(key => values.delete(key)));
    for (const owner of ['owner-a', 'owner-b', 'owner-retention']) {
      await purgeActivityStageLedgerForOwner(owner).catch(() => undefined);
    }
    await AsyncStorage.clear();
  });

  test('exports stage clocks and installed identity without coordinates or tokens', async () => {
    await recordActivityStageEvent({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      stage: 'observation-received',
      evidenceId: 'obs:1',
      wallTimeMs: 10_000,
      monotonicTimeMs: 125.25,
      details: {
        observationTimeMs: 8_000,
        latitude: -41,
        longitude: 174,
        mapboxToken: 'pk.must-never-survive',
        error: 'request failed https://example.test?access_token=pk.also-secret',
        horizontalAccuracyM: 12,
        callbackIdentity: 'foreground-watch',
        visibleRenderTime: 'NOT_MEASURED',
      },
    });
    await recordActivityStageEvent({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      stage: 'canonical-accepted',
      evidenceId: 'obs:1',
      wallTimeMs: 10_120,
      details: { decision: 'ACCEPT', decisionWallTimeMs: 10_120, rawOrdinal: 7 },
    });
    const exported = await exportLatestActivityStageLedger('owner-a');
    expect(exported).toMatchObject({
      ownerUserId: 'current-owner',
      clientActivityId: 'activity-a',
      privacy: { localOnly: true, coordinatesIncluded: false, automaticUpload: false },
      presentationMeasurement: 'NOT_MEASURED',
      installedIdentity: {
        nativeApplicationVersion: '0.2.6',
        nativeBuildVersion: '63',
        runtimeVersion: '0.2.6-o66',
        updateId: 'update-field03',
      },
    });
    expect(exported.events).toHaveLength(2);
    expect(exported.diagnosticCompleteness).toMatchObject({
      persistence: 'complete', summaryAvailable: true, retentionTruncated: false,
    });
    expect(exported.phaseSummary).toMatchObject({
      clientActivityId: 'activity-a', capturedEventCount: 2,
      stages: {
        'observation-received': expect.objectContaining({ count: 1 }),
        'canonical-accepted': expect.objectContaining({ count: 1 }),
      },
    });
    expect(exported.events[0]).toMatchObject({
      wallTimeMs: 10_000,
      monotonicTimeMs: 125.25,
      processOriginWallTimeMs: expect.any(Number),
      processId: expect.any(String),
    });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain('pk.must-never-survive');
    expect(serialized).not.toContain('pk.also-secret');
    expect(serialized).not.toContain('owner-a');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
    expect(serialized).not.toContain('-41');
    expect(serialized).not.toContain('174');
    if (process.env.CAIRN_FIELD03_LEDGER_OUTPUT) {
      // Review evidence is generated only when explicitly requested; it never
      // enters the application bundle or uploads automatically.
      require('node:fs').writeFileSync(
        process.env.CAIRN_FIELD03_LEDGER_OUTPUT,
        `${JSON.stringify(exported, null, 2)}\n`,
      );
    }
  });

  test('uses the captured decision clock as the decision event wall clock', async () => {
    await recordActivityStageEvent({
      ownerUserId: 'owner-a',
      clientActivityId: 'activity-a',
      stage: 'observation-decision',
      details: { decision: 'ACCEPT', decisionWallTimeMs: 10_120 },
    });
    const [event] = (await exportLatestActivityStageLedger('owner-a')).events;
    expect(event.wallTimeMs).toBe(10_120);
    expect(event.details.decisionWallTimeMs).toBe(event.wallTimeMs);
  });

  test('latest export is owner-isolated and chooses recency rather than activity name', async () => {
    await recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'z-old', stage: 'activity-start', wallTimeMs: 1_000,
    });
    await recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'a-new', stage: 'activity-start', wallTimeMs: 2_000,
    });
    await recordActivityStageEvent({
      ownerUserId: 'owner-b', clientActivityId: 'other', stage: 'activity-start', wallTimeMs: 3_000,
    });
    expect((await exportLatestActivityStageLedger('owner-a')).clientActivityId).toBe('a-new');
    expect((await exportLatestActivityStageLedger('owner-b')).clientActivityId).toBe('other');
  });

  test('Snap Lab diagnostics have a separate owner realm and cannot become the production latest export', async () => {
    await recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'product-activity', stage: 'activity-start', wallTimeMs: 1_000,
    });
    await recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'qa-snap-lab-activity', stage: 'activity-start', wallTimeMs: 2_000,
    });
    await flushActivityStageLedger('owner-a');
    expect((await exportLatestActivityStageLedger('owner-a')).clientActivityId).toBe('product-activity');
    expect((await exportLatestActivityStageLedger('owner-a', 'snap-lab')).clientActivityId).toBe('qa-snap-lab-activity');
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some(key => key.startsWith(activityStageLedgerOwnerPrefix('owner-a', 'snap-lab')))).toBe(true);
  });

  test('privacy purge drains queued writes and removes only the exact owner', async () => {
    void recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', stage: 'provider-state',
    });
    await recordActivityStageEvent({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b', stage: 'provider-state',
    });
    await flushActivityStageLedger();
    await purgeActivityStageLedgerForOwner('owner-a');
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some(key => key.startsWith(activityStageLedgerOwnerPrefix('owner-a')))).toBe(false);
    expect(keys.some(key => key.includes('owner-a'))).toBe(false);
    expect(keys.some(key => key.startsWith(activityStageLedgerOwnerPrefix('owner-b')))).toBe(true);
  });

  test('a held owner write cannot block another owner and bounded export marks partial evidence', async () => {
    const values = (globalThis as any).__cairnTestAsyncStorage as Map<string, string>;
    let release!: () => void;
    let ownerABlocked = false;
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      if (!ownerABlocked && key.startsWith(activityStageLedgerOwnerPrefix('owner-a'))) {
        ownerABlocked = true;
        await new Promise<void>(resolve => { release = resolve; });
      }
      values.set(key, value);
    });

    await expect(recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', stage: 'store-published',
    })).resolves.toBeUndefined();
    await expect(recordActivityStageEvent({
      ownerUserId: 'owner-b', clientActivityId: 'activity-b', stage: 'store-published',
    })).resolves.toBeUndefined();
    for (let turn = 0; turn < 20 && !ownerABlocked; turn += 1) await Promise.resolve();
    const ownerB = await exportLatestActivityStageLedger('owner-b');
    expect(ownerB.diagnosticCompleteness).toMatchObject({
      persistence: 'complete',
      pendingEventCount: 0,
      waitTimedOut: false,
    });
    expect(ownerB.events).toHaveLength(1);

    const ownerA = await exportLatestActivityStageLedger('owner-a');
    expect(ownerA.events).toHaveLength(1);
    expect(ownerA.diagnosticCompleteness).toMatchObject({
      persistence: 'partial',
      pendingEventCount: 1,
      waitTimedOut: true,
    });
    release();
    await flushActivityStageLedger('owner-a');
  });

  test('rejected diagnostic storage is fail-visible without losing the exportable event', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('synthetic-ledger-storage-rejection'));
    await recordActivityStageEvent({
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', stage: 'provider-state',
      details: { event: 'watchdog-restart' },
    });
    await flushActivityStageLedger('owner-a');
    const exported = await exportLatestActivityStageLedger('owner-a');
    expect(exported.events).toEqual([
      expect.objectContaining({ stage: 'provider-state', details: { event: 'watchdog-restart' } }),
    ]);
    expect(exported.diagnosticCompleteness).toMatchObject({
      persistence: 'partial',
      failedWriteCount: 1,
      waitTimedOut: false,
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('@cairn:activity-stage-ledger'),
      expect.any(Error),
    );
    warning.mockRestore();
  });

  test('bounded retention is explicit and keeps a compact full phase summary', async () => {
    for (let ordinal = 1; ordinal <= 1_201; ordinal += 1) {
      await recordActivityStageEvent({
        ownerUserId: 'owner-retention',
        clientActivityId: 'activity-retention',
        stage: 'observation-received',
        wallTimeMs: 100_000 + ordinal,
        details: { ordinal },
      });
      if (ordinal % 64 === 0) await flushActivityStageLedger('owner-retention');
    }
    await flushActivityStageLedger('owner-retention');
    const exported = await exportLatestActivityStageLedger('owner-retention');
    expect(exported.events).toHaveLength(1_200);
    expect(exported.diagnosticCompleteness).toMatchObject({
      persistence: 'partial',
      summaryAvailable: true,
      retentionTruncated: true,
    });
    expect(exported.phaseSummary).toMatchObject({
      clientActivityId: 'activity-retention',
      capturedEventCount: 1_201,
      stages: {
        'observation-received': expect.objectContaining({ count: 1_201 }),
      },
    });
  });

  test('summarizes a fully correlated native-to-sync evidence path without coordinates', () => {
    const stages = [
      'native-callback',
      'native-js-delivery',
      'observation-received',
      'observation-decision',
      'canonical-accepted',
      'wal-committed',
      'store-published',
      'presentation',
    ] as const;
    const events = stages.map((stage, index) => ({
      schema: 'cairn-activity-stage-ledger', version: 1, eventId: `event-${index}`,
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', stage,
      wallTimeMs: 1_000 + index * 10, monotonicTimeMs: index * 10,
      processOriginWallTimeMs: 1_000, processId: 'process-a', evidenceId: 'evidence-1',
      details: stage === 'observation-received'
        ? { observationTimeMs: 900 }
        : stage === 'observation-decision' ? { decision: 'ACCEPT' }
          : stage === 'store-published' ? { walToStoreLatencyMs: 12 }
            : {},
    })) as any;
    events.push({
      ...events[0], eventId: 'sync-ack', stage: 'sync-state', wallTimeMs: 1_100,
      evidenceId: null, details: { operation: 'completed-activity-upload', phase: 'ack' },
    });
    const summary = summarizeActivityObservability(events);
    expect(summary.evidenceCompleteness).toEqual({
      nativeCallback: 'complete',
      nativeToJsCorrelation: 'complete',
      jsIntake: 'complete',
      acceptanceDecision: 'complete',
      walDurability: 'complete',
      canonicalStore: 'complete',
      livePublication: 'complete',
      networkSync: 'complete',
    });
    expect(summary.pipelineFindings).toMatchObject({
      nativeCallbacksWithoutJsDelivery: 0,
      jsReceiptsWithoutDecision: 0,
      canonicalAcceptsWithoutWal: 0,
      walCommitsWithoutStorePublication: 0,
    });
    expect(summary.timing).toMatchObject({
      maximumObservationReceiptLagMs: 120,
      maximumWalToStoreLagMs: 12,
    });
  });

  test('a seven-minute JavaScript gap retains native uncertainty in the current binary', () => {
    const event = (eventId: string, stage: any, wallTimeMs: number, evidenceId: string | null = null) => ({
      schema: 'cairn-activity-stage-ledger', version: 1, eventId,
      ownerUserId: 'owner-a', clientActivityId: 'activity-a', stage, wallTimeMs,
      monotonicTimeMs: null, processOriginWallTimeMs: null, processId: 'process-a', evidenceId, details: {},
    });
    const summary = summarizeActivityObservability([
      event('received-1', 'observation-received', 1_000, 'evidence-1'),
      event('heartbeat-1', 'health-heartbeat', 61_000),
      event('heartbeat-2', 'health-heartbeat', 301_000),
      event('received-2', 'observation-received', 472_000, 'evidence-2'),
    ] as any);
    expect(summary.longObservationGaps).toEqual([
      expect.objectContaining({
        durationMs: 471_000,
        heartbeatCount: 2,
        nativeCallbackCount: 0,
        conclusion: 'no-js-callback-native-cause-unknown',
      }),
    ]);
    expect(summary.evidenceCompleteness.nativeCallback).toBe('not-observable-current-binary');
    expect(summary.interpretationLimits.join(' ')).toContain('do not prove');
  });

  test('instrumented native receipt without JS delivery localizes the missing boundary', () => {
    const base = {
      schema: 'cairn-activity-stage-ledger', version: 1, ownerUserId: 'owner-a',
      clientActivityId: 'activity-a', monotonicTimeMs: null,
      processOriginWallTimeMs: null, processId: 'process-a', details: {},
    };
    const summary = summarizeActivityObservability([
      { ...base, eventId: 'r1', stage: 'observation-received', wallTimeMs: 1_000, evidenceId: 'evidence-1' },
      { ...base, eventId: 'native', stage: 'native-callback', wallTimeMs: 220_000, evidenceId: 'native-7' },
      { ...base, eventId: 'r2', stage: 'observation-received', wallTimeMs: 472_000, evidenceId: 'evidence-2' },
    ] as any);
    expect(summary.pipelineFindings.nativeCallbacksWithoutJsDelivery).toBe(1);
    expect(summary.longObservationGaps[0]).toMatchObject({
      conclusion: 'native-callback-observed-js-delivery-missing',
    });
  });

  test('instrumented evidence before and after a gap distinguishes no native callback observed', () => {
    const base = {
      schema: 'cairn-activity-stage-ledger', version: 1, ownerUserId: 'owner-a',
      clientActivityId: 'activity-a', monotonicTimeMs: null,
      processOriginWallTimeMs: null, processId: 'process-a', details: {},
    };
    const summary = summarizeActivityObservability([
      { ...base, eventId: 'native-before', stage: 'native-callback', wallTimeMs: 900, evidenceId: 'native-before' },
      { ...base, eventId: 'r1', stage: 'observation-received', wallTimeMs: 1_000, evidenceId: 'evidence-1' },
      { ...base, eventId: 'heartbeat', stage: 'health-heartbeat', wallTimeMs: 220_000, evidenceId: null },
      { ...base, eventId: 'r2', stage: 'observation-received', wallTimeMs: 472_000, evidenceId: 'evidence-2' },
      { ...base, eventId: 'native-after', stage: 'native-callback', wallTimeMs: 472_100, evidenceId: 'native-after' },
    ] as any);
    expect(summary.longObservationGaps[0]).toMatchObject({
      durationMs: 471_000,
      nativeCallbackCount: 0,
      conclusion: 'no-native-callback-observed',
    });
  });

  test('reports filtering, durability, publication, upload and refinement frontiers independently', () => {
    const base = {
      schema: 'cairn-activity-stage-ledger', version: 1, ownerUserId: 'owner-a',
      clientActivityId: 'activity-a', monotonicTimeMs: null,
      processOriginWallTimeMs: null, processId: 'process-a',
    };
    const summary = summarizeActivityObservability([
      { ...base, eventId: 'rx', stage: 'observation-received', wallTimeMs: 1, evidenceId: 'rejected', details: {} },
      { ...base, eventId: 'dx', stage: 'observation-decision', wallTimeMs: 2, evidenceId: 'rejected', details: { decision: 'REJECT', reason: 'poor-accuracy' } },
      { ...base, eventId: 'ca', stage: 'canonical-accepted', wallTimeMs: 3, evidenceId: 'accepted-no-wal', details: {} },
      { ...base, eventId: 'wal', stage: 'wal-committed', wallTimeMs: 4, evidenceId: 'wal-no-store', details: {} },
      { ...base, eventId: 'final', stage: 'final-selected', wallTimeMs: 5, evidenceId: null, details: { revision: 1 } },
      { ...base, eventId: 'provider', stage: 'final-job', wallTimeMs: 6, evidenceId: null, details: { phase: 'unavailable' } },
    ] as any);
    expect(summary.pipelineFindings).toMatchObject({
      rejectedByFiltering: 1,
      canonicalAcceptsWithoutWal: 1,
      walCommitsWithoutStorePublication: 1,
      locallyCompleteWithoutUploadAck: true,
      refinementUnavailable: true,
    });
  });
});
