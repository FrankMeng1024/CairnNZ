import type { CanonicalJournalPoint } from '../../services/hikeTrackWriter';
import type { TrackPoint } from '../../store/useSessionStore';
import {
  appendCausalLiveReplayPoint,
  buildCausalLiveRoute,
  buildCausalLiveRouteCooperatively,
  causalLiveReplayResult,
  createCausalLiveReplayCheckpoint,
  LIVE_MUTABLE_TAIL_MAX_POINTS,
  LIVE_TREND_CONTEXT_MAX_POINTS,
} from './causalLiveRoute';
import {
  activityDistanceEstimate,
  appendActivityDistancePoint,
  buildActivityDistanceAccumulator,
  calculateActivityStats,
  createActivityDistanceAccumulator,
  type ActivityDistanceAccumulator,
} from './activityContracts';
import {
  createElevationQualityState,
  elevationQualityGain,
  reduceElevationObservation,
  type ElevationQualityState,
} from './elevationQuality';
import { activityEvidencePointKey } from './activityEvidenceIdentity';

function pointKey(point: TrackPoint): string {
  return activityEvidencePointKey(point);
}

function asTrackPoint(point: CanonicalJournalPoint | TrackPoint): TrackPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt ?? null,
    accuracy: point.accuracy ?? null,
    verticalAccuracy: point.verticalAccuracy ?? null,
    speed: point.speed ?? null,
    speedAccuracy: point.speedAccuracy ?? null,
    course: point.course ?? null,
    courseAccuracy: point.courseAccuracy ?? null,
    t: Math.floor(point.t),
    rawOrdinal: point.rawOrdinal,
    observationId: point.observationId,
    clientActivityId: point.clientActivityId,
    ownerGeneration: point.ownerGeneration,
    segmentId: point.segmentId,
    segmentStartReason: point.segmentStartReason,
  };
}

function buildElevationProjection(points: ReadonlyArray<TrackPoint>): {
  elevationGainM: number;
  elevationState: ElevationQualityState;
} {
  let elevationState = createElevationQualityState();
  let legacyElevationGainM = 0;
  let previous: TrackPoint | null = null;
  for (const point of points) {
    const segmentId = point.segmentId || 'legacy-0';
    elevationState = reduceElevationObservation(
      elevationState,
      { ...point, segmentId },
    ).state;
    if (previous && (previous.segmentId || 'legacy-0') === segmentId
      && previous.alt != null && point.alt != null && point.alt > previous.alt) {
      legacyElevationGainM += point.alt - previous.alt;
    }
    previous = point;
  }
  return {
    elevationGainM: elevationState.hasVerticalQualityEvidence
      ? elevationQualityGain(elevationState)
      : legacyElevationGainM,
    elevationState,
  };
}

function appendElevationProjection(
  prefix: ReadonlyArray<TrackPoint>,
  suffix: ReadonlyArray<TrackPoint>,
  prefixElevationGainM: number,
  prefixElevationState?: ElevationQualityState,
): { elevationGainM: number; elevationState: ElevationQualityState } {
  if (!prefixElevationState) return buildElevationProjection([...prefix, ...suffix]);
  let elevationState = prefixElevationState;
  let legacyElevationGainM = prefixElevationGainM;
  let previous = prefix[prefix.length - 1] ?? null;
  for (const point of suffix) {
    const segmentId = point.segmentId || 'legacy-0';
    elevationState = reduceElevationObservation(
      elevationState,
      { ...point, segmentId },
    ).state;
    if (!elevationState.hasVerticalQualityEvidence
      && previous
      && (previous.segmentId || 'legacy-0') === segmentId
      && previous.alt != null
      && point.alt != null
      && point.alt > previous.alt) {
      legacyElevationGainM += point.alt - previous.alt;
    }
    previous = point;
  }
  return {
    elevationGainM: elevationState.hasVerticalQualityEvidence
      ? elevationQualityGain(elevationState)
      : legacyElevationGainM,
    elevationState,
  };
}

