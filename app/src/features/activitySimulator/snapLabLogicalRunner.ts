import { activitySimulatorEngine } from './activitySimulatorEngine';
import { useActivitySimulatorStore } from './useActivitySimulatorStore';
import {
  configureSnapLabRun,
  currentSnapLabRunContext,
  clearSnapLabRealmForOwner,
  loadSnapLabActivity,
  recordSnapLabDetailLoaded,
  runSnapLabFinal,
  saveSnapLabRouteSnapshot,
  upgradeSnapLabActivityOnce,
  type SnapLabActivityRecord,
  type SnapLabRunContext,
} from './snapLabActivityStore';
import { clearSimulatorLogs, readSimulatorDiagnostics } from './simulatorLog';
import {
  createSnapLabSyntheticGraphTransport,
  type SnapLabSyntheticBarrier,
} from './snapLabSyntheticTransport';
import {
  clearSnapLabFaultPlan,
  configureSnapLabFaultPlan,
  snapLabFaultPlanSnapshot,
} from './snapLabFaultInjection';
import { useTrackingStore, type ActivityCoordinate } from '../../store/useTrackingStore';
import { useMemoryStore } from '../memory/store/useMemoryStore';
import { flushSyntheticMemoryNow } from '../memory/services/memoryPersistence';
import { clearSyntheticMemoryForUser } from '../memory/services/memoryPersistence';
import { readHikeTrackForProjection } from '../../services/hikeTrackWriter';
import { purgeActivityStageLedgerRealmForOwner } from '../activity/activityStageLedger';

export interface SnapLabPublicRawEvent {
  ordinal: number;
  observationTimeMs: number;
  deliveryTimeMs: number;
  appState: string;
  observedLocal?: { x: number; y: number };
  coordinate: { lat: number; lng: number };
  accuracyM: number;
  speedMps: number | null;
  speedAccuracyMps: number | null;
  source: 'simulator';
}

export interface SnapLabPublicFixture {
  schema: string;
  fixtureSha256: string;
  caseId: string;
  mode: 'hike' | 'run';
  profile: string;
  seed: number;
  contractIntent: { scenario: string; transportFixture: string; oracleRequirements: string };
  durationSeconds: number;
  clock: {
    observationStartMs: number;
    observationEndMs: number;
    observationIntervalSeconds: number;
    deliveryMode: string;
  };
  availableMap: {
    origin: { lat: number; lng: number };
    paths: Array<{
      id: string;
      name: string;
      kind: string;
      coordinates: Array<{ lat: number; lng: number }>;
    }>;
    barriers?: SnapLabSyntheticBarrier[];
  };
  rawEvents: SnapLabPublicRawEvent[];
  lifecycle: {
    trueBlackout: boolean;
    offlineAtFinish: boolean;
    restoreOnlineAfterColdOpen: boolean;
    slowDiagnosticWriteMs: number;
    walReadFaultOnce: boolean;
    yieldedFinish: boolean;
  };
  transportScenario: string;
  transportConfig?: {
    failureMode?: 'none' | 'timeout' | 'nomatch' | 'auth-then-unavailable';
    forceLowMatchingConfidence?: boolean;
  };
}

export interface SnapLabLogicalRunOptions {
  ownerUserId: string;
  activityId: string;
  activityName: string;
  matrixSha256: string;
  retainQaRealmForDetailCapture?: boolean;
}

export interface SnapLabLogicalRunResult {
  platform: 'EXPO_WEB_ACTUAL_APP';
  activityId: string;
  context: SnapLabRunContext;
  rawEventCount: number;
  acceptedCallbackCount: number;
  rejectedCallbackCount: number;
  acceptanceReasons: Record<string, number>;
  preFinish: {
    rawPointCount: number;
    canonicalPointCount: number;
    livePointCount: number;
    segmentCount: number;
    qaMemoryPointCount: number;
    personalMemoryPointCount: number;
    distanceM: number;
  };
  firstFinishResult: unknown;
  retryFinishResult: unknown;
  persisted: SnapLabActivityRecord;
  coldReopened: SnapLabActivityRecord;
  completedWalPointCount: number;
  offlineUpgrade: null | {
    firstStatus: string;
    secondStatus: string;
    snapshotFingerprintBefore: string;
    snapshotFingerprintAfter: string;
  };
  simulatorDiagnostics: string;
  cleanupStatus: { status: 'cleared' | 'retained-for-detail-capture' | 'failed'; reason: string | null };
  hostPerformance: {
    replayDurationMs: number;
    finishDurationMs: number;
    performanceObserverSupported: boolean;
    longTaskCount: number;
    maxObservationWallTimeMs: number;
    maxObservationWorkMs: number;
    meanObservationWorkMs: number;
    p95ObservationWorkMs: number;
    slowestObservations: Array<{ ordinal: number; durationMs: number; accepted: boolean; reason: string }>;
    queuedActionLatencyMs: number;
  };
  faultPlanAfter: ReturnType<typeof snapLabFaultPlanSnapshot>;
}

