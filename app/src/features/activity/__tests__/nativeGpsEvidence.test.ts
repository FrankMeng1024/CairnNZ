import AsyncStorage from '@react-native-async-storage/async-storage';

const mockGetInfo = jest.fn();
const mockRead = jest.fn();
const mockWrite = jest.fn();
const mockDelete = jest.fn();
const mockMakeDirectory = jest.fn();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  getInfoAsync: (...args: unknown[]) => mockGetInfo(...args),
  readAsStringAsync: (...args: unknown[]) => mockRead(...args),
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  deleteAsync: (...args: unknown[]) => mockDelete(...args),
  makeDirectoryAsync: (...args: unknown[]) => mockMakeDirectory(...args),
}));

import {
  activateNativeGpsEvidenceScope,
  buildActivityNativeCrossLedgerReport,
  exportNativeGpsEvidence,
} from '../nativeGpsEvidence';

function diskEvent(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'cairn-native-gps-evidence',
    version: 2,
    event: 'native-callback',
    source: 'background-task',
    collectorRunId: 'native-run-1',
    retentionEpoch: 0,
    sequence: 1,
    correlationScopeId: 'scope-replaced-by-test',
    evidenceIds: ['native-7'],
    receiptWallTimeMs: 1_000,
    receiptMonotonicTimeMs: 500,
    firstObservationTimeMs: 900,
    lastObservationTimeMs: 900,
    batchCount: 1,
    horizontalAccuracyMinM: 8,
    horizontalAccuracyMaxM: 8,
    applicationState: 'background',
    authorizationStatus: 'authorizedAlways',
    accuracyAuthorization: 'fullAccuracy',
    ...overrides,
  };
}

async function activate(owner = 'owner-a', activity = 'activity-a'): Promise<string> {
  await activateNativeGpsEvidenceScope(owner, activity);
  const contextWrite = mockWrite.mock.calls.find(call => String(call[0]).endsWith('native-gps-context-v1.json'));
  expect(contextWrite).toBeTruthy();
  return JSON.parse(String(contextWrite![1])).correlationScopeId;
}

function ledgerWithGap(conclusion = 'no-js-callback-native-cause-unknown'): any {
  return {
    clientActivityId: 'activity-a',
    observability: {
      longObservationGaps: [{
        fromWallTimeMs: 1_000,
        toWallTimeMs: 472_000,
        durationMs: 471_000,
        receiptGapDurationMs: 471_000,
        observationTimestampGapMs: 470_000,
        heartbeatCount: 2,
        conclusion,
      }],
    },
  };
}

function nativeExport(events: any[], overrides: Record<string, unknown> = {}): any {
  return {
    evidenceCompletenessStatus: 'native-evidence-owner-correlated',
    retentionTruncated: false,
    events,
    ...overrides,
  };
}

