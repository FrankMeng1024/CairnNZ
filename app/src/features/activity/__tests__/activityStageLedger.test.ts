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
});
