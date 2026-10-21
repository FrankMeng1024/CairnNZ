const mockDurableValues = new Map<string, string>();
let mockGetAllKeysGate: Promise<void> | null = null;
let mockReleaseGetAllKeys: (() => void) | null = null;
let mockGetAllKeysStarted = 0;
let mockRecoveryMetaGate: Promise<void> | null = null;
let mockReleaseRecoveryMeta: (() => void) | null = null;
let mockRecoveryMetaStarted = 0;

type BackgroundHandler = (event: { data: unknown; error: unknown }) => Promise<void>;
type DiagnosticModule = typeof import('../../features/activity/activityDiagnosticReplay');

jest.mock('../../store/storage', () => ({
  storage: {
    getItemStrict: jest.fn(async (key: string) => mockDurableValues.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      if (key.includes(':meta')) {
        const parsed = JSON.parse(value);
        if (parsed.recoveryCount > 0 && mockRecoveryMetaGate) {
          mockRecoveryMetaStarted += 1;
          await mockRecoveryMetaGate;
        }
      }
      mockDurableValues.set(key, value);
    }),
    getAllKeysStrict: jest.fn(async () => {
      if (mockGetAllKeysGate) {
        mockGetAllKeysStarted += 1;
        await mockGetAllKeysGate;
      }
      return [...mockDurableValues.keys()];
    }),
    removeItemsStrict: jest.fn(async (keys: string[]) => keys.forEach(key => mockDurableValues.delete(key))),
  },
}));