describe('owner-correlated native GPS evidence export', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockMakeDirectory.mockResolvedValue(undefined);
    mockWrite.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
    mockGetInfo.mockResolvedValue({ exists: false });
  });

  test('current binaries explicitly report that the pre-JS boundary is not observable', async () => {
    await activate();
    await expect(exportNativeGpsEvidence('owner-a', 'activity-a')).resolves.toMatchObject({
      evidenceCompletenessStatus: 'not-observable-current-binary',
      events: [],
      privacy: {
        coordinatesIncluded: false,
        automaticUpload: false,
        ownerScopeMatchedBeforeExport: true,
        maximumBytes: 524288,
      },
    });
  });

  test('a device-global file cannot be exported without exact owner+Activity correlation', async () => {
    mockGetInfo.mockResolvedValue({ exists: true });
    mockRead.mockResolvedValue(`${JSON.stringify(diskEvent())}\n`);
    await expect(exportNativeGpsEvidence('owner-b', 'activity-b')).resolves.toMatchObject({
      evidenceCompletenessStatus: 'owner-correlation-unavailable',
      events: [],
    });
    expect(mockRead).not.toHaveBeenCalled();
  });

  test('returns only exact owner-scoped coordinate-free callback and delivery evidence', async () => {
    const scope = await activate();
    mockGetInfo.mockResolvedValue({ exists: true });
    mockRead.mockResolvedValue([
      JSON.stringify(diskEvent({ correlationScopeId: 'activity-prior-owner-scope' })),
      JSON.stringify(diskEvent({ correlationScopeId: scope })),
      JSON.stringify(diskEvent({
        correlationScopeId: scope,
        event: 'native-js-delivery',
        receiptWallTimeMs: 1_010,
      })),
    ].join('\n'));
    const exported = await exportNativeGpsEvidence('owner-a', 'activity-a');
    expect(exported).toMatchObject({
      evidenceCompletenessStatus: 'native-evidence-owner-correlated',
      malformedLineCount: 0,
      unmatchedScopeEventCount: 1,
      retentionTruncated: false,
      collectorRunCount: 1,
    });
    expect(exported.events).toHaveLength(2);
    expect(exported.events.every(event => event.correlationScopeId === 'current-activity')).toBe(true);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(scope);
    expect(serialized).not.toContain('prior-owner');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
  });

  test('fails closed instead of copying an incompatible coordinate-bearing record', async () => {
    const scope = await activate();
    mockGetInfo.mockResolvedValue({ exists: true });
    mockRead.mockResolvedValue(`${JSON.stringify(diskEvent({ correlationScopeId: scope, latitude: -41 }))}\n`);
    const exported = await exportNativeGpsEvidence('owner-a', 'activity-a');
    expect(exported.events).toEqual([]);
    expect(exported.malformedLineCount).toBe(1);
  });

  test('authoritative no-callback requires one run/epoch of uninterrupted heartbeats', () => {
    const heartbeatTimes = [900, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 472_100];
    const events = heartbeatTimes.map((receiptWallTimeMs, index) => diskEvent({
      event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0,
      receiptWallTimeMs, receiptMonotonicTimeMs: index * 60_000, sequence: index + 1,
      correlationScopeId: 'current-activity',
    }));
    const report = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport(events));
    expect(report.gaps[0]).toMatchObject({
      collectorCoverage: 'complete',
      nativeCallbackCount: 0,
      conclusion: 'no-native-callback-observed-with-complete-collector-coverage',
    });
  });

  test.each([
    ['no collector heartbeat', [diskEvent({ correlationScopeId: 'current-activity' })]],
    ['JS resumes after native collector suspension', [
      diskEvent({ event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0, receiptWallTimeMs: 900, collectorRunId: 'run-a', correlationScopeId: 'current-activity' }),
      diskEvent({ event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0, receiptWallTimeMs: 472_100, collectorRunId: 'run-b', correlationScopeId: 'current-activity' }),
    ]],
  ])('%s cannot claim a native no-callback gap', (_label, events) => {
    const report = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport(events));
    expect(report.gaps[0]).toMatchObject({
      collectorCoverage: 'incomplete',
      conclusion: 'collector-coverage-incomplete-cause-unknown',
    });
  });

  test('uncovered native callback/delivery IDs localize only their proven native boundary', () => {
    const events = [
      diskEvent({ receiptWallTimeMs: 200_000, correlationScopeId: 'current-activity', evidenceIds: ['native-batch-a'] }),
      diskEvent({ event: 'native-js-delivery', receiptWallTimeMs: 200_010, correlationScopeId: 'current-activity', evidenceIds: ['native-other'] }),
    ];
    const report = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport(events));
    expect(report.gaps[0]).toMatchObject({
      callbacksWithoutNativeDelivery: 0,
      callbackDeliveryEvidenceCompleteness: 'partial',
      conclusion: 'collector-coverage-incomplete-cause-unknown',
    });
    expect(report.clockContract.perPointNativeToJsIdentity).toBe('unavailable');
  });

  test('a matching delivery just after the JS gap is delayed, not missing', () => {
    const heartbeatTimes = [900, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 472_200];
    const events = [
      ...heartbeatTimes.map((receiptWallTimeMs, index) => diskEvent({
        event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0,
        receiptWallTimeMs, receiptMonotonicTimeMs: index * 60_000, sequence: index + 1,
        correlationScopeId: 'current-activity',
      })),
      diskEvent({ receiptWallTimeMs: 180_000, sequence: 20, evidenceIds: ['native-delayed'], correlationScopeId: 'current-activity' }),
      diskEvent({ event: 'native-js-delivery', receiptWallTimeMs: 472_100, sequence: 21, evidenceIds: ['native-delayed'], correlationScopeId: 'current-activity' }),
    ];
    const report = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport(events));
    expect(report.gaps[0]).toMatchObject({
      nativeCallbackCount: 1,
      callbacksWithDelayedNativeDelivery: 1,
      callbacksWithoutNativeDelivery: 0,
      conclusion: 'native-callback-observed-native-delivery-delayed',
    });
  });

  test('same-run callback delivery association distinguishes in-window from proven missing', () => {
    const heartbeatTimes = [900, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 472_200];
    const heartbeats = heartbeatTimes.map((receiptWallTimeMs, index) => diskEvent({
      event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0,
      receiptWallTimeMs, receiptMonotonicTimeMs: index * 60_000, sequence: index + 1,
      correlationScopeId: 'current-activity',
    }));
    const matched = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport([
      ...heartbeats,
      diskEvent({ receiptWallTimeMs: 180_000, sequence: 20, evidenceIds: ['native-matched'], correlationScopeId: 'current-activity' }),
      diskEvent({ event: 'native-js-delivery', receiptWallTimeMs: 180_010, sequence: 21, evidenceIds: ['native-matched'], correlationScopeId: 'current-activity' }),
    ]));
    expect(matched.gaps[0]).toMatchObject({
      callbacksWithInWindowNativeDelivery: 1,
      callbacksWithDelayedNativeDelivery: 0,
      callbacksWithoutNativeDelivery: 0,
      conclusion: 'native-delivery-invoked-js-intake-not-observed',
    });
    const missing = buildActivityNativeCrossLedgerReport(ledgerWithGap(), nativeExport([
      ...heartbeats,
      diskEvent({ receiptWallTimeMs: 180_000, sequence: 20, evidenceIds: ['native-missing'], correlationScopeId: 'current-activity' }),
    ]));
    expect(missing.gaps[0]).toMatchObject({
      callbacksWithoutNativeDelivery: 1,
      callbackDeliveryEvidenceCompleteness: 'complete',
      conclusion: 'native-callback-observed-native-delivery-missing',
    });
  });

  test.each([
    ['collector restart', {}, 'run-b', 0],
    ['retention epoch rotation', {}, 'native-run-1', 1],
  ])('%s cannot invent an exact callback-to-delivery match', (_label, exportOverrides, deliveryRun, deliveryEpoch) => {
    const heartbeatTimes = [900, 60_000, 120_000, 180_000, 240_000, 300_000, 360_000, 420_000, 472_200];
    const events = [
      ...heartbeatTimes.map((receiptWallTimeMs, index) => diskEvent({
        event: 'collector-heartbeat', source: 'collector', evidenceIds: [], batchCount: 0,
        receiptWallTimeMs, receiptMonotonicTimeMs: index * 60_000, sequence: index + 1,
        correlationScopeId: 'current-activity',
      })),
      diskEvent({ receiptWallTimeMs: 180_000, sequence: 20, evidenceIds: ['native-cross-boundary'], correlationScopeId: 'current-activity' }),
      diskEvent({
        event: 'native-js-delivery', receiptWallTimeMs: 180_010, sequence: 21,
        evidenceIds: ['native-cross-boundary'], collectorRunId: deliveryRun,
        retentionEpoch: deliveryEpoch, correlationScopeId: 'current-activity',
      }),
    ];
    const report = buildActivityNativeCrossLedgerReport(
      ledgerWithGap(),
      nativeExport(events, exportOverrides),
    );
    expect(report.gaps[0]).toMatchObject({
      callbacksWithInWindowNativeDelivery: 0,
      callbacksWithDelayedNativeDelivery: 0,
      callbacksWithoutNativeDelivery: 0,
      callbackDeliveryEvidenceCompleteness: 'partial',
      conclusion: 'collector-coverage-incomplete-cause-unknown',
    });
  });

  test('retention truncation makes an otherwise missing delivery unknown', () => {
    const report = buildActivityNativeCrossLedgerReport(
      ledgerWithGap(),
      nativeExport([
        diskEvent({ receiptWallTimeMs: 180_000, sequence: 20, evidenceIds: ['native-rotated-away'], correlationScopeId: 'current-activity' }),
      ], { retentionTruncated: true }),
    );
    expect(report.gaps[0]).toMatchObject({
      callbacksWithoutNativeDelivery: 0,
      callbackDeliveryEvidenceCompleteness: 'partial',
      conclusion: 'collector-coverage-incomplete-cause-unknown',
    });
  });

  test('an intentional Pause cannot be diagnosed as a native failure', () => {
    const report = buildActivityNativeCrossLedgerReport(
      ledgerWithGap('recording-source-intentionally-inactive'),
      nativeExport([]),
    );
    expect(report.gaps[0].conclusion).toBe('recording-source-intentionally-inactive');
  });
});