function publicFixtureIsSafe(value: SnapLabPublicFixture & Record<string, unknown>): boolean {
  return !('truthPrivate' in value)
    && !('oraclePrivate' in value)
    && Array.isArray(value.rawEvents)
    && value.rawEvents.every(event => !('truth' in (event as unknown as Record<string, unknown>)));
}

function segmentCount(points: Array<{ segmentId?: string }>): number {
  return new Set(points.map(point => point.segmentId ?? 'legacy')).size;
}

function receiptBatchOrdinals(events: SnapLabPublicRawEvent[]): Map<number, number> {
  const deliveries = [...new Set(events.map(event => event.deliveryTimeMs))].sort((a, b) => a - b);
  return new Map(deliveries.map((value, index) => [value, index + 1]));
}

function transportFor(fixture: SnapLabPublicFixture) {
  return createSnapLabSyntheticGraphTransport({
    caseId: fixture.caseId,
    profileId: fixture.profile,
    scenario: fixture.contractIntent.scenario,
    map: fixture.availableMap,
    failureMode: fixture.transportConfig?.failureMode ?? 'none',
    forceLowMatchingConfidence: fixture.transportConfig?.forceLowMatchingConfidence,
  });
}

/**
 * Drives the actual tracking store, continuity classifier, append-only WAL,
 * causal Live presentation, QA Memory, Finish, persisted Detail datasource,
 * and cold storage read. Latent truth/oracle are rejected at this boundary.
 */