function projectMergedActivityPoints(
  current: ReadonlyArray<TrackPoint>,
  incoming: ReadonlyArray<CanonicalJournalPoint | TrackPoint>,
): ActivityJournalProjection {
  const byKey = new Map<string, TrackPoint>();
  for (const point of current) byKey.set(pointKey(point), asTrackPoint(point));
  let appendedFromJournal = 0;
  for (const incomingPoint of incoming) {
    const point = asTrackPoint(incomingPoint);
    const key = pointKey(point);
    if (!byKey.has(key)) appendedFromJournal += 1;
    // Durable/rebased evidence wins when an in-memory twin differs.
    byKey.set(key, point);
  }
  const canonical = Array.from(byKey.values()).sort((left, right) => (
    left.t - right.t
    || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
  ));
  const stats = calculateActivityStats(canonical);
  const elevation = buildElevationProjection(canonical);
  return {
    canonical,
    live: buildCausalLiveRoute(canonical),
    distanceM: stats.distanceM,
    distanceAccumulator: buildActivityDistanceAccumulator(canonical),
    elevationGainM: elevation.elevationGainM,
    elevationState: elevation.elevationState,
    appendedFromJournal,
  };
}

/** Stable evidence-only merge for raw audit state. It intentionally does not
 * construct Live geometry or metrics. */
export function mergeActivityCanonicalPoints(
  current: ReadonlyArray<TrackPoint>,
  incoming: ReadonlyArray<CanonicalJournalPoint | TrackPoint>,
): TrackPoint[] {
  const byKey = new Map<string, TrackPoint>();
  for (const point of current) byKey.set(pointKey(point), asTrackPoint(point));
  for (const rawPoint of incoming) {
    const point = asTrackPoint(rawPoint);
    byKey.set(pointKey(point), point);
  }
  return Array.from(byKey.values()).sort((left, right) => (
    left.t - right.t
    || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
  ));
}

export interface ActivityJournalProjection {
  canonical: TrackPoint[];
  live: TrackPoint[];
  distanceM: number;
  distanceAccumulator: ActivityDistanceAccumulator;
  elevationGainM: number;
  /** Exact in-process reducer frontier for O(append) warm WAL catch-up. It is
   * optional for legacy/cold callers; durable truth remains the canonical WAL. */
  elevationState?: ElevationQualityState;
  appendedFromJournal: number;
}

/**
 * Rebuild the visible Activity from the durable canonical ledger. The journal
 * supplies history that a headless wake committed while no React store was
 * mounted; current canonical points are retained only when the same durable
 * snapshot has not exposed them yet. Stable identity is segment + raw ordinal
 * (or exact evidence fields for legacy points), never title or rounded metrics.
 */
export function projectActivityJournal(
  current: ReadonlyArray<TrackPoint>,
  journal: ReadonlyArray<CanonicalJournalPoint>,
): ActivityJournalProjection {
  return projectMergedActivityPoints(current, journal);
}

/**
 * Publish accepted points against the canonical state that exists after their
 * WAL append settles. A background takeover/replay is allowed to advance the
 * store during that await; this merge prevents the accepted point's earlier,
 * stale transition snapshot from deleting the replayed prefix or tail.
 */
export function projectAcceptedActivityPoints(
  current: ReadonlyArray<TrackPoint>,
  accepted: ReadonlyArray<TrackPoint>,
): ActivityJournalProjection {
  return projectMergedActivityPoints(current, accepted);
}

/** Fast append-only rebase used when a foreground WAL commit discovers that a
 * cooperative/background projection advanced the store during its await. */
export function projectAcceptedActivityPointsFromCheckpoint(
  current: ReadonlyArray<TrackPoint>,
  currentLive: ReadonlyArray<TrackPoint>,
  currentDistanceAccumulator: ActivityDistanceAccumulator,
  currentElevationGainM: number,
  accepted: ReadonlyArray<TrackPoint>,
  currentElevationState?: ElevationQualityState,
): ActivityJournalProjection {
  const canonical = current.map(asTrackPoint);
  const keys = new Set(canonical.map(pointKey));
  const checkpoint = createCausalLiveReplayCheckpoint(canonical, currentLive);
  let distanceAccumulator = currentDistanceAccumulator;
  let appendedFromJournal = 0;
  for (const rawPoint of accepted) {
    const point = asTrackPoint(rawPoint);
    if (keys.has(pointKey(point))) continue;
    keys.add(pointKey(point));
    canonical.push(point);
    appendCausalLiveReplayPoint(checkpoint, point);
    distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
    appendedFromJournal += 1;
  }
  const appended = canonical.slice(current.length);
  const elevation = appendElevationProjection(
    current,
    appended,
    currentElevationGainM,
    currentElevationState,
  );
  return {
    canonical,
    live: causalLiveReplayResult(checkpoint),
    distanceAccumulator,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    elevationGainM: elevation.elevationGainM,
    elevationState: elevation.elevationState,
    appendedFromJournal,
  };
}