describe('headless Activity diagnostic replay ingress', () => {
  let handler: BackgroundHandler;
  let appendBackgroundHikePoints: jest.Mock;
  let scheduleActivityMemoryProjection: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockDurableValues.clear();
    mockGetAllKeysGate = null;
    mockReleaseGetAllKeys = null;
    mockGetAllKeysStarted = 0;
    mockRecoveryMetaGate = null;
    mockReleaseRecoveryMeta = null;
    mockRecoveryMetaStarted = 0;
    handler = undefined as unknown as BackgroundHandler;
    appendBackgroundHikePoints = jest.fn(async (points: Array<Record<string, unknown>>) => {
      mockDurableValues.set('@test:wal', JSON.stringify(points));
    });

    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
      AppState: { currentState: 'background' },
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async (key: string) => mockDurableValues.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => { mockDurableValues.set(key, value); }),
      removeItem: jest.fn(async (key: string) => { mockDurableValues.delete(key); }),
      getAllKeys: jest.fn(async () => [...mockDurableValues.keys()]),
      multiRemove: jest.fn(async (keys: string[]) => keys.forEach(key => mockDurableValues.delete(key))),
    }));
    jest.doMock('expo-task-manager', () => ({
      isTaskDefined: jest.fn(() => false),
      defineTask: jest.fn((_name: string, callback: BackgroundHandler) => { handler = callback; }),
    }));
    jest.doMock('../hikeTrackWriter', () => ({
      appendBackgroundHikePoints,
      readActiveHikeTail: jest.fn(async () => []),
    }));
    jest.doMock('../debugLogger', () => ({
      debugLogger: {
        isEnabled: jest.fn(() => false), getCurrentSessionId: jest.fn(() => null),
        log: jest.fn(), logError: jest.fn(),
      },
    }));
    jest.doMock('../crashLogger', () => ({
      crashLogger: { breadcrumb: jest.fn(), captureException: jest.fn() },
    }));
    jest.doMock('../../features/activitySimulator/simulatorLog', () => ({
      appendSimulatorLog: jest.fn(), flushSimulatorLogs: jest.fn(async () => undefined),
    }));
    jest.doMock('../../features/memory/services/recordMemoryEvidence', () => ({
      recordMemoryEvidence: jest.fn(async () => ({ committed: true, deduplicated: false })),
      flushRecordedMemoryEvidence: jest.fn(async () => undefined),
    }));
    scheduleActivityMemoryProjection = jest.fn(async () => undefined);
    jest.doMock('../../features/activity/activityMemoryProjector', () => ({ scheduleActivityMemoryProjection }));
    jest.doMock('../../features/activity/activityStageLedger', () => ({
      activityStageMonotonicNow: jest.fn(() => 84.25),
      recordActivityStageEvent: jest.fn(async () => undefined),
      flushActivityStageLedger: jest.fn(async () => undefined),
    }));
  });

  const nativePoint = (
    timestamp: number,
    latitude: number,
    longitude: number,
    accuracy = 5,
  ) => ({
    timestamp,
    coords: {
      latitude, longitude, accuracy,
      altitude: 12, altitudeAccuracy: 4, speed: 1.2, speedAccuracy: 0.4,
      heading: 12, courseAccuracy: 5,
    },
  });

  const durableRecords = () => [...mockDurableValues.entries()]
    .filter(([key]) => key.includes(':chunk:'))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, value]) => JSON.parse(value).records);

  const seedColdDiagnostic = async (clientActivityId: string) => {
    const diagnostic = require('../../features/activity/activityDiagnosticReplay') as DiagnosticModule;
    await diagnostic.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-headless', clientActivityId, mode: 'hiking', source: 'real', wallTimeMs: 500,
    });
    mockDurableValues.set('cairn_bg_hike_active', '1');
    mockDurableValues.set('cairn_bg_active_session_id', clientActivityId);
    mockDurableValues.set('cairn_bg_activity_context_v2', JSON.stringify({
      clientActivityId,
      userId: 'owner-headless',
      ownerGeneration: `generation-${clientActivityId}`,
      segmentId: `segment-${clientActivityId}`,
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    }));
    jest.resetModules();
  };

  const waitFor = async (predicate: () => boolean) => {
    for (let turn = 0; turn < 100 && !predicate(); turn += 1) await Promise.resolve();
    expect(predicate()).toBe(true);
  };

  test('a cold accepted batch joins delayed replay discovery before handler return', async () => {
    await seedColdDiagnostic('activity-cold-accepted');
    mockGetAllKeysGate = new Promise<void>(resolve => { mockReleaseGetAllKeys = resolve; });
    require('../backgroundLocationTask');

    let returned = false;
    const delivery = handler({
      data: { locations: [nativePoint(1_000, -41, 174), nativePoint(5_000, -40.99995, 174)] },
      error: null,
    }).then(() => { returned = true; });
    await waitFor(() => mockGetAllKeysStarted === 1);
    expect(returned).toBe(false);
    mockReleaseGetAllKeys?.();
    await delivery;

    const records = durableRecords();
    expect(records.filter(record => record.kind === 'raw-observation')).toHaveLength(2);
    expect(records.filter(record => record.kind === 'observation-decision')).toHaveLength(2);
    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(scheduleActivityMemoryProjection).toHaveBeenCalledTimes(1);
    const task = require('../backgroundLocationTask');
    expect(task.drainBackgroundLocations()).toHaveLength(2);
    expect(task.drainBackgroundLocations()).toEqual([]);
  });

  test('a cold all-stale batch joins delayed recovery metadata and persists only diagnostic evidence', async () => {
    await seedColdDiagnostic('activity-cold-stale');
    mockRecoveryMetaGate = new Promise<void>(resolve => { mockReleaseRecoveryMeta = resolve; });
    require('../backgroundLocationTask');

    let returned = false;
    const delivery = handler({
      data: { locations: [nativePoint(900, -41, 174)] },
      error: null,
    }).then(() => { returned = true; });
    await waitFor(() => mockRecoveryMetaStarted === 1);
    expect(returned).toBe(false);
    mockReleaseRecoveryMeta?.();
    await delivery;

    const records = durableRecords();
    expect(records.filter(record => record.kind === 'raw-observation')).toHaveLength(1);
    expect(records).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'observation-decision', data: expect.objectContaining({ reason: 'before-owner-generation' }) }),
    ]));
    expect(appendBackgroundHikePoints).not.toHaveBeenCalled();
    expect(scheduleActivityMemoryProjection).not.toHaveBeenCalled();
    expect(require('../backgroundLocationTask').drainBackgroundLocations()).toEqual([]);
  });

  test('durably captures every delivered native receipt before any foreground drain', async () => {
    const diagnostic = require('../../features/activity/activityDiagnosticReplay') as DiagnosticModule;
    await diagnostic.beginActivityDiagnosticReplay({
      ownerUserId: 'owner-headless',
      clientActivityId: 'activity-headless',
      mode: 'hiking',
      source: 'real',
      wallTimeMs: 500,
    });
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-headless', true, {
      clientActivityId: 'activity-headless',
      userId: 'owner-headless',
      ownerGeneration: 'generation-headless',
      segmentId: 'segment-headless',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });

    const north10 = 10 / 111_320;
    const east25 = 25 / (111_320 * Math.cos(41 * Math.PI / 180));
    const east35 = 35 / (111_320 * Math.cos(41 * Math.PI / 180));
    const delivered = [
      nativePoint(900, -41, 174), // rejected by the owner-generation fence
      nativePoint(1_000, -41, 174),
      nativePoint(5_000, -41 + north10, 174),
      nativePoint(9_000, -41 + north10 * 2, 174),
      nativePoint(13_000, -41 + north10 * 2, 174 + east25, 12), // quarantined
      nativePoint(17_000, -41 + north10 * 2, 174 + east35, 8), // promotes prior turn
      nativePoint(17_000, -41 + north10 * 2, 174 + east35, 8), // duplicate
    ];
    await handler({ data: { locations: delivered }, error: null });

    // Deliberately do not call drainBackgroundLocations(): the raw replay is
    // already durable at TaskManager receipt, independent of React mounting.
    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(mockDurableValues.get('@test:wal')).toBeTruthy();
    await diagnostic.finishActivityDiagnosticReplay('owner-headless', 'activity-headless', {
      finalArtifact: { artifactFingerprint: 'headless-final' },
    });

    jest.resetModules();
    const coldDiagnostic = require('../../features/activity/activityDiagnosticReplay') as DiagnosticModule;
    const exported = await coldDiagnostic.exportActivityDiagnosticReplay({
      ownerUserId: 'owner-headless',
      clientActivityId: 'activity-headless',
      stageLedger: { schema: 'cairn-activity-stage-ledger-export' } as never,
    });
    const raw = exported.records.filter(record => record.kind === 'raw-observation');
    const decisions = exported.records.filter(record => record.kind === 'observation-decision');

    expect(raw.map(record => record.data.observationTimeMs)).toEqual(delivered.map(item => item.timestamp));
    expect(raw.map(record => record.data.nativeBatchIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(raw.every(record => record.data.source === 'background')).toBe(true);
    expect(raw.every(record => record.data.ownerGeneration === 'generation-headless')).toBe(true);
    expect(new Set(raw.map(record => record.data.receiptEvidenceId)).size).toBe(delivered.length);
    expect(decisions).toHaveLength(delivered.length);
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ reason: 'before-owner-generation' }) }),
      expect.objectContaining({ data: expect.objectContaining({ reason: 'stale-or-equal-observation' }) }),
      expect.objectContaining({ data: expect.objectContaining({ reason: 'large-lateral-innovation' }) }),
    ]));
    expect(exported.records.some(record => record.kind === 'canonical-promotion')).toBe(true);
    expect(exported.completeness).toMatchObject({
      durableRecordsComplete: true,
      recordingFinished: true,
      replayScope: 'tracking-replay-inputs-only',
      syncTerminalState: 'not-recorded',
      fullLifecycleComplete: false,
    });
  });
});