export async function runSnapLabLogicalJourney(
  fixture: SnapLabPublicFixture,
  options: SnapLabLogicalRunOptions,
): Promise<SnapLabLogicalRunResult> {
  if (!publicFixtureIsSafe(fixture as SnapLabPublicFixture & Record<string, unknown>)) {
    throw new Error('snap_lab_private_authority_crossed_product_boundary');
  }
  if (!options.activityId.startsWith('qa-snap-')) throw new Error('snap_lab_activity_identity_required');
  if (useTrackingStore.getState().status !== 'idle') throw new Error('snap_lab_runner_requires_idle_activity');
  const firstRaw = fixture.rawEvents[0];
  if (!firstRaw) throw new Error('snap_lab_fixture_has_no_observations');

  // Each matrix cell is an independent experiment. The orchestrator retains
  // the returned cold-reopened QA Activity snapshot before this disposable
  // browser realm is purged, so app storage never hits origin quota during a
  // 144-cell matrix and one case cannot consume another case's host budget.
  await clearSyntheticMemoryForUser(options.ownerUserId);
  await purgeActivityStageLedgerRealmForOwner(options.ownerUserId, 'snap-lab');
  useActivitySimulatorStore.getState().endQaSession();
  await clearSimulatorLogs(options.ownerUserId);
  useActivitySimulatorStore.getState().beginQaSession(options.ownerUserId, true);

  const originalDateNow = Date.now;
  // simulatorActivityStartTimestamp reserves exactly this historical window.
  // Pinning Start to observationStart + reserve makes fixture timestamps the
  // provider timeline while processing/delivery remains a distinct clock.
  let logicalWallNow = fixture.clock.observationStartMs + 12 * 60 * 60_000 + 60_000;
  Date.now = () => logicalWallNow;
  const hostRunStarted = performance.now();
let firstFinishResult: unknown = null;
  let retryFinishResult: unknown = null;
  let finishDurationMs = 0;
  try {
    const context: SnapLabRunContext = {
      caseId: fixture.caseId,
      profileId: fixture.profile,
      seed: fixture.seed,
      networkCondition: fixture.lifecycle.offlineAtFinish
        ? 'offline-at-finish'
        : fixture.transportConfig?.failureMode && fixture.transportConfig.failureMode !== 'none'
          ? fixture.transportConfig.failureMode
          : 'deterministic-online',
      transportMode: fixture.lifecycle.offlineAtFinish ? 'offline' : 'deterministic',
      evidenceLabel: fixture.lifecycle.offlineAtFinish ? 'LOCAL_ONLY' : 'DETERMINISTIC_TRANSPORT',
      matrixSha256: options.matrixSha256,
      requestIdentity: fixture.fixtureSha256,
      clockSpeed: 1,
    };
    const initialTransport = fixture.lifecycle.offlineAtFinish ? null : transportFor(fixture);
    configureSnapLabRun(context, initialTransport?.fetch, initialTransport?.receipts);
    configureSnapLabFaultPlan(options.activityId, {
      diagnosticWriteDelayMs: fixture.lifecycle.slowDiagnosticWriteMs,
      diagnosticWritesRemaining: fixture.lifecycle.slowDiagnosticWriteMs > 0 ? 3 : 0,
      terminalWalReadFaultsRemaining: fixture.lifecycle.walReadFaultOnce ? 1 : 0,
    });

    const simulator = useActivitySimulatorStore.getState();
    useActivitySimulatorStore.setState({ hydratedUserId: options.ownerUserId });
    simulator.setEnabled(true);
    simulator.setOrigin(firstRaw.coordinate);
    simulator.setObservationMode('raw-gps');
    simulator.setDeterministicSeed(fixture.seed);
    simulator.setSignal('normal');
    useTrackingStore.getState().setActivityMode(fixture.mode === 'run' ? 'running' : 'hiking');
    activitySimulatorEngine.armExternalRawReplay();
    const started = await useTrackingStore.getState().startTracking(options.activityId);
    if (!started) throw new Error(`snap_lab_start_failed:${useTrackingStore.getState().startError ?? 'unknown'}`);
    await activitySimulatorEngine.stopRuntime();

    const owner = useTrackingStore.getState();
    if (owner.sessionId !== options.activityId || !owner.liveOwnerGeneration) {
      throw new Error('snap_lab_start_owner_mismatch');
    }
    const batchOrdinals = receiptBatchOrdinals(fixture.rawEvents);
    const batchIndexes = new Map<number, number>();
    const acceptanceReasons: Record<string, number> = {};
    const observationDurations: number[] = [];
    const observationWork: Array<{ ordinal: number; durationMs: number; accepted: boolean; reason: string }> = [];
    const replayLongTasks: Array<{ startTime: number; duration: number }> = [];
    const observationIntervals: Array<{ startTime: number; endTime: number }> = [];
    let longTaskObserver: PerformanceObserver | null = null;
    try {
      if (typeof PerformanceObserver === 'function') {
        longTaskObserver = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            replayLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
          }
        });
        longTaskObserver.observe({ entryTypes: ['longtask'] });
      }
    } catch {
      longTaskObserver = null;
    }
    let acceptedCallbackCount = 0;
    let rejectedCallbackCount = 0;
    const replayStartedAt = performance.now();
    for (const event of fixture.rawEvents) {
      logicalWallNow = fixture.clock.observationStartMs
        + 12 * 60 * 60_000 + 60_000
        + Math.max(0, event.deliveryTimeMs - fixture.clock.observationStartMs);
      const batchIndex = batchIndexes.get(event.deliveryTimeMs) ?? 0;
      batchIndexes.set(event.deliveryTimeMs, batchIndex + 1);
      useActivitySimulatorStore.setState({
        current: { ...event.coordinate },
        virtualTimestampMs: event.observationTimeMs,
        effectiveVirtualElapsedMs: Math.max(0, event.observationTimeMs - fixture.clock.observationStartMs),
        batchSequence: batchOrdinals.get(event.deliveryTimeMs) ?? 1,
      });
      const coordinate: ActivityCoordinate = {
        ...event.coordinate,
        accuracy: event.accuracyM,
        speed: event.speedMps,
        speedAccuracy: event.speedAccuracyMps,
        source: 'simulator',
        simulatorObservationMode: 'raw-gps',
        clientActivityId: options.activityId,
        ownerGeneration: owner.liveOwnerGeneration,
        receiptWallTimeMs: logicalWallNow,
        receiptMonotonicTimeMs: performance.now(),
        callbackIdentity: `snap-lab:${fixture.caseId}:${fixture.profile}`,
        nativeBatchSequence: batchOrdinals.get(event.deliveryTimeMs) ?? 1,
        nativeBatchIndex: batchIndex,
        appStateAtReceipt: event.appState,
      };
      const startedAt = performance.now();
      const decision = await useTrackingStore.getState().addTrackPoint(coordinate, event.observationTimeMs);
      const endedAt = performance.now();
      const durationMs = endedAt - startedAt;
      observationIntervals.push({ startTime: startedAt, endTime: endedAt });
      observationDurations.push(durationMs);
      const reason = decision.reason ?? (decision.accepted ? 'accepted' : 'rejected');
      observationWork.push({ ordinal: event.ordinal, durationMs, accepted: decision.accepted, reason });
      acceptanceReasons[reason] = (acceptanceReasons[reason] ?? 0) + 1;
      if (decision.accepted) acceptedCallbackCount += 1;
      else rejectedCallbackCount += 1;
      // The fixture advances provider time by seconds while replaying inside
      // one browser turn. Give fire-and-forget diagnostic persistence from
      // this callback one host task boundary before the next callback starts.
      // Otherwise a localStorage-backed Web flush triggered by observation N
      // is incorrectly charged to observation N+1, even though real provider
      // callbacks are separated by their delivery cadence. The timed region
      // above still includes every awaited WAL/Memory/publication obligation;
      // this yield only preserves the product's deliberately asynchronous
      // diagnostic boundary under accelerated replay.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    // PerformanceObserver delivery is asynchronous. One final host task makes
    // every replay long-task entry visible before scoring, then disconnects so
    // Finish/render work is reported separately.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    longTaskObserver?.disconnect();
    const replayDurationMs = performance.now() - replayStartedAt;
    await flushSyntheticMemoryNow();
    const beforeFinish = useTrackingStore.getState();
    const qaMemoryPointCount = useMemoryStore.getState().testPoints.filter(point => (
      point.sourceActivityClientId === options.activityId
    )).length;
    const preFinish = {
      rawPointCount: beforeFinish.trackPointsRaw.length,
      canonicalPointCount: beforeFinish.trackPoints.length,
      livePointCount: beforeFinish.trackPointsSmoothed.length,
      segmentCount: segmentCount(beforeFinish.trackPoints),
      qaMemoryPointCount,
      personalMemoryPointCount: useMemoryStore.getState().points.length,
      distanceM: beforeFinish.distanceM,
    };
    if (preFinish.canonicalPointCount < 2 || preFinish.distanceM < 20) {
      throw new Error(`snap_lab_unsavable_trace:${JSON.stringify(preFinish)}`);
    }
    const finishStartedAt = performance.now();
    firstFinishResult = await useTrackingStore.getState().stopTracking(options.activityName);
    if (fixture.lifecycle.walReadFaultOnce) {
      if ((firstFinishResult as any)?.status !== 'recoverable-failure') {
        throw new Error('snap_lab_wal_fault_did_not_fail_closed');
      }
      retryFinishResult = await useTrackingStore.getState().stopTracking(options.activityName);
    }
    finishDurationMs = performance.now() - finishStartedAt;
    const terminalResult = retryFinishResult ?? firstFinishResult;
    if (!['saved', 'saved-local'].includes((terminalResult as any)?.status)) {
      throw new Error(`snap_lab_finish_not_saved:${JSON.stringify(terminalResult)}`);
    }

    let persisted = await loadSnapLabActivity(options.ownerUserId, options.activityId);
    if (!persisted) throw new Error('snap_lab_persisted_activity_missing');
    let offlineUpgrade: SnapLabLogicalRunResult['offlineUpgrade'] = null;
    if (fixture.lifecycle.offlineAtFinish && fixture.lifecycle.restoreOnlineAfterColdOpen) {
      const snapshot = await saveSnapLabRouteSnapshot(
        options.ownerUserId,
        options.activityId,
        `${fixture.caseId} stable local route`,
      );
      const restoredTransport = transportFor({
        ...fixture,
        transportConfig: { ...fixture.transportConfig, failureMode: 'none' },
      });
      configureSnapLabRun({
        ...context,
        networkCondition: 'online-restored',
        transportMode: 'deterministic',
        evidenceLabel: 'DETERMINISTIC_TRANSPORT',
      }, restoredTransport.fetch, restoredTransport.receipts);
      const firstUpgrade = await upgradeSnapLabActivityOnce(options.ownerUserId, options.activityId);
      const secondUpgrade = await upgradeSnapLabActivityOnce(options.ownerUserId, options.activityId);
      const snapshotAfter = secondUpgrade.record.routeSnapshots.find(item => item.id === snapshot.id);
      if (!snapshotAfter) throw new Error('snap_lab_upgrade_lost_route_snapshot');
      offlineUpgrade = {
        firstStatus: firstUpgrade.status,
        secondStatus: secondUpgrade.status,
        snapshotFingerprintBefore: snapshot.artifactFingerprint,
        snapshotFingerprintAfter: snapshotAfter.artifactFingerprint,
      };
      persisted = secondUpgrade.record;
    }
    await recordSnapLabDetailLoaded(options.ownerUserId, options.activityId);
    const coldReopened = await loadSnapLabActivity(options.ownerUserId, options.activityId);
    if (!coldReopened) throw new Error('snap_lab_cold_reopen_missing');
    const completedWal = await readHikeTrackForProjection(options.activityId);
    const queuedActionStartedAt = performance.now();
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const queuedActionLatencyMs = performance.now() - queuedActionStartedAt;
    const maxObservationWallTimeMs = observationDurations.length > 0 ? Math.max(...observationDurations) : 0;
    // The frozen budget is for maximum *uninterrupted JS work*. Async callback
    // wall time also contains awaited storage, GC and browser scheduling, so
    // retain it as a separate diagnostic rather than mislabelling it as one
    // blocking task. Chromium's Long Tasks API measures the intended budget;
    // unsupported platforms fall back conservatively to callback wall time.
    // A browser page can perform unrelated React, map, timer or extension work
    // during an accelerated matrix replay. Only Long Tasks whose execution
    // overlaps a provider callback belong to the frozen observation-work
    // budget. This keeps the metric tied to actual event processing while the
    // complete replay wall time remains available above for diagnosis.
    const observationLongTaskSlices = replayLongTasks.flatMap(task => {
      const taskEnd = task.startTime + task.duration;
      return observationIntervals
        .map(interval => Math.max(0, Math.min(taskEnd, interval.endTime) - Math.max(task.startTime, interval.startTime)))
        .filter(duration => duration > 0);
    });
    const maxObservationWorkMs = longTaskObserver
      // A Long Task can begin before a provider callback. Charging its entire
      // duration to the callback makes unrelated work before receipt look like
      // observation work. The overlap is a conservative upper bound for the
      // uninterrupted work attributable to that callback; a callback that
      // itself occupies >100 ms still fails this unchanged frozen criterion.
      ? (observationLongTaskSlices.length > 0 ? Math.max(...observationLongTaskSlices) : 0)
      : maxObservationWallTimeMs;
    const meanObservationWorkMs = observationDurations.length > 0
      ? observationDurations.reduce((sum, value) => sum + value, 0) / observationDurations.length
      : 0;
    const orderedObservationDurations = observationDurations.slice().sort((left, right) => left - right);
    const p95ObservationWorkMs = orderedObservationDurations.length > 0
      ? orderedObservationDurations[Math.floor((orderedObservationDurations.length - 1) * 0.95)]
      : 0;
    const simulatorDiagnostics = await readSimulatorDiagnostics(options.ownerUserId);
    useActivitySimulatorStore.getState().endQaSession();
    await clearSimulatorLogs(options.ownerUserId);
    let cleanupStatus: SnapLabLogicalRunResult['cleanupStatus'] = options.retainQaRealmForDetailCapture
      ? { status: 'retained-for-detail-capture', reason: 'orchestrator must capture Detail then clear this isolated realm' }
      : { status: 'cleared', reason: null };
    if (!options.retainQaRealmForDetailCapture) {
      try {
        await clearSnapLabRealmForOwner(options.ownerUserId);
      } catch (error) {
        cleanupStatus = { status: 'failed', reason: String(error).slice(0, 240) };
      }
    }
    return {
      platform: 'EXPO_WEB_ACTUAL_APP',
      activityId: options.activityId,
      context,
      rawEventCount: fixture.rawEvents.length,
      acceptedCallbackCount,
      rejectedCallbackCount,
      acceptanceReasons,
      preFinish,
      firstFinishResult,
      retryFinishResult,
      persisted,
      coldReopened,
      completedWalPointCount: completedWal.length,
      offlineUpgrade,
      simulatorDiagnostics,
      cleanupStatus,
      hostPerformance: {
        replayDurationMs,
        finishDurationMs,
        performanceObserverSupported: longTaskObserver !== null,
        longTaskCount: observationLongTaskSlices.length,
        maxObservationWallTimeMs,
        maxObservationWorkMs,
        meanObservationWorkMs,
        p95ObservationWorkMs,
        slowestObservations: observationWork
          .slice()
          .sort((left, right) => right.durationMs - left.durationMs)
          .slice(0, 5),
        queuedActionLatencyMs,
      },
      faultPlanAfter: snapLabFaultPlanSnapshot(options.activityId),
    };
  } finally {
    Date.now = originalDateNow;
    clearSnapLabFaultPlan(options.activityId);
    if (useTrackingStore.getState().status !== 'idle') {
      // Leave failures inspectable. Matrix orchestration records the state and
      // explicitly resets its disposable browser profile between failed runs.
      await activitySimulatorEngine.stopRuntime().catch(() => undefined);
    }
  }
}