export interface CooperativeActivityJournalProjectionMetrics {
  totalMs: number;
  maxSynchronousSliceMs: number;
  sliceCount: number;
  yieldCount: number;
  fullLiveRebuilds: number;
  reusedLiveCheckpoint: boolean;
  canonicalPointCount: number;
  appendedFromJournal: number;
}

export interface CooperativeActivityJournalProjectionResult {
  projection: ActivityJournalProjection;
  metrics: CooperativeActivityJournalProjectionMetrics;
}

export interface CooperativeActivityJournalProjectionOptions {
  currentLive?: ReadonlyArray<TrackPoint>;
  currentDistanceAccumulator?: ActivityDistanceAccumulator;
  currentElevationGainM?: number;
  currentElevationState?: ElevationQualityState;
  maxPointsPerSlice?: number;
  yieldToHost?: () => Promise<void>;
  shouldContinue?: () => boolean;
}

const projectionNow = () => globalThis.performance?.now?.() ?? Date.now();
const projectionYield = () => new Promise<void>(resolve => setTimeout(resolve, 0));

function sameCheckpointPoint(
  current: TrackPoint,
  journal: CanonicalJournalPoint,
): boolean {
  return pointKey(current) === pointKey(journal)
    && current.t === Math.floor(journal.t)
    && current.lat === journal.lat
    && current.lng === journal.lng
    && (current.segmentId ?? 'legacy') === (journal.segmentId ?? 'legacy');
}

/** Foreground hydration path. It reuses an already-published exact Live prefix
 * when the WAL is an append-only extension; otherwise it performs the same R3
 * causal replay in bounded host slices. No partial geometry is published. */
