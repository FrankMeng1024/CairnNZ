type BackgroundHandler = (event: { data: unknown; error: unknown }) => Promise<void>;

describe('backgroundLocationTask durable ownership fencing', () => {
  let values: Record<string, string>;
  let handler: BackgroundHandler;
  let appendBackgroundHikePoints: jest.Mock;
  let readActiveHikeTail: jest.Mock;
  let recordMemoryEvidence: jest.Mock;
  let flushRecordedMemoryEvidence: jest.Mock;
  let scheduleActivityMemoryProjection: jest.Mock;
  let recordActivityStageEvent: jest.Mock;
  let recordActivityStageEventDurably: jest.Mock;
  let recordActivityDiagnosticObservation: jest.Mock;
  let recordActivityDiagnosticDecision: jest.Mock;
  let recordActivityDiagnosticCanonicalPromotion: jest.Mock;
  let breadcrumb: jest.Mock;
  let taskDefined: boolean;
  let hasStartedLocationUpdatesAsync: jest.Mock;
  let stopLocationUpdatesAsync: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    values = {};
    handler = undefined as unknown as BackgroundHandler;
    appendBackgroundHikePoints = jest.fn(async () => undefined);
    readActiveHikeTail = jest.fn(async () => []);
    recordMemoryEvidence = jest.fn(async () => ({ committed: true, deduplicated: false }));
    flushRecordedMemoryEvidence = jest.fn(async () => undefined);
    scheduleActivityMemoryProjection = jest.fn(async () => undefined);
    recordActivityStageEvent = jest.fn(async () => undefined);
    recordActivityStageEventDurably = jest.fn(async () => true);
    recordActivityDiagnosticObservation = jest.fn(async () => undefined);
    recordActivityDiagnosticDecision = jest.fn(async () => undefined);
    recordActivityDiagnosticCanonicalPromotion = jest.fn(async () => undefined);
    breadcrumb = jest.fn();
    taskDefined = false;
    hasStartedLocationUpdatesAsync = jest.fn(async () => false);
    stopLocationUpdatesAsync = jest.fn(async () => undefined);

    jest.doMock('react-native', () => ({
      Platform: { OS: 'ios' },
      AppState: { currentState: 'active' },
    }));
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      getItem: jest.fn(async (key: string) => values[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => { values[key] = value; }),
      removeItem: jest.fn(async (key: string) => { delete values[key]; }),
    }));
    jest.doMock('expo-task-manager', () => ({
      isTaskDefined: jest.fn(() => taskDefined),
      defineTask: jest.fn((_name: string, callback: BackgroundHandler) => { handler = callback; }),
    }));
    jest.doMock('expo-location', () => ({
      hasStartedLocationUpdatesAsync,
      stopLocationUpdatesAsync,
    }));
    jest.doMock('../hikeTrackWriter', () => ({
      appendBackgroundHikePoints,
      readActiveHikeTail,
    }));
    jest.doMock('../debugLogger', () => ({
      debugLogger: {
        isEnabled: jest.fn(() => false),
        getCurrentSessionId: jest.fn(() => null),
        log: jest.fn(),
        logError: jest.fn(),
      },
    }));
    jest.doMock('../crashLogger', () => ({
      crashLogger: { breadcrumb, captureException: jest.fn() },
    }));
    jest.doMock('../../features/activitySimulator/simulatorLog', () => ({
      appendSimulatorLog: jest.fn(),
      flushSimulatorLogs: jest.fn(async () => undefined),
    }));
    jest.doMock('../../features/memory/services/recordMemoryEvidence', () => ({
      recordMemoryEvidence,
      flushRecordedMemoryEvidence,
    }));
    jest.doMock('../../features/activity/activityMemoryProjector', () => ({
      scheduleActivityMemoryProjection,
    }));
    jest.doMock('../../features/public/services/walkingEncounterEvidence', () => ({
      recordWalkingEncounterObservations: jest.fn(async () => undefined),
    }));
    jest.doMock('../../features/activity/activityStageLedger', () => ({
      activityStageMonotonicNow: jest.fn(() => 42.5),
      recordActivityStageEvent,
      recordActivityStageEventDurably,
      flushActivityStageLedger: jest.fn(async () => undefined),
    }));
    jest.doMock('../../features/activity/activityDiagnosticReplay', () => ({
      recordActivityDiagnosticObservation,
      recordActivityDiagnosticDecision,
      recordActivityDiagnosticCanonicalPromotion,
      flushActivityDiagnosticReplay: jest.fn(async () => undefined),
    }));
  });

  const point = (timestamp: number, latitude = -41) => ({
    timestamp,
    coords: {
      latitude,
      longitude: 174,
      altitude: 5,
      accuracy: 5,
      altitudeAccuracy: 5,
      speed: 1,
      heading: 0,
    },
  });

  const pointAt = (
    timestamp: number,
    latitude: number,
    longitude: number,
    accuracy = 5,
  ) => ({
    timestamp,
    coords: {
      latitude,
      longitude,
      altitude: 5,
      accuracy,
      altitudeAccuracy: 5,
      speed: 1,
      heading: 0,
    },
  });

  it('rejects pre-generation and out-of-order native samples', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-2',
      segmentId: 'segment-2',
      activityMode: 'hiking',
      acceptAfterMs: 2_000,
    });
    readActiveHikeTail.mockResolvedValue([{ t: 2_500, lat: -41, lng: 174, segmentId: 'segment-2' }]);

    await handler({
      data: { locations: [point(1_500), point(2_400), point(3_000, -40.99998)] },
      error: null,
    });

    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(appendBackgroundHikePoints.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        t: 3_000,
        clientActivityId: 'activity-a',
        ownerGeneration: 'generation-2',
      }),
    ]);
    expect(appendBackgroundHikePoints).toHaveBeenCalledWith(expect.any(Array), 'user-a');
    expect(task.drainBackgroundLocations()).toEqual([
      expect.objectContaining({ timestamp: 3_000, clientActivityId: 'activity-a', ownerGeneration: 'generation-2' }),
    ]);
    const durableContext = JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]);
    expect(durableContext.latestSourceReceipt).toEqual({
      observationTimeMs: 3_000,
      receiptWallTimeMs: expect.any(Number),
      source: 'background',
    });
    const decisions = recordActivityStageEvent.mock.calls
      .map(call => call[0])
      .filter(event => event.stage === 'observation-decision');
    expect(decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        evidenceId: expect.stringContaining('1500'),
        details: expect.objectContaining({
          decision: 'REJECT', prefilterDecision: 'REJECT', reason: 'before-owner-generation', rawOrdinal: null,
        }),
      }),
      expect.objectContaining({
        evidenceId: expect.stringContaining('2400'),
        details: expect.objectContaining({
          decision: 'REJECT', prefilterDecision: 'REJECT', reason: 'stale-or-equal-observation', rawOrdinal: null,
        }),
      }),
      expect.objectContaining({
        details: expect.objectContaining({
          prefilterDecision: 'PASS', rawOrdinal: 1,
        }),
      }),
    ]));
  });

  it('records an explicit prefilter disposition for malformed native observations', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-invalid', true, {
      clientActivityId: 'activity-invalid',
      userId: 'user-a',
      ownerGeneration: 'generation-invalid',
      segmentId: 'segment-invalid',
      activityMode: 'hiking',
      acceptAfterMs: 1,
    });
    await handler({
      data: { locations: [pointAt(3_000, Number.NaN, 174)] },
      error: null,
    });
    expect(appendBackgroundHikePoints).not.toHaveBeenCalled();
    expect(recordActivityStageEvent).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'observation-decision',
      details: expect.objectContaining({
        decision: 'REJECT',
        prefilterDecision: 'REJECT',
        reason: 'invalid-coordinate-or-timestamp',
        rawOrdinal: null,
      }),
    }));
  });

  it('does not publish until the Activity journal commit completes, then rejects callbacks after the durable Finish fence', async () => {
    let finishWrite: (() => void) | undefined;
    appendBackgroundHikePoints.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve; }));
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-1',
      segmentId: 'segment-1',
      activityMode: 'running',
      acceptAfterMs: 1_000,
    });

    const delivery = handler({ data: { locations: [point(2_000)] }, error: null });
    for (let turn = 0; turn < 20 && !finishWrite; turn += 1) await Promise.resolve();
    expect(finishWrite).toBeDefined();
    expect(task.drainBackgroundLocations()).toEqual([]);
    finishWrite?.();
    await delivery;
    expect(task.drainBackgroundLocations()).toHaveLength(1);

    await task.persistBackgroundContext(null, false);
    appendBackgroundHikePoints.mockClear();
    await handler({ data: { locations: [point(3_000)] }, error: null });
    expect(appendBackgroundHikePoints).not.toHaveBeenCalled();
    expect(task.drainBackgroundLocations()).toEqual([]);
  });

  it('assigns repeated long-loss reacquisitions to independent real segments', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-1',
      segmentId: 'segment-1',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });

    await handler({
      data: { locations: [
        point(1_000, -41),
        point(11_000, -41.0001),
        point(601_000, -41.01),
        point(611_000, -41.0101),
        point(1_301_000, -41.02),
        point(1_311_000, -41.0201),
      ] },
      error: null,
    });

    const accepted = appendBackgroundHikePoints.mock.calls[0][0];
    expect(new Set(accepted.map((item: any) => item.segmentId))).toHaveProperty('size', 3);
    expect(accepted.filter((item: any) => item.segmentStartReason === 'gps-reacquired')).toHaveLength(2);
  });

  it('journals a corroborated quarantined turn before its confirming fix', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-1',
      segmentId: 'segment-1',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });
    const north10 = 10 / 111_320;
    const east25 = 25 / (111_320 * Math.cos(41 * Math.PI / 180));
    const east35 = 35 / (111_320 * Math.cos(41 * Math.PI / 180));
    await handler({
      data: { locations: [
        pointAt(1_000, -41, 174),
        pointAt(5_000, -41 + north10, 174),
        pointAt(9_000, -41 + north10 * 2, 174),
        pointAt(13_000, -41 + north10 * 2, 174 + east25, 12),
        pointAt(17_000, -41 + north10 * 2, 174 + east35, 8),
      ] },
      error: null,
    });

    const accepted = appendBackgroundHikePoints.mock.calls[0][0];
    expect(accepted.map((item: any) => item.t)).toEqual([1_000, 5_000, 9_000, 13_000, 17_000]);
    expect(accepted[3]).toMatchObject({ canonicalDecision: 'ACCEPT' });
    expect(task.drainBackgroundLocations().map((item: any) => item.timestamp))
      .toEqual([1_000, 5_000, 9_000, 13_000, 17_000]);
  });

  it('sorts a contiguous delayed native callback before the monotonic WAL boundary', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-batch', true, {
      clientActivityId: 'activity-batch',
      userId: 'user-a',
      ownerGeneration: 'generation-batch',
      segmentId: 'segment-batch',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });

    // Expo may hand TaskManager multiple CLLocation values in one callback.
    // The native callback boundary, not fixture array order, owns chronology.
    await handler({
      data: { locations: [
        pointAt(9_000, -41.00008, 174),
        pointAt(1_000, -41, 174),
        pointAt(5_000, -41.00004, 174),
      ] },
      error: null,
    });

    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(appendBackgroundHikePoints.mock.calls[0][0].map((item: any) => item.t))
      .toEqual([1_000, 5_000, 9_000]);
    expect(task.drainBackgroundLocations().map((item: any) => item.timestamp))
      .toEqual([1_000, 5_000, 9_000]);
  });

  it('keeps owner identity on fresh non-ACCEPT Task decisions', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-refine', true, {
      clientActivityId: 'activity-refine',
      userId: 'user-a',
      ownerGeneration: 'generation-refine',
      segmentId: 'segment-refine',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });
    const north10 = 10 / 111_320;
    const east25 = 25 / (111_320 * Math.cos(41 * Math.PI / 180));
    await handler({
      data: { locations: [
        pointAt(1_000, -41, 174),
        pointAt(5_000, -41 + north10, 174),
        pointAt(9_000, -41 + north10 * 2, 174),
        pointAt(41_000, -41 + north10 * 2, 174 + east25, 12),
      ] },
      error: null,
    });
    const classified = task.drainBackgroundLocations();
    expect(classified[classified.length - 1]).toEqual(expect.objectContaining({
      timestamp: 41_000,
      clientActivityId: 'activity-refine',
      ownerGeneration: 'generation-refine',
      segmentId: 'segment-refine',
      canonicalDecision: expect.stringMatching(/REFINE|QUARANTINE|REJECT/),
      continuityPreclassified: true,
    }));
  });

  it('stages a silence gap before a recovering background callback replaces its anchor', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(132_000);
    try {
      const task = require('../backgroundLocationTask');
      await task.persistBackgroundContext('activity-gap-recovery', true, {
        clientActivityId: 'activity-gap-recovery',
        userId: 'user-a',
        ownerGeneration: 'generation-gap',
        segmentId: 'segment-gap',
        activityMode: 'hiking',
        acceptAfterMs: 1_000,
        sourceExpectedSinceMs: 1_000,
        latestJsCallbackReceipt: {
          receiptWallTimeMs: 1_000,
          source: 'background',
          batchSize: 1,
          validObservationCount: 1,
          errorDelivered: false,
        },
      });
      await handler({ data: { locations: [point(132_000)] }, error: null });
      expect(recordActivityStageEventDurably).toHaveBeenCalledWith(expect.objectContaining({
        evidenceId: 'activity-gap-recovery:silence:1000',
        details: expect.objectContaining({
          trigger: 'task-receipt',
          jsCallbackObservedAtDetection: true,
          callbackDeliveryWithinSilentInterval: false,
        }),
      }));
      const context = JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]);
      expect(context.latestJsCallbackReceipt.receiptWallTimeMs).toBe(132_000);
      expect(context.silenceGapReportedForReceiptWallTimeMs).toBe(1_000);
      expect(context.pendingSilenceGap).toBeNull();
    } finally {
      now.mockRestore();
    }
  });

  it('persists callback and valid-observation liveness even when the canonical WAL rejects', async () => {
    appendBackgroundHikePoints.mockRejectedValueOnce(new Error('synthetic-wal-failure'));
    const now = jest.spyOn(Date, 'now').mockReturnValue(132_000);
    try {
      const task = require('../backgroundLocationTask');
      await task.persistBackgroundContext('activity-wal-failure', true, {
        clientActivityId: 'activity-wal-failure',
        userId: 'user-a',
        ownerGeneration: 'generation-wal',
        segmentId: 'segment-wal',
        activityMode: 'hiking',
        acceptAfterMs: 1_000,
        sourceExpectedSinceMs: 1_000,
      });
      await handler({ data: { locations: [point(132_000)] }, error: null });
      const context = JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]);
      expect(context.latestJsCallbackReceipt).toEqual(expect.objectContaining({
        receiptWallTimeMs: 132_000,
        validObservationCount: 1,
        errorDelivered: false,
      }));
      expect(context.latestSourceReceipt).toEqual({
        observationTimeMs: 132_000,
        receiptWallTimeMs: 132_000,
        source: 'background',
      });
      expect(task.drainBackgroundLocations()).toEqual([]);
      expect(recordActivityStageEvent).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'native-js-delivery',
        details: expect.objectContaining({ validObservationCount: 1 }),
      }));
    } finally {
      now.mockRestore();
    }
  });

  it('replays a pending silence gap until the strict ledger write is acknowledged', async () => {
    recordActivityStageEventDurably.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-gap-crash', true, {
      clientActivityId: 'activity-gap-crash',
      userId: 'user-a',
      ownerGeneration: 'generation-crash',
      segmentId: 'segment-crash',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
      sourceExpectedSinceMs: 1_000,
    });
    const gap = await task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-gap-crash',
      ownerGeneration: 'generation-crash',
      nowMs: 131_000,
      thresholdMs: 60_000,
    });
    await expect(task.persistDurableSilenceGapEvent({
      ownerUserId: 'user-a', gap, trigger: 'process-recovery',
    })).resolves.toBe(false);
    expect(JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]).pendingSilenceGaps)
      .toEqual([expect.objectContaining({ evidenceId: gap.evidenceId })]);
    const replay = await task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-gap-crash',
      ownerGeneration: 'generation-crash',
      nowMs: 140_000,
      thresholdMs: 60_000,
    });
    expect(replay).toEqual(gap);
    await expect(task.persistDurableSilenceGapEvent({
      ownerUserId: 'user-a', gap: replay, trigger: 'process-recovery',
    })).resolves.toBe(true);
    expect(JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]).pendingSilenceGap).toBeNull();
    expect(JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]).pendingSilenceGaps).toEqual([]);
  });

  it('retains multiple SILENCE_GAP intervals when strict writes fail across later callbacks and recovery', async () => {
    recordActivityStageEventDurably.mockResolvedValue(false);
    const now = jest.spyOn(Date, 'now');
    try {
      const task = require('../backgroundLocationTask');
      await task.persistBackgroundContext('activity-multi-gap', true, {
        clientActivityId: 'activity-multi-gap',
        userId: 'user-a',
        ownerGeneration: 'generation-multi-gap',
        segmentId: 'segment-multi-gap',
        activityMode: 'hiking',
        acceptAfterMs: 1_000,
        sourceExpectedSinceMs: 1_000,
        latestJsCallbackReceipt: {
          receiptWallTimeMs: 1_000,
          source: 'background',
          batchSize: 0,
          validObservationCount: 0,
          errorDelivered: false,
        },
      });

      now.mockReturnValue(121_000);
      await handler({ data: { locations: [] }, error: null });
      now.mockReturnValue(130_000);
      await handler({ data: { locations: [] }, error: null });
      now.mockReturnValue(260_000);
      await handler({ data: { locations: [] }, error: null });

      const context = JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]);
      expect(context.pendingSilenceGaps).toEqual([
        expect.objectContaining({ evidenceId: 'activity-multi-gap:silence:1000' }),
        expect.objectContaining({ evidenceId: 'activity-multi-gap:silence:130000' }),
      ]);
      expect(context.pendingSilenceGap).toBeNull();
      expect(JSON.stringify(context.pendingSilenceGaps))
        .not.toMatch(/latitude|longitude|coordinates|"lat"|"lng"/i);

      recordActivityStageEventDurably.mockResolvedValue(true);
      const recovered = await task.detectDurableSilenceGapsAfterResume({
        ownerUserId: 'user-a',
        clientActivityId: 'activity-multi-gap',
        ownerGeneration: 'generation-multi-gap',
        nowMs: 260_001,
        thresholdMs: 60_000,
      });
      expect(recovered.map((gap: any) => gap.evidenceId)).toEqual([
        'activity-multi-gap:silence:1000',
        'activity-multi-gap:silence:130000',
      ]);
      await expect(task.persistPendingDurableSilenceGapEvents({
        ownerUserId: 'user-a',
        gaps: recovered,
        trigger: 'process-recovery',
      })).resolves.toBe(2);
      expect(JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT]).pendingSilenceGaps).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it('bounds exact SILENCE_GAP retention and durably exports cumulative overflow on cold recovery', async () => {
    const task = require('../backgroundLocationTask');
    const pendingSilenceGaps = Array.from({ length: 70 }, (_, index) => {
      const anchor = (index + 1) * 1_000;
      return {
        evidenceId: `activity-gap-cap:silence:${anchor}`,
        clientActivityId: 'activity-gap-cap',
        ownerGeneration: 'generation-gap-cap',
        detectedAtMs: 100_000 + anchor,
        anchorReceiptWallTimeMs: anchor,
        lastObservationTimeMs: null,
        durationMs: 100_000,
        source: 'background',
        classification: 'SILENCE_GAP',
        upstreamCause: 'UPSTREAM_UNKNOWN',
        nativeVisibility: 'NATIVE_UNOBSERVABLE',
      };
    });
    await task.persistBackgroundContext('activity-gap-cap', true, {
      clientActivityId: 'activity-gap-cap',
      userId: 'user-a',
      ownerGeneration: 'generation-gap-cap',
      segmentId: 'segment-gap-cap',
      activityMode: 'hiking',
      acceptAfterMs: 70_000,
      sourceExpectedSinceMs: 1_000,
      silenceGapReportedForReceiptWallTimeMs: 70_000,
      latestJsCallbackReceipt: {
        receiptWallTimeMs: 70_000,
        source: 'background',
        batchSize: 0,
        validObservationCount: 0,
        errorDelivered: false,
      },
      pendingSilenceGaps,
    });

    let cold = await task.readDurableActivityContext();
    expect(cold.pendingSilenceGaps).toHaveLength(task.MAX_PENDING_DURABLE_SILENCE_GAPS);
    expect(cold.pendingSilenceGaps[0].anchorReceiptWallTimeMs).toBe(7_000);
    expect(cold.silenceGapOverflow).toEqual(expect.objectContaining({
      droppedCount: 6,
      reportedDroppedCount: 0,
      firstDroppedAnchorReceiptWallTimeMs: 1_000,
      lastDroppedAnchorReceiptWallTimeMs: 6_000,
      classification: 'SILENCE_GAP_RETENTION_OVERFLOW',
      upstreamCause: 'UPSTREAM_UNKNOWN',
      nativeVisibility: 'NATIVE_UNOBSERVABLE',
    }));

    const recovered = await task.detectDurableSilenceGapsAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-gap-cap',
      ownerGeneration: 'generation-gap-cap',
      nowMs: 170_000,
      thresholdMs: 60_000,
    });
    await task.persistPendingDurableSilenceGapEvents({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-gap-cap',
      ownerGeneration: 'generation-gap-cap',
      gaps: recovered,
      trigger: 'process-recovery',
    });

    expect(recordActivityStageEventDurably).toHaveBeenCalledWith(expect.objectContaining({
      evidenceId: 'activity-gap-cap:silence-overflow:6',
      details: expect.objectContaining({
        eventCode: 'ACTIVITY_SILENCE_GAP_RETENTION_OVERFLOW',
        retainedExactIntervalLimit: task.MAX_PENDING_DURABLE_SILENCE_GAPS,
        cumulativeDroppedIntervalCount: 6,
        movementDuringIntervals: 'UNKNOWN',
        syntheticLocationCreated: false,
      }),
    }));
    cold = await task.readDurableActivityContext();
    expect(cold.pendingSilenceGaps).toEqual([]);
    expect(cold.silenceGapOverflow.reportedDroppedCount).toBe(6);
    expect(JSON.stringify(cold.silenceGapOverflow))
      .not.toMatch(/latitude|longitude|coordinates|"lat"|"lng"/i);
  });

  it('wakes foreground projection only after the Task batch is durable', async () => {
    const task = require('../backgroundLocationTask');
    const wake = jest.fn();
    task.setActivityTaskForegroundProjectionWake(wake);
    await task.persistBackgroundContext('activity-visible', true, {
      clientActivityId: 'activity-visible',
      userId: 'user-a',
      ownerGeneration: 'generation-visible',
      segmentId: 'segment-visible',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });

    await handler({ data: { locations: [point(2_000)] }, error: null });

    expect(appendBackgroundHikePoints).toHaveBeenCalledTimes(1);
    expect(wake).toHaveBeenCalledWith({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-visible',
      ownerGeneration: 'generation-visible',
      receiptWallTimeMs: expect.any(Number),
    });
    expect(task.drainBackgroundLocations()).toHaveLength(1);
  });

  it('commits durable Memory responsibility after WAL without a mounted React screen', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-a', true, {
      clientActivityId: 'activity-a',
      userId: 'user-a',
      ownerGeneration: 'generation-1',
      segmentId: 'segment-1',
      activityMode: 'running',
      acceptAfterMs: 1_000,
    });

    await handler({ data: { locations: [point(1_000), point(5_000, -40.99995)] }, error: null });

    expect(scheduleActivityMemoryProjection).toHaveBeenCalledTimes(1);
    expect(scheduleActivityMemoryProjection).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'user-a',
      ownerGeneration: 'generation-1',
      clientActivityId: 'activity-a',
      points: expect.arrayContaining([expect.objectContaining({ t: 1_000, segmentId: 'segment-1' })]),
    }));
    expect(recordMemoryEvidence).not.toHaveBeenCalled();
    expect(flushRecordedMemoryEvidence).not.toHaveBeenCalled();
  });

  it('persists and deduplicates a privacy-safe SILENCE_GAP after JavaScript resumes', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-silent', true, {
      clientActivityId: 'activity-silent',
      userId: 'user-a',
      ownerGeneration: 'generation-silent',
      segmentId: 'segment-silent',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
      sourceExpectedSinceMs: 1_000,
    });

    const gap = await task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-silent',
      ownerGeneration: 'generation-silent',
      nowMs: 121_000,
      thresholdMs: 60_000,
    });
    expect(gap).toEqual({
      evidenceId: 'activity-silent:silence:1000',
      clientActivityId: 'activity-silent',
      ownerGeneration: 'generation-silent',
      detectedAtMs: 121_000,
      anchorReceiptWallTimeMs: 1_000,
      lastObservationTimeMs: null,
      durationMs: 120_000,
      source: 'awaiting-first-callback',
      classification: 'SILENCE_GAP',
      upstreamCause: 'UPSTREAM_UNKNOWN',
      nativeVisibility: 'NATIVE_UNOBSERVABLE',
    });
    await expect(task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-silent',
      ownerGeneration: 'generation-silent',
      nowMs: 181_000,
      thresholdMs: 60_000,
    })).resolves.toEqual(gap);
    await expect(task.persistDurableSilenceGapEvent({
      ownerUserId: 'user-a',
      gap,
      trigger: 'foreground-resume',
    })).resolves.toBe(true);
    await expect(task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-silent',
      ownerGeneration: 'generation-silent',
      nowMs: 181_000,
      thresholdMs: 60_000,
    })).resolves.toBeNull();

    const persisted = values[task.STORAGE_KEY_ACTIVITY_CONTEXT];
    expect(persisted).toContain('silenceGapReportedForReceiptWallTimeMs');
    expect(recordActivityStageEventDurably).toHaveBeenCalledWith(expect.objectContaining({
      evidenceId: 'activity-silent:silence:1000',
      details: expect.objectContaining({ syntheticLocationCreated: false }),
    }));
    expect(persisted).not.toMatch(/latitude|longitude|coordinates|\"lat\"|\"lng\"/i);
  });

  it('never attributes a silence interval to a stale Activity owner', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-current', true, {
      clientActivityId: 'activity-current',
      userId: 'user-a',
      ownerGeneration: 'generation-current',
      segmentId: 'segment-current',
      activityMode: 'running',
      acceptAfterMs: 1_000,
    });
    await expect(task.detectDurableSilenceGapAfterResume({
      ownerUserId: 'user-a',
      clientActivityId: 'activity-old',
      ownerGeneration: 'generation-old',
      nowMs: 200_000,
    })).resolves.toBeNull();
  });

  it('startup reconciliation preserves a legitimate cold-recovery owner', async () => {
    const task = require('../backgroundLocationTask');
    await task.persistBackgroundContext('activity-cold', true, {
      clientActivityId: 'activity-cold',
      userId: 'user-a',
      ownerGeneration: 'generation-cold',
      segmentId: 'segment-cold',
      activityMode: 'hiking',
      acceptAfterMs: 1_000,
    });
    taskDefined = true;
    hasStartedLocationUpdatesAsync.mockResolvedValue(true);
    await expect(task.reconcileActivityBackgroundTaskOnStartup())
      .resolves.toBe('preserved-active-owner');
    expect(stopLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('does not hold durable ownership behind a slow startup orphan probe or stop a fresh Start lease', async () => {
    let resolveProbe!: (started: boolean) => void;
    hasStartedLocationUpdatesAsync.mockImplementation(() => new Promise<boolean>(resolve => {
      resolveProbe = resolve;
    }));
    const task = require('../backgroundLocationTask');
    taskDefined = true;
    const startup = task.reconcileActivityBackgroundTaskOnStartup({
      isTaskDefined: () => true,
      hasStarted: hasStartedLocationUpdatesAsync,
      stop: stopLocationUpdatesAsync,
    });
    for (let turn = 0; turn < 50 && !resolveProbe; turn += 1) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    expect(resolveProbe).toBeDefined();
    const acquire = task.persistBackgroundContext('activity-new', true, {
      clientActivityId: 'activity-new',
      userId: 'user-a',
      ownerGeneration: 'generation-new',
      segmentId: 'segment-new',
      activityMode: 'hiking',
      acceptAfterMs: 2_000,
    });
    await expect(acquire).resolves.toBe(true);
    resolveProbe(true);
    await expect(startup).resolves.toBe('preserved-active-owner');
    expect(stopLocationUpdatesAsync).not.toHaveBeenCalled();
    expect(JSON.parse(values[task.STORAGE_KEY_ACTIVITY_CONTEXT])).toMatchObject({
      clientActivityId: 'activity-new', ownerGeneration: 'generation-new',
    });
  });
});
