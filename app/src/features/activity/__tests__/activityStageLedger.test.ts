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
    expect(keys.some(key => key.startsWith(activityStageLedgerOwnerPrefix('owner-b')))).toBe(true);
  });
});