export async function projectActivityJournalCooperatively(
  current: ReadonlyArray<TrackPoint>,
  journal: ReadonlyArray<CanonicalJournalPoint>,
  options: CooperativeActivityJournalProjectionOptions = {},
): Promise<CooperativeActivityJournalProjectionResult | null> {
  const startedAt = projectionNow();
  const maxPointsPerSlice = Math.max(1, Math.floor(options.maxPointsPerSlice ?? 16));
  const yieldToHost = options.yieldToHost ?? projectionYield;
  let maxSynchronousSliceMs = 0;
  let sliceCount = 0;
  let yieldCount = 0;
  const cooperativeRange = async (
    count: number,
    work: (index: number) => void,
  ): Promise<boolean> => {
    for (let offset = 0; offset < count; offset += maxPointsPerSlice) {
      if (options.shouldContinue && !options.shouldContinue()) return false;
      const sliceStartedAt = projectionNow();
      const end = Math.min(count, offset + maxPointsPerSlice);
      for (let index = offset; index < end; index += 1) work(index);
      maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, projectionNow() - sliceStartedAt);
      sliceCount += 1;
      if (end < count) {
        yieldCount += 1;
        await yieldToHost();
      }
    }
    return !(options.shouldContinue && !options.shouldContinue());
  };
  const measureSynchronous = <T>(work: () => T): T => {
    const sliceStartedAt = projectionNow();
    const result = work();
    maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, projectionNow() - sliceStartedAt);
    sliceCount += 1;
    return result;
  };

  // Same owner/generation journals are append-only. Count plus stable first and
  // frontier identities is therefore a reusable version checkpoint; comparing
  // or replaying the complete prefix on every screen/AppState return would
  // recreate the foreground stall this path is intended to remove.
  const prefixMatches = current.length === 0
    || (current.length <= journal.length
      && sameCheckpointPoint(current[0], journal[0])
      && sameCheckpointPoint(current[current.length - 1], journal[current.length - 1]));
  const canReuseLive = prefixMatches
    && current.length > 0
    && options.currentLive != null
    && options.currentLive.length > 0
    && (
      current.length <= LIVE_MUTABLE_TAIL_MAX_POINTS + LIVE_TREND_CONTEXT_MAX_POINTS
      // O97 and early O98 checkpoints did not carry reducer provenance. A
      // long legacy Live array can contain the old bounded-tail omission, so
      // it must be rebuilt once from the complete WAL rather than blessed as
      // an exact current-reducer checkpoint.
      || options.currentLive.some(point => (
        point.liveTrendConfirmed || point.livePresentationSettled
      ))
    );
  let canonical: TrackPoint[];
  let live: TrackPoint[];
  let distanceAccumulator: ActivityDistanceAccumulator;
  let appendedFromJournal = 0;
  let fullLiveRebuilds = 0;
  let elevationState = options.currentElevationState;
  let appendedLegacyElevationGainM = 0;

  if (canReuseLive) {
    canonical = measureSynchronous(() => current.map(asTrackPoint));
    const checkpoint = createCausalLiveReplayCheckpoint(canonical, options.currentLive);
    distanceAccumulator = options.currentDistanceAccumulator
      ?? measureSynchronous(() => buildActivityDistanceAccumulator(canonical));
    appendedFromJournal = journal.length - current.length;
    let previousElevationPoint = canonical[canonical.length - 1] ?? null;
    if (!await cooperativeRange(appendedFromJournal, offset => {
      const point = asTrackPoint(journal[current.length + offset]);
      canonical.push(point);
      appendCausalLiveReplayPoint(checkpoint, point);
      distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
      if (elevationState) {
        const segmentId = point.segmentId || 'legacy-0';
        if (!elevationState.hasVerticalQualityEvidence
          && point.verticalAccuracy == null
          && previousElevationPoint
          && (previousElevationPoint.segmentId || 'legacy-0') === segmentId
          && previousElevationPoint.alt != null
          && point.alt != null
          && point.alt > previousElevationPoint.alt) {
          appendedLegacyElevationGainM += point.alt - previousElevationPoint.alt;
        }
        elevationState = reduceElevationObservation(
          elevationState,
          { ...point, segmentId },
        ).state;
      }
      previousElevationPoint = point;
    })) return null;
    live = causalLiveReplayResult(checkpoint);
  } else {
    const byKey = new Map<string, TrackPoint>();
    if (!await cooperativeRange(current.length, index => {
      const point = asTrackPoint(current[index]);
      byKey.set(pointKey(point), point);
    })) return null;
    if (!await cooperativeRange(journal.length, index => {
      const point = asTrackPoint(journal[index]);
      const key = pointKey(point);
      if (!byKey.has(key)) appendedFromJournal += 1;
      byKey.set(key, point);
    })) return null;
    // Materialize the Map cooperatively. Array.from plus sort allocated and
    // ordered all 20k entries in one measured foreground turn; under memory
    // pressure that turn included a 251 ms collection pause. Durable journals
    // are already ordered in the common cold-recovery path, so detect that
    // while filling and sort only a genuinely out-of-order merge.
    canonical = new Array<TrackPoint>(byKey.size);
    const values = byKey.values();
    let canonicalAlreadyOrdered = true;
    if (!await cooperativeRange(canonical.length, index => {
      const point = values.next().value as TrackPoint;
      canonical[index] = point;
      if (index > 0) {
        const previous = canonical[index - 1];
        canonicalAlreadyOrdered = canonicalAlreadyOrdered && (
          previous.t < point.t
          || (previous.t === point.t
            && (previous.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
              <= (point.rawOrdinal ?? Number.MAX_SAFE_INTEGER))
        );
      }
    })) return null;
    if (!canonicalAlreadyOrdered) {
      canonical = measureSynchronous(() => canonical.sort((left, right) => (
        left.t - right.t
        || (left.rawOrdinal ?? Number.MAX_SAFE_INTEGER) - (right.rawOrdinal ?? Number.MAX_SAFE_INTEGER)
      )));
    }
    const replay = await buildCausalLiveRouteCooperatively(canonical, {
      maxPointsPerSlice,
      yieldToHost,
      shouldContinue: options.shouldContinue,
    });
    if (!replay) return null;
    live = replay.route;
    maxSynchronousSliceMs = Math.max(maxSynchronousSliceMs, replay.metrics.maxSynchronousSliceMs);
    sliceCount += replay.metrics.sliceCount;
    yieldCount += replay.metrics.yieldCount;
    fullLiveRebuilds = 1;
    distanceAccumulator = createActivityDistanceAccumulator();
    elevationState = createElevationQualityState();
  }
  let elevationGainM = options.currentElevationGainM ?? 0;
  const needsDistanceReplay = !canReuseLive;
  const needsElevationReplay = !canReuseLive
    || (appendedFromJournal > 0 && options.currentElevationState == null);
  if (needsDistanceReplay || needsElevationReplay) {
    let replayedDistance = createActivityDistanceAccumulator();
    let replayedElevationState = createElevationQualityState();
    let legacyElevationGainM = 0;
    let hasVerticalQualityEvidence = false;
    let previous: TrackPoint | null = null;
    if (!await cooperativeRange(canonical.length, index => {
      const point = canonical[index];
      if (needsDistanceReplay) {
        replayedDistance = appendActivityDistancePoint(replayedDistance, point);
      }
      const segmentId = point.segmentId || 'legacy-0';
      if (needsElevationReplay) {
        if (point.verticalAccuracy != null) hasVerticalQualityEvidence = true;
        replayedElevationState = reduceElevationObservation(
          replayedElevationState,
          { ...point, segmentId },
        ).state;
        if (previous && (previous.segmentId || 'legacy-0') === segmentId
          && previous.alt != null && point.alt != null && point.alt > previous.alt) {
          legacyElevationGainM += point.alt - previous.alt;
        }
        previous = point;
      }
    })) return null;
    if (needsDistanceReplay) {
      distanceAccumulator = replayedDistance;
    }
    if (needsElevationReplay) {
      elevationState = replayedElevationState;
      elevationGainM = hasVerticalQualityEvidence
        ? elevationQualityGain(replayedElevationState)
        : legacyElevationGainM;
    }
  } else if (elevationState) {
    elevationGainM = elevationState.hasVerticalQualityEvidence
      ? elevationQualityGain(elevationState)
      : elevationGainM + appendedLegacyElevationGainM;
  }
  const projection: ActivityJournalProjection = {
    canonical,
    live,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    distanceAccumulator,
    elevationGainM,
    elevationState,
    appendedFromJournal,
  };
  return {
    projection,
    metrics: {
      totalMs: projectionNow() - startedAt,
      maxSynchronousSliceMs,
      sliceCount,
      yieldCount,
      fullLiveRebuilds,
      reusedLiveCheckpoint: canReuseLive,
      canonicalPointCount: canonical.length,
      appendedFromJournal,
    },
  };
}