let uiReplayOriginalDateNow: (() => number) | null = null;
let uiReplayLogicalWallNow: number | null = null;

function beginUiReplayClock(observationStartMs: number): void {
  if (uiReplayOriginalDateNow) throw new Error('snap_lab_ui_clock_already_active');
  uiReplayOriginalDateNow = Date.now;
  uiReplayLogicalWallNow = observationStartMs + 12 * 60 * 60_000 + 60_000;
  Date.now = () => uiReplayLogicalWallNow ?? uiReplayOriginalDateNow!();
}

function endUiReplayClock(): void {
  if (uiReplayOriginalDateNow) Date.now = uiReplayOriginalDateNow;
  uiReplayOriginalDateNow = null;
  uiReplayLogicalWallNow = null;
}

/**
 * Prepare one normal-screen primary journey. The UI still owns Start and
 * Finish; this helper only installs the frozen raw provider/transport and the
 * independent fixture clock before those user actions.
 */
export async function prepareSnapLabUiJourney(
  fixture: SnapLabPublicFixture,
  options: Pick<SnapLabLogicalRunOptions, 'ownerUserId' | 'matrixSha256'>,
): Promise<SnapLabRunContext> {
  if (!publicFixtureIsSafe(fixture as SnapLabPublicFixture & Record<string, unknown>)) {
    throw new Error('snap_lab_private_authority_crossed_product_boundary');
  }
  if (useTrackingStore.getState().status !== 'idle') throw new Error('snap_lab_ui_runner_requires_idle_activity');
  const firstRaw = fixture.rawEvents[0];
  if (!firstRaw) throw new Error('snap_lab_fixture_has_no_observations');
  endUiReplayClock();
  await clearSyntheticMemoryForUser(options.ownerUserId);
  await purgeActivityStageLedgerRealmForOwner(options.ownerUserId, 'snap-lab');
  useActivitySimulatorStore.getState().endQaSession();
  await clearSimulatorLogs(options.ownerUserId);
  useActivitySimulatorStore.getState().beginQaSession(options.ownerUserId, true);
  const context: SnapLabRunContext = {
    caseId: fixture.caseId,
    profileId: fixture.profile,
    seed: fixture.seed,
    networkCondition: fixture.lifecycle.offlineAtFinish
      ? 'offline-at-finish'
      : fixture.transportConfig?.failureMode && fixture.transportConfig.failureMode !== 'none'
        ? fixture.transportConfig.failureMode
        : 'deterministic-online',
    transportMode: fixture.lifecycle.offlineAtFinish ? 'offline' : 'deterministic',
    evidenceLabel: fixture.lifecycle.offlineAtFinish ? 'LOCAL_ONLY' : 'DETERMINISTIC_TRANSPORT',
    matrixSha256: options.matrixSha256,
    requestIdentity: fixture.fixtureSha256,
    clockSpeed: 1,
  };
  const initialTransport = fixture.lifecycle.offlineAtFinish ? null : transportFor(fixture);
  configureSnapLabRun(context, initialTransport?.fetch, initialTransport?.receipts);
  useActivitySimulatorStore.setState({ hydratedUserId: options.ownerUserId });
  const simulator = useActivitySimulatorStore.getState();
  simulator.setEnabled(true);
  simulator.setOrigin(firstRaw.coordinate);
  simulator.setObservationMode('raw-gps');
  simulator.setDeterministicSeed(fixture.seed);
  simulator.setSignal('normal');
  useTrackingStore.getState().setActivityMode(fixture.mode === 'run' ? 'running' : 'hiking');
  activitySimulatorEngine.armExternalRawReplay();
  beginUiReplayClock(fixture.clock.observationStartMs);
  return context;
}