/** Add concurrently accepted, WAL-committed suffix points to a prepared
 * projection without replaying its frozen prefix. Null means the caller must
 * cooperatively rebuild because the observed state was not an append suffix. */
export function rebaseActivityJournalProjection(
  prepared: ActivityJournalProjection,
  current: ReadonlyArray<TrackPoint>,
): ActivityJournalProjection | null {
  const keys = new Set(prepared.canonical.map(pointKey));
  const suffix = current.filter(point => !keys.has(pointKey(point))).map(asTrackPoint);
  if (suffix.length === 0) return prepared;
  const tail = prepared.canonical[prepared.canonical.length - 1];
  if (tail && suffix.some(point => (
    point.t < tail.t
    || (point.t === tail.t
      && point.rawOrdinal != null
      && tail.rawOrdinal != null
      && point.rawOrdinal <= tail.rawOrdinal)
  ))) return null;
  const canonical = prepared.canonical.slice();
  const checkpoint = createCausalLiveReplayCheckpoint(canonical, prepared.live);
  let distanceAccumulator = prepared.distanceAccumulator;
  for (const point of suffix) {
    canonical.push(point);
    appendCausalLiveReplayPoint(checkpoint, point);
    distanceAccumulator = appendActivityDistancePoint(distanceAccumulator, point);
  }
  // `current` and `prepared` can be sibling asynchronous branches. A caller's
  // current elevation reducer therefore cannot be copied onto the merged
  // canonical route. Advance the prepared frontier through the exact suffix,
  // or rebuild it when the legacy checkpoint did not carry reducer state.
  const elevation = appendElevationProjection(
    prepared.canonical,
    suffix,
    prepared.elevationGainM,
    prepared.elevationState,
  );
  return {
    ...prepared,
    canonical,
    live: causalLiveReplayResult(checkpoint),
    distanceAccumulator,
    distanceM: activityDistanceEstimate(distanceAccumulator).distanceM,
    elevationGainM: elevation.elevationGainM,
    elevationState: elevation.elevationState,
  };
}