/** Deliver the frozen raw stream only after the ordinary Start button owns the Activity. */
export async function replaySnapLabUiJourney(
  fixture: SnapLabPublicFixture,
  activityId: string,
): Promise<{
  delivered: number;
  accepted: number;
  rejected: number;
  acceptanceReasons: Record<string, number>;
  preFinish: SnapLabLogicalRunResult['preFinish'];
}> {
  if (!publicFixtureIsSafe(fixture as SnapLabPublicFixture & Record<string, unknown>)) {
    throw new Error('snap_lab_private_authority_crossed_product_boundary');
  }
  if (!uiReplayOriginalDateNow || uiReplayLogicalWallNow === null) throw new Error('snap_lab_ui_clock_not_active');
  const owner = useTrackingStore.getState();
  if (owner.sessionId !== activityId || owner.status !== 'tracking' || !owner.liveOwnerGeneration) {
    throw new Error('snap_lab_ui_activity_owner_mismatch');
  }
  configureSnapLabFaultPlan(activityId, {
    diagnosticWriteDelayMs: fixture.lifecycle.slowDiagnosticWriteMs,
    diagnosticWritesRemaining: fixture.lifecycle.slowDiagnosticWriteMs > 0 ? 3 : 0,
    terminalWalReadFaultsRemaining: fixture.lifecycle.walReadFaultOnce ? 1 : 0,
  });
  await activitySimulatorEngine.stopRuntime();
  const batchOrdinals = receiptBatchOrdinals(fixture.rawEvents);
  const batchIndexes = new Map<number, number>();
  const acceptanceReasons: Record<string, number> = {};
  let accepted = 0;
  let rejected = 0;
  for (const event of fixture.rawEvents) {
    uiReplayLogicalWallNow = fixture.clock.observationStartMs
      + 12 * 60 * 60_000 + 60_000
      + Math.max(0, event.deliveryTimeMs - fixture.clock.observationStartMs);
    const batchIndex = batchIndexes.get(event.deliveryTimeMs) ?? 0;
    batchIndexes.set(event.deliveryTimeMs, batchIndex + 1);
    useActivitySimulatorStore.setState({
      current: { ...event.coordinate },
      virtualTimestampMs: event.observationTimeMs,
      effectiveVirtualElapsedMs: Math.max(0, event.observationTimeMs - fixture.clock.observationStartMs),
      batchSequence: batchOrdinals.get(event.deliveryTimeMs) ?? 1,
    });
    const decision = await useTrackingStore.getState().addTrackPoint({
      ...event.coordinate,
      accuracy: event.accuracyM,
      speed: event.speedMps,
      speedAccuracy: event.speedAccuracyMps,
      source: 'simulator',
      simulatorObservationMode: 'raw-gps',
      clientActivityId: activityId,
      ownerGeneration: owner.liveOwnerGeneration,
      receiptWallTimeMs: uiReplayLogicalWallNow,
      receiptMonotonicTimeMs: performance.now(),
      callbackIdentity: `snap-lab-ui:${fixture.caseId}:${fixture.profile}`,
      nativeBatchSequence: batchOrdinals.get(event.deliveryTimeMs) ?? 1,
      nativeBatchIndex: batchIndex,
      appStateAtReceipt: event.appState,
    }, event.observationTimeMs);
    const reason = decision.reason ?? (decision.accepted ? 'accepted' : 'rejected');
    acceptanceReasons[reason] = (acceptanceReasons[reason] ?? 0) + 1;
    if (decision.accepted) accepted += 1;
    else rejected += 1;
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  await flushSyntheticMemoryNow();
  const state = useTrackingStore.getState();
  return {
    delivered: fixture.rawEvents.length,
    accepted,
    rejected,
    acceptanceReasons,
    preFinish: {
      rawPointCount: state.trackPointsRaw.length,
      canonicalPointCount: state.trackPoints.length,
      livePointCount: state.trackPointsSmoothed.length,
      segmentCount: segmentCount(state.trackPoints),
      qaMemoryPointCount: useMemoryStore.getState().testPoints.filter(point => (
        point.sourceActivityClientId === activityId
      )).length,
      personalMemoryPointCount: useMemoryStore.getState().points.length,
      distanceM: state.distanceM,
    },
  };
}

export async function completeSnapLabUiJourney(ownerUserId: string, activityId: string): Promise<{
  simulatorDiagnostics: string;
  faultPlanAfter: ReturnType<typeof snapLabFaultPlanSnapshot>;
}> {
  const simulatorDiagnostics = await readSimulatorDiagnostics(ownerUserId);
  const faultPlanAfter = snapLabFaultPlanSnapshot(activityId);
  useActivitySimulatorStore.getState().endQaSession();
  await clearSimulatorLogs(ownerUserId);
  clearSnapLabFaultPlan(activityId);
  endUiReplayClock();
  return { simulatorDiagnostics, faultPlanAfter };
}

export async function upgradeSnapLabUiJourneyAfterReconnect(
  fixture: SnapLabPublicFixture,
  ownerUserId: string,
  activityId: string,
) {
  const transport = transportFor({
    ...fixture,
    transportConfig: { ...fixture.transportConfig, failureMode: 'none' },
  });
  configureSnapLabRun({
    ...currentSnapLabRunContext(),
    caseId: fixture.caseId,
    profileId: fixture.profile,
    seed: fixture.seed,
    networkCondition: 'online-restored',
    transportMode: 'deterministic',
    evidenceLabel: 'DETERMINISTIC_TRANSPORT',
    requestIdentity: fixture.fixtureSha256,
  }, transport.fetch, transport.receipts);
  const first = await upgradeSnapLabActivityOnce(ownerUserId, activityId);
  const second = await upgradeSnapLabActivityOnce(ownerUserId, activityId);
  return { firstStatus: first.status, secondStatus: second.status, record: second.record };
}

/** Product-boundary helper used by the browser orchestrator. */
export function snapLabPublicFixture(value: Record<string, any>): SnapLabPublicFixture {
  const { truthPrivate: _truth, oraclePrivate: _oracle, ...publicValue } = value;
  return {
    ...publicValue,
    rawEvents: (publicValue.rawEvents ?? []).map((event: Record<string, unknown>) => {
      const { truth: _eventTruth, ...publicEvent } = event;
      return publicEvent;
    }),
  } as SnapLabPublicFixture;
}

/** Direct route-only probe for fixture development; not counted as a matrix journey. */
export async function probeSnapLabFinalForFixture(
  fixture: SnapLabPublicFixture,
  canonical: SnapLabActivityRecord['canonicalPoints'],
) {
  if (!publicFixtureIsSafe(fixture as SnapLabPublicFixture & Record<string, unknown>)) {
    throw new Error('snap_lab_private_authority_crossed_product_boundary');
  }
  const transport = transportFor(fixture);
  configureSnapLabRun({
    caseId: fixture.caseId,
    profileId: fixture.profile,
    seed: fixture.seed,
    networkCondition: 'deterministic-online',
    transportMode: 'deterministic',
    evidenceLabel: 'DETERMINISTIC_TRANSPORT',
    requestIdentity: fixture.fixtureSha256,
  }, transport.fetch, transport.receipts);
  return runSnapLabFinal(canonical);
}
