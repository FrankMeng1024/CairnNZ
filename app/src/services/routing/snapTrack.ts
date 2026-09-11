/**
 * snapTrack.ts — Activity-length GPS → road-snap pipeline (O49 islands).
 *
 * Single shared module used by:
 *   - Activity SAVE (turn raw GPS into a clean polyline at save time)
 *   - Brush edit Preview (snap a brush stroke through the same code)
 *
 * Algorithm (sequence-preserving hybrid):
 *   1. Tag each raw point as GOOD or LOST.
 *      LOST = `accuracy > 20m`. A negative native speed means “unknown”,
 *      not “GPS lost”, and remains eligible under the accuracy/quality gates.
 *   2. Split into runs of contiguous GOOD or LOST points.
 *   3. Sequence-aware temporal resampling keeps ~4 s evidence plus endpoints,
 *      turns, reversals and stop/start boundaries. Every submitted observation
 *      carries its exact canonical source index.
 *   4. Chunk the submitted evidence at 80 with one shared source boundary and
 *      call Mapbox walking Map Matching with `tidy=false`, timestamps and
 *      bounded accuracy-aware radiuses.
 *   5. Discover independently supported temporal islands from tracepoints.
 *      Each island owns only its explicit canonical source range and must pass
 *      confidence, displacement, topology, endpoint and seam gates.
 *   6. Assemble MATCHED → CANONICAL → MATCHED at shared canonical boundary
 *      points. There is no nearest-neighbour splice or invented connector.
 *   7. LOST runs are canonical fallback and are never sent to Mapbox.
 *   8. No global dedupe, union, shortcut, fake connector or smoothing pass is
 *      allowed across matched/fallback subsection boundaries.
 *
 * Robustness contract:
 *   - On TOTAL failure (entire pipeline can't finish OR exceeds totalTimeoutMs)
 *     the function returns `{ ok: false }` and the caller is expected to
 *     fall back to whatever it had (e.g. smoothTrackPoints output).
 *   - The pipeline NEVER throws to caller. All errors are swallowed and
 *     converted to `ok: false`.
 *   - Raw input is never mutated.
 *   - alt values from raw are preserved on matched output by nearest-neighbor
 *     copy; canonical fallback coordinates and altitude remain exact.
 *
 * What this is NOT:
 *   - Not a true HMM map-matcher; we delegate to Mapbox /matching.
 *   - Not a substitute for raw GPS — caller MUST persist raw separately.
 *   - Not for real-time tracking — designed for one-shot save/preview.
 *
 * Plan: docs/spikes/V6_4_PLAN.md (TBD); see SPIKE report at
 *   C:/temp/SPIKE_ACTIVITY_V2_REPORT.md for the empirical validation that
 *   informed the constants below.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Input point. We accept the union of fields the Cairn app uses today:
 *   - lat / lng (required)
 *   - alt (optional, preserved through the pipeline)
 *   - accuracy (optional, used to size per-coord radius and to mark LOST)
 *   - speed (optional, -1 means native speed is unavailable)
 *   - t (optional, not used in this pipeline)
 */
export interface RawPoint {
  lat: number;
  lng: number;
  alt?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  t?: number;
}

export interface SnappedPoint {
  lat: number;
  lng: number;
  alt?: number | null;
  /** Canonical fallback keeps exact time; matched vertices receive monotonic
   * subsection-local interpolation for display chronology only. */
  t?: number;
}

export interface SnapTrackOptions {
  /**
   * Mapbox public token. Required.
   * Caller passes process.env.EXPO_PUBLIC_MAPBOX_TOKEN.
   */
  mapboxToken: string;
  /** Hard ceiling for total wall-clock time. Default 60_000 ms. */
  totalTimeoutMs?: number;
  /** Per-call timeout (one chunk). Default 8_000 ms. */
  perCallTimeoutMs?: number;
  /** Concurrency for chunked GOOD-run fetches. Default 4. */
  concurrency?: number;
  /** AbortSignal for caller cancellation (e.g. user navigated away). */
  signal?: AbortSignal;
}

type SnapTrackReason =
  | 'no_input'
  | 'too_short'
  | 'no_token'
  | 'aborted'
  | 'timed_out'
  | 'all_chunks_failed';

export interface SnapTrackStats {
  /** Number of Mapbox /matching API calls actually fired. */
  apiCalls: number;
  /** Number of chunks that succeeded with conf >= confMin. */
  chunksOk: number;
  /** Number of chunks that fell back to raw (failure / low conf). */
  chunksFallback: number;
  /** Chunks rejected because derived geometry was less truthful than raw. */
  qualityFallbacks: number;
  /** Lowest accepted Mapbox confidence seen in this run. */
  minConfidence: number | null;
  /** Worst accepted chunk p95 raw-to-matched deviation. */
  maxP95DeviationM: number;
  /** Worst accepted chunk endpoint displacement. */
  maxEndpointDeviationM: number;
  /** Number of GOOD runs (Mapbox-eligible). */
  goodRuns: number;
  /** Number of LOST runs (raw-only, never sent to Mapbox). */
  lostRuns: number;
  /** Legacy diagnostic retained for telemetry compatibility; v7 never inserts bridges. */
  seamBridges: number;
  /** Canonical observations received before bounded matcher resampling. */
  canonicalPointCount: number;
  /** Ordered observations submitted after resampling (overlap may repeat boundaries across requests). */
  resampledPointCount: number;
  /** Provenance-backed islands accepted after all local and whole-route gates. */
  matchedIslandCount: number;
  rejectedIslandCount: number;
  seamRejectedIslandCount: number;
  seamShrunkIslandCount: number;
  wholeRouteRejectedIslandCount: number;
  acceptedMatchedDistanceM: number;
  canonicalFallbackDistanceM: number;
  wholeRouteValidation: WholeRouteValidation;
  finalGeometryFingerprint: string | null;
  /** Privacy-safe evidence for each external request; never includes token or coordinates. */
  requestResults: Array<{
    inputPointCount: number;
    canonicalSpanPointCount: number;
    sourceIndexMap: number[];
    headTimestamp: number | null;
    tailTimestamp: number | null;
    timestampsIncluded: boolean;
    cadenceP50Ms: number;
    cadenceP95Ms: number;
    spatialSpacingP50M: number;
    spatialSpacingP95M: number;
    minimumRadiusM: number;
    maximumRadiusM: number;
    durationMs: number;
    result: string;
    httpStatus: number | null;
    responseCode: string | null;
    subMatchingCount: number | null;
    tracepointCount: number | null;
    nullTracepointCount: number | null;
    confidence: number | null;
    qualityReason: string | null;
    acceptedIslandCount: number;
    rejectedIslandCount: number;
    seamRejectedIslandCount: number;
    matcherTidy: false;
    profile: 'walking';
    islandResults: Array<{
      sourceStart: number | null;
      sourceEnd: number | null;
      decision: 'matched' | 'canonical-fallback';
      reason: string;
      confidence: number;
      qualityReason: string | null;
      topologyReason: string | null;
      seamReason: string | null;
      quality: MatchedGeometryQuality | null;
      topology: TopologyQuality | null;
      seam: IslandSeamQuality | null;
      seamTrimmedHeadPoints: number;
      seamTrimmedTailPoints: number;
    }>;
  }>;
  /** Wall-clock time for the whole pipeline (ms). */
  durationMs: number;
}

type SnapTrackResult =
  | { ok: true; points: SnappedPoint[]; stats: SnapTrackStats }
  | { ok: false; reason: SnapTrackReason; stats: SnapTrackStats };

// ============================================================================
// Tunables (validated by spike — do NOT change without re-spiking)
// ============================================================================

const CHUNK_SIZE = 80;            // raw points per Mapbox call (cap is 100)
const CHUNK_OVERLAP = 1;          // exact canonical boundary; preserves repeated-pass order
const ACC_LOST_M = 20;            // accuracy worse than this => GPS lost
const ACC_RADIUS_MIN = 10;        // per-coord radius min (Mapbox API allows 1..50)
const ACC_RADIUS_MAX = 40;        // per-coord radius max (50 = upper bound)
const CONF_FALLBACK = 0.3;        // existing confidence floor; geometry gates remain stricter authority
const ENDPOINT_REPLACE_M = 3;     // replace a near-derived endpoint with canonical truth
const RESAMPLE_INTERVAL_MS = 4_000;
const TURN_KEEP_DEGREES = 42;
const TURN_KEEP_MIN_EDGE_M = 1.5;
const STOP_BOUNDARY_INTERVAL_MS = 5_000;
const MIN_ISLAND_SUPPORT_POINTS = 3;
const MIN_ISLAND_SOURCE_LENGTH_M = 10;
const MAX_SEAM_TRIM_POINTS = 4;
const MAX_SEAM_HEADING_DELTA_DEG = 65;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const DEFAULT_PER_CALL_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 4;
const MAPBOX_HARD_COORD_CAP = 100;
const MAPBOX_ENDPOINT = 'https://api.mapbox.com/matching/v5/mapbox/walking';

// ============================================================================
// Math helpers (haversine, no external deps)
// ============================================================================

const EARTH_R = 6_371_000;

function hav(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathLength(points: Array<{ lat: number; lng: number }>): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += hav(points[index - 1], points[index]);
  return total;
}

function pointToSegmentMeters(
  point: { lat: number; lng: number },
  start: { lat: number; lng: number },
  end: { lat: number; lng: number },
): number {
  const metresPerDegree = 111_320;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const ax = (start.lng - point.lng) * metresPerDegree * cosLat;
  const ay = (start.lat - point.lat) * metresPerDegree;
  const bx = (end.lng - point.lng) * metresPerDegree * cosLat;
  const by = (end.lat - point.lat) * metresPerDegree;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function pointToPathMeters(
  point: { lat: number; lng: number },
  path: Array<{ lat: number; lng: number }>,
): number {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegmentMeters(point, path[index - 1], path[index]));
  }
  return best;
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function percentile50(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function bearingDegrees(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const toDeg = (value: number) => value * 180 / Math.PI;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2)
    - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function angleDeltaDegrees(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360;
  return difference > 180 ? 360 - difference : difference;
}

export interface MatcherSubmittedPoint extends RawPoint {
  sourceIndex: number;
  mandatoryReasons: Array<'segment-endpoint' | 'turn' | 'reversal' | 'stop-start'>;
}

/**
 * Keep ordered evidence sparse enough for Mapbox without losing chronology.
 * Geography is never deduplicated: returning to the same coordinate at a later
 * source index remains a distinct submitted observation.
 */
export function resampleMatcherEvidence(
  canonical: RawPoint[],
  intervalMs = RESAMPLE_INTERVAL_MS,
): MatcherSubmittedPoint[] {
  if (canonical.length === 0) return [];
  const reasons = canonical.map(() => new Set<MatcherSubmittedPoint['mandatoryReasons'][number]>());
  reasons[0].add('segment-endpoint');
  reasons[canonical.length - 1].add('segment-endpoint');
  for (let index = 1; index < canonical.length - 1; index += 1) {
    const previous = canonical[index - 1];
    const current = canonical[index];
    const next = canonical[index + 1];
    const incomingM = hav(previous, current);
    const outgoingM = hav(current, next);
    if (incomingM >= TURN_KEEP_MIN_EDGE_M && outgoingM >= TURN_KEEP_MIN_EDGE_M) {
      const turn = angleDeltaDegrees(
        bearingDegrees(previous, current),
        bearingDegrees(current, next),
      );
      if (turn >= TURN_KEEP_DEGREES) {
        const reason = turn >= 120 ? 'reversal' : 'turn';
        reasons[index - 1].add(reason);
        reasons[index].add(reason);
        reasons[index + 1].add(reason);
      }
    }
    const incomingDt = current.t != null && previous.t != null ? current.t - previous.t : 0;
    const outgoingDt = next.t != null && current.t != null ? next.t - current.t : 0;
    if (incomingDt >= STOP_BOUNDARY_INTERVAL_MS || outgoingDt >= STOP_BOUNDARY_INTERVAL_MS) {
      reasons[index - 1].add('stop-start');
      reasons[index].add('stop-start');
      reasons[index + 1].add('stop-start');
    }
  }

  // Legacy Route Editor inputs often have no timestamps. Preserve every point
  // rather than inventing a cadence or altering that existing caller.
  const hasStrictTimes = canonical.every(point => point.t != null && Number.isFinite(point.t))
    && canonical.every((point, index) => index === 0 || Number(point.t) > Number(canonical[index - 1].t));
  if (!hasStrictTimes) {
    return canonical.map((point, sourceIndex) => ({
      ...point,
      sourceIndex,
      mandatoryReasons: Array.from(reasons[sourceIndex]),
    }));
  }

  const selected: MatcherSubmittedPoint[] = [];
  let lastTemporalT = Number(canonical[0].t);
  for (let sourceIndex = 0; sourceIndex < canonical.length; sourceIndex += 1) {
    const point = canonical[sourceIndex];
    const mandatoryReasons = Array.from(reasons[sourceIndex]);
    const due = Number(point.t) - lastTemporalT >= intervalMs;
    if (sourceIndex === 0 || sourceIndex === canonical.length - 1 || mandatoryReasons.length > 0 || due) {
      selected.push({ ...point, sourceIndex, mandatoryReasons });
      lastTemporalT = Number(point.t);
    }
  }
  return selected;
}

export interface MatchedGeometryQuality {
  accepted: boolean;
  reason: 'accepted' | 'raw_deviation' | 'max_raw_deviation' | 'endpoint_displacement' | 'length_distortion';
  p50DeviationM: number;
  p95DeviationM: number;
  maxDeviationM: number;
  endpointDeviationM: number;
  rawLengthM: number;
  matchedLengthM: number;
  lengthRatio: number;
  deviationEnvelopeM: number;
}

/**
 * Bounded truthfulness gate for derived geometry. Accuracy determines the
 * allowed correction envelope; raw accepted points remain the authority.
 */
export function evaluateMatchedGeometryQuality(
  raw: RawPoint[],
  matched: Array<{ lat: number; lng: number }>,
): MatchedGeometryQuality {
  const deviations = raw.map(point => pointToPathMeters(point, matched));
  const usableAccuracy = raw
    .map(point => point.accuracy)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const accuracyP95 = usableAccuracy.length > 0 ? percentile95(usableAccuracy) : 10;
  // Accuracy widens the matcher search, but cannot authorize stealing an
  // internal path onto a nearby external road.
  const deviationEnvelopeM = Math.min(15, Math.max(8, accuracyP95 * 1.25));
  const p50DeviationM = percentile50(deviations);
  const p95DeviationM = percentile95(deviations);
  const maxDeviationM = deviations.length > 0 ? Math.max(...deviations) : 0;
  const endpointDeviationM = Math.max(
    hav(raw[0], matched[0]),
    hav(raw[raw.length - 1], matched[matched.length - 1]),
  );
  const rawLengthM = pathLength(raw);
  const matchedLengthM = pathLength(matched);
  const lengthRatio = rawLengthM > 1 ? matchedLengthM / rawLengthM : 1;
  const maxDeviationEnvelopeM = Math.min(30, Math.max(18, deviationEnvelopeM * 1.5));
  const reason = p95DeviationM > deviationEnvelopeM
    ? 'raw_deviation'
    : maxDeviationM > maxDeviationEnvelopeM
      ? 'max_raw_deviation'
      : endpointDeviationM > Math.max(20, deviationEnvelopeM)
        ? 'endpoint_displacement'
        : lengthRatio < 0.67 || lengthRatio > 1.5
          ? 'length_distortion'
          : 'accepted';
  return {
    accepted: reason === 'accepted',
    reason,
    p50DeviationM,
    p95DeviationM,
    maxDeviationM,
    endpointDeviationM,
    rawLengthM,
    matchedLengthM,
    lengthRatio,
    deviationEnvelopeM,
  };
}

// ============================================================================
// Quality tagging
// ============================================================================

function isLost(p: RawPoint): boolean {
  if (p.accuracy != null && p.accuracy > ACC_LOST_M) return true;
  return false;
}

/**
 * Keep the full accepted start/end evidence while allowing Mapbox to own the
 * middle. Coverage is checked before this helper is called. Replacement is
 * atomic: it never prepends/appends a connector vertex.
 */
export function preserveTrustedRouteEndpoints(
  raw: RawPoint[],
  matched: SnappedPoint[],
  _replaceWithinM = ENDPOINT_REPLACE_M,
): SnappedPoint[] {
  if (raw.length < 2 || matched.length < 2) return matched.slice();
  const coverage = analyzeTrustedEndpointCoverage(raw, matched);
  if (!coverage.eligibleForAnchoring) return matched.slice();
  const first = canonicalPoint(raw[0]);
  const lastRaw = raw[raw.length - 1];
  const last = canonicalPoint(lastRaw);
  const out = matched.slice();
  out[0] = first;
  out[out.length - 1] = last;
  return out;
}

export interface TrustedEndpointCoverage {
  headDisplacementM: number;
  tailDisplacementM: number;
  anchoringEnvelopeM: number;
  eligibleForAnchoring: boolean;
}

/**
 * A canonical head/tail may replace or extend a nearby derived endpoint, but
 * a large uncovered endpoint is evidence of a bad match—not permission to
 * manufacture a long straight stub. The caller falls that segment back raw.
 */
export function analyzeTrustedEndpointCoverage(
  raw: RawPoint[],
  matched: SnappedPoint[],
): TrustedEndpointCoverage {
  if (raw.length < 2 || matched.length < 2) {
    return {
      headDisplacementM: Infinity,
      tailDisplacementM: Infinity,
      anchoringEnvelopeM: 0,
      eligibleForAnchoring: false,
    };
  }
  const usableAccuracy = raw
    .map(point => point.accuracy)
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  const accuracyP95 = usableAccuracy.length > 0 ? percentile95(usableAccuracy) : 10;
  const anchoringEnvelopeM = Math.min(20, Math.max(8, accuracyP95 * 1.25));
  const headDisplacementM = hav(raw[0], matched[0]);
  const tailDisplacementM = hav(raw[raw.length - 1], matched[matched.length - 1]);
  return {
    headDisplacementM,
    tailDisplacementM,
    anchoringEnvelopeM,
    eligibleForAnchoring:
      headDisplacementM <= anchoringEnvelopeM
      && tailDisplacementM <= anchoringEnvelopeM,
  };
}

export interface IslandSeamQuality {
  accepted: boolean;
  reason: 'accepted' | 'entry_heading' | 'exit_heading' | 'entry_edge' | 'exit_edge' | 'duplicate_loop';
  entryHeadingDeltaDeg: number;
  exitHeadingDeltaDeg: number;
  entryEdgeM: number;
  exitEdgeM: number;
  maxAllowedEdgeM: number;
}

function firstMeaningfulIndex(
  points: Array<{ lat: number; lng: number }>,
  from: number,
  direction: 1 | -1,
  minimumM = 1,
): number | null {
  const origin = points[from];
  for (let index = from + direction; index >= 0 && index < points.length; index += direction) {
    if (hav(origin, points[index]) >= minimumM) return index;
  }
  return null;
}

function localDuplicateLoopRisk(points: Array<{ lat: number; lng: number }>): boolean {
  for (let left = 0; left < points.length; left += 1) {
    let travelledM = 0;
    for (let right = left + 1; right < points.length; right += 1) {
      travelledM += hav(points[right - 1], points[right]);
      if (right - left >= 3 && travelledM >= 6 && hav(points[left], points[right]) <= 0.75) return true;
    }
  }
  return false;
}

/**
 * Validate only the authority switch. Real turns are preserved by comparing
 * the hybrid edge with the canonical edge on the same side of the boundary,
 * rather than imposing a "continue straight" prior.
 */
export function evaluateIslandSeamQuality(
  canonical: RawPoint[],
  sourceStart: number,
  sourceEnd: number,
  matched: SnappedPoint[],
): IslandSeamQuality {
  const entryMatchedIndex = firstMeaningfulIndex(matched, 0, 1);
  const exitMatchedIndex = firstMeaningfulIndex(matched, matched.length - 1, -1);
  const entryCanonicalIndex = firstMeaningfulIndex(canonical, sourceStart, 1);
  const exitCanonicalIndex = firstMeaningfulIndex(canonical, sourceEnd, -1);
  const entryEdgeM = entryMatchedIndex == null ? Infinity : hav(matched[0], matched[entryMatchedIndex]);
  const exitEdgeM = exitMatchedIndex == null ? Infinity : hav(matched[matched.length - 1], matched[exitMatchedIndex]);
  const localCanonicalEdges = [
    entryCanonicalIndex == null ? 0 : hav(canonical[sourceStart], canonical[entryCanonicalIndex]),
    exitCanonicalIndex == null ? 0 : hav(canonical[sourceEnd], canonical[exitCanonicalIndex]),
  ];
  // A sparse legacy/editor trace may legitimately have long edges. The seam
  // may not create an edge materially longer than the canonical evidence,
  // while dense Activity evidence retains a strict 12 m visual bound.
  const maxAllowedEdgeM = Math.min(60, Math.max(22, Math.max(...localCanonicalEdges) * 1.5));
  const entryHeadingDeltaDeg = entryMatchedIndex == null || entryCanonicalIndex == null
    ? 0
    : angleDeltaDegrees(
        bearingDegrees(canonical[sourceStart], canonical[entryCanonicalIndex]),
        bearingDegrees(matched[0], matched[entryMatchedIndex]),
      );
  const exitHeadingDeltaDeg = exitMatchedIndex == null || exitCanonicalIndex == null
    ? 0
    : angleDeltaDegrees(
        bearingDegrees(canonical[exitCanonicalIndex], canonical[sourceEnd]),
        bearingDegrees(matched[exitMatchedIndex], matched[matched.length - 1]),
      );
  const entryWindow = [
    ...canonical.slice(Math.max(0, sourceStart - 2), sourceStart).map(canonicalPoint),
    ...matched.slice(0, Math.min(4, matched.length)),
  ];
  const exitWindow = [
    ...matched.slice(Math.max(0, matched.length - 4)),
    ...canonical.slice(sourceEnd + 1, Math.min(canonical.length, sourceEnd + 3)).map(canonicalPoint),
  ];
  const canonicalEntryWindow = canonical.slice(
    Math.max(0, sourceStart - 2),
    Math.min(canonical.length, sourceStart + 4),
  );
  const canonicalExitWindow = canonical.slice(
    Math.max(0, sourceEnd - 3),
    Math.min(canonical.length, sourceEnd + 3),
  );
  const inventedDuplicateLoop = (
    localDuplicateLoopRisk(entryWindow) && !localDuplicateLoopRisk(canonicalEntryWindow)
  ) || (
    localDuplicateLoopRisk(exitWindow) && !localDuplicateLoopRisk(canonicalExitWindow)
  );
  const reason = entryEdgeM > maxAllowedEdgeM
    ? 'entry_edge'
    : exitEdgeM > maxAllowedEdgeM
      ? 'exit_edge'
      : entryHeadingDeltaDeg > MAX_SEAM_HEADING_DELTA_DEG
        ? 'entry_heading'
        : exitHeadingDeltaDeg > MAX_SEAM_HEADING_DELTA_DEG
          ? 'exit_heading'
          : inventedDuplicateLoop
            ? 'duplicate_loop'
            : 'accepted';
  return {
    accepted: reason === 'accepted',
    reason,
    entryHeadingDeltaDeg,
    exitHeadingDeltaDeg,
    entryEdgeM,
    exitEdgeM,
    maxAllowedEdgeM,
  };
}

export interface TopologyQuality {
  accepted: boolean;
  reason: 'accepted' | 'bearing_disagreement' | 'lost_reversal' | 'invented_reversal';
  canonicalReversals: number;
  matchedReversals: number;
  bearingDeltaDeg: number;
}

function meaningfulHeadings(points: Array<{ lat: number; lng: number }>): number[] {
  const headings: number[] = [];
  let anchor = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (hav(points[anchor], points[index]) < 3) continue;
    headings.push(bearingDegrees(points[anchor], points[index]));
    anchor = index;
  }
  return headings;
}

function reversalCount(points: Array<{ lat: number; lng: number }>): number {
  const headings = meaningfulHeadings(points);
  return headings.slice(1).filter((heading, index) => angleDeltaDegrees(headings[index], heading) >= 120).length;
}

export function evaluateTopologyQuality(
  canonical: RawPoint[],
  matched: Array<{ lat: number; lng: number }>,
): TopologyQuality {
  const canonicalReversals = reversalCount(canonical);
  const matchedReversals = reversalCount(matched);
  const canonicalLengthM = pathLength(canonical);
  const canonicalNetM = hav(canonical[0], canonical[canonical.length - 1]);
  const bearingDeltaDeg = canonicalNetM >= 15 && canonicalNetM >= canonicalLengthM * 0.45
    ? angleDeltaDegrees(
        bearingDegrees(canonical[0], canonical[canonical.length - 1]),
        bearingDegrees(matched[0], matched[matched.length - 1]),
      )
    : 0;
  const reason = bearingDeltaDeg > 55
    ? 'bearing_disagreement'
    : matchedReversals < canonicalReversals
      ? 'lost_reversal'
      : matchedReversals > canonicalReversals + 1
        ? 'invented_reversal'
        : 'accepted';
  return { accepted: reason === 'accepted', reason, canonicalReversals, matchedReversals, bearingDeltaDeg };
}

export interface WholeRouteValidation {
  accepted: boolean;
  reason: 'accepted' | 'endpoint_change' | 'length_distortion' | 'edge_spike' | 'duplicate_edge';
  canonicalLengthM: number;
  finalLengthM: number;
  lengthRatio: number;
  maximumCanonicalEdgeM: number;
  maximumFinalEdgeM: number;
}

export function evaluateWholeRouteQuality(
  canonical: RawPoint[],
  final: Array<{ lat: number; lng: number }>,
): WholeRouteValidation {
  const canonicalLengthM = pathLength(canonical);
  const finalLengthM = pathLength(final);
  const lengthRatio = canonicalLengthM > 1 ? finalLengthM / canonicalLengthM : 1;
  const canonicalEdges = canonical.slice(1).map((point, index) => hav(canonical[index], point));
  const finalEdges = final.slice(1).map((point, index) => hav(final[index], point));
  const maximumCanonicalEdgeM = canonicalEdges.length > 0 ? Math.max(...canonicalEdges) : 0;
  const maximumFinalEdgeM = finalEdges.length > 0 ? Math.max(...finalEdges) : 0;
  const canonicalDuplicateEdges = canonicalEdges.filter(edge => edge <= 0.05).length;
  const finalDuplicateEdges = finalEdges.filter(edge => edge <= 0.05).length;
  const endpointsChanged = canonical.length < 2 || final.length < 2
    || hav(canonical[0], final[0]) > 0.05
    || hav(canonical[canonical.length - 1], final[final.length - 1]) > 0.05;
  const reason = endpointsChanged
    ? 'endpoint_change'
    : lengthRatio < 0.67 || lengthRatio > 1.5
      ? 'length_distortion'
      : maximumFinalEdgeM > Math.max(30, maximumCanonicalEdgeM * 4)
        ? 'edge_spike'
        : finalDuplicateEdges > canonicalDuplicateEdges
          ? 'duplicate_edge'
          : 'accepted';
  return {
    accepted: reason === 'accepted',
    reason,
    canonicalLengthM,
    finalLengthM,
    lengthRatio,
    maximumCanonicalEdgeM,
    maximumFinalEdgeM,
  };
}

interface Run {
  kind: 'good' | 'lost';
  start: number;
  end: number; // exclusive
}

function tagRuns(raw: RawPoint[]): Run[] {
  const runs: Run[] = [];
  if (raw.length === 0) return runs;
  let kind: 'good' | 'lost' = isLost(raw[0]) ? 'lost' : 'good';
  let start = 0;
  for (let i = 1; i < raw.length; i++) {
    const k: 'good' | 'lost' = isLost(raw[i]) ? 'lost' : 'good';
    if (k !== kind) {
      runs.push({ kind, start, end: i });
      kind = k;
      start = i;
    }
  }
  runs.push({ kind, start, end: raw.length });
  return runs;
}

// ============================================================================
// Alt re-attachment (Mapbox snap geometry has no alt; raw does)
// ============================================================================

function attachAltFromRaw(snap: SnappedPoint[], raw: RawPoint[]): SnappedPoint[] {
  if (snap.length === 0 || raw.length === 0) return snap;
  return snap.map((s) => {
    let bestI = 0;
    let bestD = hav(raw[0], s);
    for (let i = 1; i < raw.length; i++) {
      const d = hav(raw[i], s);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    const a = raw[bestI].alt;
    if (a != null) return { ...s, alt: a };
    return s;
  });
}

function canonicalPoint(point: RawPoint): SnappedPoint {
  return {
    lat: point.lat,
    lng: point.lng,
    alt: point.alt,
    ...(point.t != null && Number.isFinite(point.t) ? { t: point.t } : {}),
  };
}

function attachSubsectionTime(snap: SnappedPoint[], raw: RawPoint[]): SnappedPoint[] {
  const startT = raw[0]?.t;
  const endT = raw[raw.length - 1]?.t;
  if (
    snap.length === 0
    || startT == null
    || endT == null
    || !Number.isFinite(startT)
    || !Number.isFinite(endT)
    || endT < startT
  ) return snap;
  const totalM = pathLength(snap);
  let progressedM = 0;
  return snap.map((point, index) => {
    if (index > 0) progressedM += hav(snap[index - 1], point);
    const fraction = totalM > 0 ? progressedM / totalM : index / Math.max(1, snap.length - 1);
    return { ...point, t: Math.round(startT + (endT - startT) * fraction) };
  });
}

// ============================================================================
// Mapbox /matching call (per chunk)
// ============================================================================

interface AcceptedMatcherIsland {
  sourceStart: number;
  sourceEnd: number;
  submittedStart: number;
  submittedEnd: number;
  points: SnappedPoint[];
  confidence: number;
  quality: MatchedGeometryQuality;
  topology: TopologyQuality;
  seam: IslandSeamQuality;
  seamTrimmedHeadPoints: number;
  seamTrimmedTailPoints: number;
}

interface MatchOk {
  ok: true;
  points: SnappedPoint[];
  acceptedIslands: AcceptedMatcherIsland[];
  confidence: number;
  qualities: MatchedGeometryQuality[];
  fallbackObservationCount: number;
  rejectedSubmatchCount: number;
  qualityRejectedSubmatchCount: number;
  seamRejectedSubmatchCount: number;
  seamShrunkSubmatchCount: number;
  islandResults: SnapTrackStats['requestResults'][number]['islandResults'];
  httpStatus: number;
  responseCode: string;
  subMatchingCount: number;
  tracepointCount: number | null;
  nullTracepointCount: number | null;
}
interface MatchFail {
  ok: false;
  reason: string;
  confidence?: number;
  quality?: MatchedGeometryQuality;
  httpStatus?: number;
  responseCode?: string;
  subMatchingCount?: number;
  tracepointCount?: number | null;
  nullTracepointCount?: number | null;
  rejectedSubmatchCount?: number;
  qualityRejectedSubmatchCount?: number;
  seamRejectedSubmatchCount?: number;
  seamShrunkSubmatchCount?: number;
  islandResults?: SnapTrackStats['requestResults'][number]['islandResults'];
}
type MatchResult = MatchOk | MatchFail;

interface MapboxTracepoint {
  matchings_index?: number;
  location?: [number, number];
}

function nearestGeometryIndex(
  geometry: SnappedPoint[],
  location: [number, number],
  minimumIndex = 0,
): number {
  const target = { lng: location[0], lat: location[1] };
  let bestIndex = Math.min(Math.max(0, minimumIndex), geometry.length - 1);
  let bestDistance = hav(geometry[bestIndex], target);
  for (let index = bestIndex + 1; index < geometry.length; index += 1) {
    const distance = hav(geometry[index], target);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex;
}

function cropGeometryToTracepoints(
  geometry: SnappedPoint[],
  head: [number, number] | undefined,
  tail: [number, number] | undefined,
  headIndex?: number,
  tailIndex?: number,
): SnappedPoint[] | null {
  if (!head || !tail || geometry.length < 2) return null;
  const resolvedHeadIndex = headIndex ?? nearestGeometryIndex(geometry, head);
  const resolvedTailIndex = tailIndex ?? nearestGeometryIndex(geometry, tail, resolvedHeadIndex);
  if (resolvedHeadIndex > resolvedTailIndex) return null;
  const cropped = [
    { lng: head[0], lat: head[1] },
    ...geometry.slice(resolvedHeadIndex, resolvedTailIndex + 1),
    { lng: tail[0], lat: tail[1] },
  ];
  return cropped.filter((point, index) => index === 0 || hav(cropped[index - 1], point) > 0.05);
}

function assembleHybridGeometry(
  canonical: RawPoint[],
  sourceStart: number,
  sourceEnd: number,
  islands: AcceptedMatcherIsland[],
): SnappedPoint[] {
  const ordered = islands.slice().sort((left, right) => left.sourceStart - right.sourceStart);
  const output: SnappedPoint[] = [];
  const append = (piece: SnappedPoint[], sharedBoundary: boolean) => {
    output.push(...(sharedBoundary && output.length > 0 ? piece.slice(1) : piece));
  };
  let cursor = sourceStart;
  for (const island of ordered) {
    if (island.sourceStart < cursor) continue;
    if (island.sourceStart > cursor) {
      append(canonical.slice(cursor, island.sourceStart + 1).map(canonicalPoint), output.length > 0);
    }
    append(island.points, output.length > 0);
    cursor = island.sourceEnd;
  }
  if (cursor < sourceEnd) {
    append(canonical.slice(cursor, sourceEnd + 1).map(canonicalPoint), output.length > 0);
  }
  if (output.length === 0) return canonical.slice(sourceStart, sourceEnd + 1).map(canonicalPoint);
  return output;
}

async function callMapbox(
  chunk: MatcherSubmittedPoint[],
  canonical: RawPoint[],
  token: string,
  perCallTimeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<MatchResult> {
  if (chunk.length < 2) return { ok: false, reason: 'too_short' };
  if (chunk.length > MAPBOX_HARD_COORD_CAP) return { ok: false, reason: 'oversize' };

  const coords = chunk.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const radiuses = chunk
    .map((p) => {
      const acc = typeof p.accuracy === 'number' ? p.accuracy : 15;
      return Math.round(Math.max(ACC_RADIUS_MIN, Math.min(ACC_RADIUS_MAX, acc)));
    })
    .join(';');
  const timestampValues = chunk.map(point => (
    point.t != null && Number.isFinite(point.t) ? Math.floor(point.t / 1_000) : null
  ));
  const timestampsIncluded = timestampValues.every((value): value is number => value !== null)
    && timestampValues.every((value, index) => index === 0 || value > (timestampValues[index - 1] as number));
  const timestampQuery = timestampsIncluded ? '&timestamps=' + timestampValues.join(';') : '';
  const url =
    `${MAPBOX_ENDPOINT}/${coords}?` +
    `geometries=geojson&overview=full&tidy=false` +
    `&access_token=${encodeURIComponent(token)}` +
    `&radiuses=${radiuses}${timestampQuery}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), perCallTimeoutMs);
  let externalListener: (() => void) | null = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeout);
      return { ok: false, reason: 'aborted' };
    }
    externalListener = () => controller.abort();
    try {
      externalSignal.addEventListener('abort', externalListener, { once: true } as any);
    } catch {
      /* no addEventListener support */
    }
  }
  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal });
    if (res.status >= 400) {
      return { ok: false, reason: `http_${res.status}`, httpStatus: res.status };
    }
    const body = (await res.json()) as {
      code?: string;
      matchings?: Array<{
        confidence?: number;
        geometry?: { coordinates: Array<[number, number]> };
      }>;
      tracepoints?: Array<MapboxTracepoint | null>;
    };
    if (body.code !== 'Ok' || !body.matchings || body.matchings.length === 0) {
      return {
        ok: false,
        reason: body.code ?? 'no_match',
        httpStatus: res.status,
        responseCode: body.code ?? 'missing-code',
        subMatchingCount: body.matchings?.length ?? 0,
        tracepointCount: body.tracepoints?.length ?? 0,
        nullTracepointCount: body.tracepoints?.filter(point => point === null).length ?? 0,
      };
    }
    const tracepointCount = body.tracepoints?.length ?? null;
    const nullTracepointCount = body.tracepoints?.filter(point => point === null).length ?? null;
    const diagnostics = {
      httpStatus: res.status,
      responseCode: body.code ?? 'missing-code',
      subMatchingCount: body.matchings.length,
      tracepointCount,
      nullTracepointCount,
    };
    if (body.tracepoints && body.tracepoints.length !== chunk.length) {
      return { ok: false, reason: 'tracepoint_count_mismatch', ...diagnostics };
    }

    // A response may contain several ordered matching islands separated by
    // null tracepoints, including more than one supported run for the same
    // Mapbox matching. Split support into maximal contiguous temporal runs.
    // The matching polyline is then cropped to each run's tracepoint endpoints,
    // so sparse support can never acquire ownership of the intervening chunk.
    const indexRuns = body.matchings.map((_matching, matchingIndex) => {
      if (!body.tracepoints) return [[]] as number[][];
      const supported = body.tracepoints.flatMap((tracepoint, index) => (
        tracepoint?.matchings_index === matchingIndex ? [index] : []
      ));
      if (supported.length === 0) return [[]] as number[][];
      const runs: number[][] = [];
      let current: number[] = [];
      for (const index of supported) {
        if (current.length > 0 && index !== current[current.length - 1] + 1) {
          runs.push(current);
          current = [];
        }
        current.push(index);
      }
      if (current.length > 0) runs.push(current);
      return runs;
    });
    const accepted: AcceptedMatcherIsland[] = [];
    let rejectedSubmatchCount = 0;
    let qualityRejectedSubmatchCount = 0;
    let seamRejectedSubmatchCount = 0;
    let seamShrunkSubmatchCount = 0;
    let rejectedQuality: MatchedGeometryQuality | undefined;
    let rejectedConfidence: number | undefined;
    const islandResults: MatchOk['islandResults'] = [];
    for (const [matchingIndex, matching] of body.matchings.entries()) {
      const confidence = matching.confidence ?? 0;
      const geometry = matching.geometry?.coordinates ?? [];
      const fullGeometry = geometry.map(([lng, lat]) => ({ lng, lat }));
      // The same coordinate can be visited repeatedly. Resolve tracepoints in
      // temporal order along the returned geometry instead of using an
      // unconstrained nearest lookup that could confuse a return with the
      // original departure point.
      const geometryIndexBySubmitted = new Map<number, number>();
      let geometryCursor = 0;
      for (const submittedIndex of indexRuns[matchingIndex].flat()) {
        const location = body.tracepoints?.[submittedIndex]?.location;
        if (!location || fullGeometry.length === 0) continue;
        const geometryIndex = nearestGeometryIndex(fullGeometry, location, geometryCursor);
        geometryIndexBySubmitted.set(submittedIndex, geometryIndex);
        geometryCursor = geometryIndex;
      }
      for (const indices of indexRuns[matchingIndex]) {
        const hasSupport = indices.length >= MIN_ISLAND_SUPPORT_POINTS;
        if (!hasSupport || confidence < CONF_FALLBACK || geometry.length < 2) {
          rejectedSubmatchCount += 1;
          rejectedConfidence = rejectedConfidence == null
            ? confidence
            : Math.min(rejectedConfidence, confidence);
          islandResults.push({
            sourceStart: indices[0] == null ? null : chunk[indices[0]].sourceIndex,
            sourceEnd: indices[indices.length - 1] == null ? null : chunk[indices[indices.length - 1]].sourceIndex,
            decision: 'canonical-fallback',
            reason: !hasSupport ? 'unsupported-temporal-run'
              : confidence < CONF_FALLBACK ? 'low-confidence' : 'missing-geometry',
            confidence,
            qualityReason: null,
            topologyReason: null,
            seamReason: null,
            quality: null,
            topology: null,
            seam: null,
            seamTrimmedHeadPoints: 0,
            seamTrimmedTailPoints: 0,
          });
          continue;
        }
        let lastGateReason = 'unusable-island';
        let lastTopology: TopologyQuality | null = null;
        let lastSeam: IslandSeamQuality | null = null;
        let lastTopologyReason: TopologyQuality['reason'] | null = null;
        let lastSeamReason: IslandSeamQuality['reason'] | null = null;
        let lastQuality: MatchedGeometryQuality | undefined;
        const candidate = (trimHead: number, trimTail: number): AcceptedMatcherIsland | null => {
          const submittedStart = indices[trimHead];
          const submittedEnd = indices[indices.length - 1 - trimTail];
          if (submittedStart == null || submittedEnd == null || indices.length - trimHead - trimTail < MIN_ISLAND_SUPPORT_POINTS) {
            lastGateReason = 'insufficient-support';
            return null;
          }
          const sourceStart = chunk[submittedStart].sourceIndex;
          const sourceEnd = chunk[submittedEnd].sourceIndex;
          const rawSubsection = canonical.slice(sourceStart, sourceEnd + 1);
          if (rawSubsection.length < 2 || pathLength(rawSubsection) < MIN_ISLAND_SOURCE_LENGTH_M) {
            lastGateReason = 'short-island';
            return null;
          }
          const matchedPoints = cropGeometryToTracepoints(
            fullGeometry,
            body.tracepoints?.[submittedStart]?.location,
            body.tracepoints?.[submittedEnd]?.location,
            geometryIndexBySubmitted.get(submittedStart),
            geometryIndexBySubmitted.get(submittedEnd),
          );
          if (!matchedPoints || matchedPoints.length < 2) {
            lastGateReason = 'uncroppable-geometry';
            return null;
          }
          const quality = evaluateMatchedGeometryQuality(rawSubsection, matchedPoints);
          lastQuality = quality;
          const endpointCoverage = analyzeTrustedEndpointCoverage(rawSubsection, matchedPoints);
          if (!quality.accepted || !endpointCoverage.eligibleForAnchoring) {
            rejectedQuality = quality;
            lastGateReason = !quality.accepted ? `quality-${quality.reason}` : 'endpoint-coverage';
            return null;
          }
          const anchored = preserveTrustedRouteEndpoints(
            rawSubsection,
            attachSubsectionTime(attachAltFromRaw(matchedPoints, rawSubsection), rawSubsection),
          );
          const topology = evaluateTopologyQuality(rawSubsection, anchored);
          lastTopology = topology;
          lastTopologyReason = topology.reason;
          if (!topology.accepted) {
            lastGateReason = `topology-${topology.reason}`;
            return null;
          }
          const seam = evaluateIslandSeamQuality(canonical, sourceStart, sourceEnd, anchored);
          lastSeam = seam;
          lastSeamReason = seam.reason;
          lastGateReason = seam.accepted ? 'accepted' : `seam-${seam.reason}`;
          return {
            sourceStart,
            sourceEnd,
            submittedStart,
            submittedEnd,
            points: anchored,
            confidence,
            quality,
            topology,
            seam,
            seamTrimmedHeadPoints: trimHead,
            seamTrimmedTailPoints: trimTail,
          };
        };

        let island = candidate(0, 0);
        const initialPassedNonSeamGates = island !== null;
        if (island && !island.seam.accepted) {
          island = null;
          for (let totalTrim = 1; totalTrim <= MAX_SEAM_TRIM_POINTS && !island; totalTrim += 1) {
            for (let trimHead = 0; trimHead <= totalTrim; trimHead += 1) {
              const trimmed = candidate(trimHead, totalTrim - trimHead);
              if (trimmed?.seam.accepted) {
                island = trimmed;
                seamShrunkSubmatchCount += 1;
                break;
              }
            }
          }
          if (!island) seamRejectedSubmatchCount += 1;
        }
        if (!island || !island.seam.accepted) {
          rejectedSubmatchCount += 1;
          if (!initialPassedNonSeamGates) qualityRejectedSubmatchCount += 1;
          rejectedConfidence = rejectedConfidence == null
            ? confidence
            : Math.min(rejectedConfidence, confidence);
          islandResults.push({
            sourceStart: chunk[indices[0]]?.sourceIndex ?? null,
            sourceEnd: chunk[indices[indices.length - 1]]?.sourceIndex ?? null,
            decision: 'canonical-fallback',
            reason: lastGateReason,
            confidence,
            qualityReason: lastQuality?.reason ?? null,
            topologyReason: lastTopologyReason,
            seamReason: lastSeamReason,
            quality: lastQuality ?? null,
            topology: lastTopology,
            seam: lastSeam,
            seamTrimmedHeadPoints: 0,
            seamTrimmedTailPoints: 0,
          });
          continue;
        }
        accepted.push(island);
        islandResults.push({
          sourceStart: island.sourceStart,
          sourceEnd: island.sourceEnd,
          decision: 'matched',
          reason: island.seamTrimmedHeadPoints > 0 || island.seamTrimmedTailPoints > 0
            ? 'accepted-after-seam-shrink'
            : 'accepted',
          confidence,
          qualityReason: island.quality.reason,
          topologyReason: island.topology.reason,
          seamReason: island.seam.reason,
          quality: island.quality,
          topology: island.topology,
          seam: island.seam,
          seamTrimmedHeadPoints: island.seamTrimmedHeadPoints,
          seamTrimmedTailPoints: island.seamTrimmedTailPoints,
        });
      }
    }
    if (accepted.length === 0) {
      const reason = rejectedQuality
        ? `quality_${rejectedQuality.reason}`
        : nullTracepointCount != null && nullTracepointCount > 0
          ? 'partial_tracepoint_coverage'
          : body.matchings.length > 1
            ? 'multiple_submatchings'
            : `low_or_unusable_match_${(rejectedConfidence ?? 0).toFixed(2)}`;
      return {
        ok: false,
        reason,
        confidence: rejectedConfidence,
        quality: rejectedQuality,
        rejectedSubmatchCount,
        qualityRejectedSubmatchCount,
        seamRejectedSubmatchCount,
        seamShrunkSubmatchCount,
        islandResults,
        ...diagnostics,
      };
    }
    accepted.sort((a, b) => a.sourceStart - b.sourceStart);
    const sourceStart = chunk[0].sourceIndex;
    const sourceEnd = chunk[chunk.length - 1].sourceIndex;
    const points = assembleHybridGeometry(canonical, sourceStart, sourceEnd, accepted);
    const matchedObservationCount = accepted.reduce(
      (count, island) => count + island.sourceEnd - island.sourceStart + 1,
      0,
    );
    return {
      ok: true,
      confidence: Math.min(...accepted.map(subsection => subsection.confidence)),
      points,
      acceptedIslands: accepted,
      qualities: accepted.map(subsection => subsection.quality),
      fallbackObservationCount: Math.max(0, sourceEnd - sourceStart + 1 - matchedObservationCount),
      rejectedSubmatchCount,
      qualityRejectedSubmatchCount,
      seamRejectedSubmatchCount,
      seamShrunkSubmatchCount,
      islandResults,
      ...diagnostics,
    };
  } catch (e: any) {
    return { ok: false, reason: e?.name === 'AbortError' ? 'aborted' : 'network' };
  } finally {
    clearTimeout(timeout);
    if (externalListener && externalSignal) {
      try {
        externalSignal.removeEventListener('abort', externalListener);
      } catch {
        /* polyfill missing — fine, listener was once:true */
      }
    }
  }
}

// ============================================================================
// Chunk dispatcher with bounded concurrency
// ============================================================================

async function fetchChunksConcurrent<T>(
  count: number,
  concurrency: number,
  worker: (i: number) => Promise<T>,
  signal?: AbortSignal,
): Promise<T[]> {
  const results: T[] = new Array(count);
  let next = 0;
  async function pull(): Promise<void> {
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= count) return;
      results[i] = await worker(i);
    }
  }
  const lanes: Promise<void>[] = [];
  const lanesN = Math.max(1, Math.min(concurrency, count));
  for (let i = 0; i < lanesN; i++) lanes.push(pull());
  await Promise.all(lanes);
  return results;
}

// ============================================================================
// Snap a single GOOD run (chunked)
// ============================================================================

interface ChunkOutcome {
  start: number; // submitted-index (within run)
  end: number;
  sourceStart: number;
  sourceEnd: number;
  islands: AcceptedMatcherIsland[];
}

interface GoodRunResult {
  points: SnappedPoint[];
  islands: AcceptedMatcherIsland[];
}

function geometryFingerprint(points: Array<{ lat: number; lng: number }>): string {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const text = `${point.lat.toFixed(6)},${point.lng.toFixed(6)};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function requestCadence(points: MatcherSubmittedPoint[]): {
  cadenceP50Ms: number;
  cadenceP95Ms: number;
  spatialSpacingP50M: number;
  spatialSpacingP95M: number;
} {
  const temporal = points.slice(1).flatMap((point, index) => (
    point.t != null && points[index].t != null
      ? [Number(point.t) - Number(points[index].t)]
      : []
  ));
  const spatial = points.slice(1).map((point, index) => hav(points[index], point));
  return {
    cadenceP50Ms: percentile50(temporal),
    cadenceP95Ms: percentile(temporal, 0.95),
    spatialSpacingP50M: percentile50(spatial),
    spatialSpacingP95M: percentile(spatial, 0.95),
  };
}

async function snapGoodRun(
  runRaw: RawPoint[],
  token: string,
  perCallTimeoutMs: number,
  concurrency: number,
  stats: SnapTrackStats,
  sourceIndexOffset: number,
  signal?: AbortSignal,
): Promise<GoodRunResult> {
  if (runRaw.length < 2) return { points: runRaw.map(canonicalPoint), islands: [] };

  const submitted = resampleMatcherEvidence(runRaw);
  stats.resampledPointCount += submitted.length;
  if (submitted.length < 2) return { points: runRaw.map(canonicalPoint), islands: [] };

  const chunkBounds: Array<[number, number]> = [];
  let i = 0;
  while (i < submitted.length) {
    // Avoid a tiny tail request (for example 80 + 80 + 4). If the remaining
    // ordered evidence fits Mapbox's hard 100-coordinate cap, keep it in one
    // request so a request boundary cannot masquerade as an authority seam.
    const remaining = submitted.length - i;
    const e = remaining <= MAPBOX_HARD_COORD_CAP
      ? submitted.length
      : Math.min(i + CHUNK_SIZE, submitted.length);
    chunkBounds.push([i, e]);
    if (e === submitted.length) break;
    i = e - CHUNK_OVERLAP;
  }

  const outcomes: ChunkOutcome[] = await fetchChunksConcurrent(
    chunkBounds.length,
    concurrency,
    async (idx) => {
      const [s, e] = chunkBounds[idx];
      const sub = submitted.slice(s, e);
      stats.apiCalls += 1;
      const requestStartedAt = Date.now();
      const r = await callMapbox(sub, runRaw, token, perCallTimeoutMs, signal);
      const radiuses = sub.map(point => Math.round(Math.max(
        ACC_RADIUS_MIN,
        Math.min(ACC_RADIUS_MAX, typeof point.accuracy === 'number' ? point.accuracy : 15),
      )));
      const timestamps = sub.map(point => (
        point.t != null && Number.isFinite(point.t) ? Math.floor(point.t / 1_000) : null
      ));
      const timestampsIncluded = timestamps.every((value): value is number => value !== null)
        && timestamps.every((value, index) => index === 0 || value > (timestamps[index - 1] as number));
      const cadence = requestCadence(sub);
      stats.requestResults.push({
        inputPointCount: sub.length,
        canonicalSpanPointCount: sub[sub.length - 1].sourceIndex - sub[0].sourceIndex + 1,
        sourceIndexMap: sub.map(point => point.sourceIndex + sourceIndexOffset),
        headTimestamp: sub[0]?.t ?? null,
        tailTimestamp: sub[sub.length - 1]?.t ?? null,
        timestampsIncluded,
        ...cadence,
        minimumRadiusM: Math.min(...radiuses),
        maximumRadiusM: Math.max(...radiuses),
        durationMs: Date.now() - requestStartedAt,
        result: r.ok
          ? (r.fallbackObservationCount > 0 || r.rejectedSubmatchCount > 0 ? 'accepted_hybrid' : 'accepted')
          : ('reason' in r ? r.reason : 'unusable-match'),
        httpStatus: r.httpStatus ?? null,
        responseCode: r.responseCode ?? null,
        subMatchingCount: r.subMatchingCount ?? null,
        tracepointCount: r.tracepointCount ?? null,
        nullTracepointCount: r.nullTracepointCount ?? null,
        confidence: r.ok ? r.confidence : (r.confidence ?? null),
        qualityReason: r.ok ? 'accepted' : ('quality' in r ? (r.quality?.reason ?? null) : null),
        acceptedIslandCount: r.ok ? r.acceptedIslands.length : 0,
        rejectedIslandCount: r.ok ? r.rejectedSubmatchCount : (r.rejectedSubmatchCount ?? 0),
        seamRejectedIslandCount: r.ok ? r.seamRejectedSubmatchCount : (r.seamRejectedSubmatchCount ?? 0),
        matcherTidy: false,
        profile: 'walking',
        islandResults: (r.ok ? r.islandResults : (r.islandResults ?? [])).map(island => ({
          ...island,
          sourceStart: island.sourceStart == null ? null : island.sourceStart + sourceIndexOffset,
          sourceEnd: island.sourceEnd == null ? null : island.sourceEnd + sourceIndexOffset,
        })),
      });
      if (r.ok) {
        stats.chunksOk += 1;
        if (r.fallbackObservationCount > 0 || r.rejectedSubmatchCount > 0) {
          stats.chunksFallback += 1;
        }
        stats.qualityFallbacks += r.qualityRejectedSubmatchCount;
        stats.rejectedIslandCount += r.rejectedSubmatchCount;
        stats.seamRejectedIslandCount += r.seamRejectedSubmatchCount;
        stats.seamShrunkIslandCount += r.seamShrunkSubmatchCount;
        stats.minConfidence = stats.minConfidence === null ? r.confidence : Math.min(stats.minConfidence, r.confidence);
        for (const quality of r.qualities) {
          stats.maxP95DeviationM = Math.max(stats.maxP95DeviationM, quality.p95DeviationM);
          stats.maxEndpointDeviationM = Math.max(stats.maxEndpointDeviationM, quality.endpointDeviationM);
        }
        return {
          start: s,
          end: e,
          sourceStart: sub[0].sourceIndex,
          sourceEnd: sub[sub.length - 1].sourceIndex,
          islands: r.acceptedIslands,
        };
      }
      stats.chunksFallback += 1;
      stats.rejectedIslandCount += r.rejectedSubmatchCount ?? 0;
      stats.qualityFallbacks += r.qualityRejectedSubmatchCount ?? 0;
      stats.seamRejectedIslandCount += r.seamRejectedSubmatchCount ?? 0;
      stats.seamShrunkIslandCount += r.seamShrunkSubmatchCount ?? 0;
      if ('quality' in r && r.quality) {
        stats.maxP95DeviationM = Math.max(stats.maxP95DeviationM, r.quality.p95DeviationM);
        stats.maxEndpointDeviationM = Math.max(stats.maxEndpointDeviationM, r.quality.endpointDeviationM);
      }
      return {
        start: s,
        end: e,
        sourceStart: sub[0].sourceIndex,
        sourceEnd: sub[sub.length - 1].sourceIndex,
        islands: [],
      };
    },
    signal,
  );

  const candidateIslands = outcomes.flatMap(outcome => outcome.islands)
    .sort((left, right) => left.sourceStart - right.sourceStart);
  // Chunks share exactly one submitted boundary. Reject overlapping ownership
  // beyond that boundary rather than spatially merging two Mapbox geometries.
  let islands: AcceptedMatcherIsland[] = [];
  for (const island of candidateIslands) {
    const prior = islands[islands.length - 1];
    if (!prior || island.sourceStart >= prior.sourceEnd) islands.push(island);
    else stats.rejectedIslandCount += 1;
  }
  let output = assembleHybridGeometry(runRaw, 0, runRaw.length - 1, islands);
  let validation = evaluateWholeRouteQuality(runRaw, output);
  while (!validation.accepted && islands.length > 0) {
    const weakest = islands.reduce((selected, island, index) => {
      const score = island.confidence * Math.max(1, island.quality.rawLengthM);
      return score < selected.score ? { index, score } : selected;
    }, { index: 0, score: Infinity });
    islands = islands.filter((_island, index) => index !== weakest.index);
    stats.wholeRouteRejectedIslandCount += 1;
    output = assembleHybridGeometry(runRaw, 0, runRaw.length - 1, islands);
    validation = evaluateWholeRouteQuality(runRaw, output);
  }
  stats.matchedIslandCount += islands.length;
  const matchedDistanceM = islands.reduce((sum, island) => sum + island.quality.rawLengthM, 0);
  stats.acceptedMatchedDistanceM += matchedDistanceM;
  stats.canonicalFallbackDistanceM += Math.max(0, pathLength(runRaw) - matchedDistanceM);
  return { points: output, islands };
}

// ============================================================================
// Public entrypoint
// ============================================================================

/**
 * Snap a raw GPS track to roads via Mapbox /matching.
 *
 * Caller MUST persist `raw` separately — this function is a *view*, not a
 * source of truth. On any failure, the caller should fall back to whatever
 * smoothed-raw representation it has.
 *
 * Pipeline detail in this file's header. Empirical numbers in
 * docs/spikes/SPIKE_ACTIVITY_V2_REPORT.md.
 */
export async function snapTrack(
  raw: RawPoint[],
  options: SnapTrackOptions,
): Promise<SnapTrackResult> {
  const t0 = Date.now();
  const stats: SnapTrackStats = {
    apiCalls: 0,
    chunksOk: 0,
    chunksFallback: 0,
    qualityFallbacks: 0,
    minConfidence: null,
    maxP95DeviationM: 0,
    maxEndpointDeviationM: 0,
    goodRuns: 0,
    lostRuns: 0,
    seamBridges: 0,
    canonicalPointCount: raw?.length ?? 0,
    resampledPointCount: 0,
    matchedIslandCount: 0,
    rejectedIslandCount: 0,
    seamRejectedIslandCount: 0,
    seamShrunkIslandCount: 0,
    wholeRouteRejectedIslandCount: 0,
    acceptedMatchedDistanceM: 0,
    canonicalFallbackDistanceM: 0,
    wholeRouteValidation: {
      accepted: false,
      reason: 'endpoint_change',
      canonicalLengthM: 0,
      finalLengthM: 0,
      lengthRatio: 1,
      maximumCanonicalEdgeM: 0,
      maximumFinalEdgeM: 0,
    },
    finalGeometryFingerprint: null,
    requestResults: [],
    durationMs: 0,
  };
  const finishStats = () => {
    stats.durationMs = Date.now() - t0;
  };

  if (!raw || raw.length === 0) {
    finishStats();
    return { ok: false, reason: 'no_input', stats };
  }
  if (raw.length < 2) {
    finishStats();
    return { ok: false, reason: 'too_short', stats };
  }
  if (!options.mapboxToken) {
    finishStats();
    return { ok: false, reason: 'no_token', stats };
  }
  if (options.signal?.aborted) {
    finishStats();
    return { ok: false, reason: 'aborted', stats };
  }

  const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
  const perCallTimeoutMs = options.perCallTimeoutMs ?? DEFAULT_PER_CALL_TIMEOUT_MS;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  // Wrap the whole pipeline with a total-timeout AbortController
  const totalAbort = new AbortController();
  const totalTimer = setTimeout(() => totalAbort.abort(), totalTimeoutMs);
  // Combine caller signal + total timeout
  let combinedExternalListener: (() => void) | null = null;
  if (options.signal) {
    combinedExternalListener = () => totalAbort.abort();
    try {
      options.signal.addEventListener('abort', combinedExternalListener, { once: true } as any);
    } catch {
      /* no addEventListener support */
    }
  }

  try {
    const runs = tagRuns(raw);
    const final: SnappedPoint[] = [];
    for (const run of runs) {
      if (totalAbort.signal.aborted) {
        finishStats();
        return { ok: false, reason: 'timed_out', stats };
      }
      const runRaw = raw.slice(run.start, run.end);
      let piece: SnappedPoint[];
      if (run.kind === 'good') {
        stats.goodRuns += 1;
        const matched = await snapGoodRun(
          runRaw,
          options.mapboxToken,
          perCallTimeoutMs,
          concurrency,
          stats,
          run.start,
          totalAbort.signal,
        );
        piece = matched.points;
      } else {
        stats.lostRuns += 1;
        // LOST run: never call Mapbox and never prettify the fallback.
        piece = runRaw.map(canonicalPoint);
        stats.canonicalFallbackDistanceM += pathLength(runRaw);
      }
      if (piece.length === 0) continue;
      // Runs are adjacent portions of the same caller-provided canonical
      // segment. Preserve every point and its temporal order; explicit Activity
      // gaps are split by the caller before this function is invoked.
      for (const point of piece) final.push(point);
    }

    // Total failure: every chunk fell back AND no LOST-only runs salvaged
    if (
      stats.goodRuns > 0 &&
      stats.chunksOk === 0 &&
      stats.chunksFallback > 0
    ) {
      // Every Mapbox call failed; we still have an exact canonical output, but
      // the caller should know the snap step contributed nothing.
      // Per contract, this is still ok=true with the canonical result —
      // the caller fallbacks at a higher level. Mark stats so caller can
      // decide.
      // We keep it as ok=true because the output is still usable
      // (canonical fallback remains the truthful rendering authority).
    }

    if (final.length < 2) {
      finishStats();
      return { ok: false, reason: 'all_chunks_failed', stats };
    }

    stats.wholeRouteValidation = evaluateWholeRouteQuality(raw, final);
    stats.canonicalFallbackDistanceM = Math.max(0, pathLength(raw) - stats.acceptedMatchedDistanceM);
    if (!stats.wholeRouteValidation.accepted) {
      // A whole-route anomaly is never worth preserving for extra Snap. Exact
      // canonical fallback is the only safe global recovery; local island
      // rejection normally prevents this branch.
      stats.wholeRouteRejectedIslandCount += stats.matchedIslandCount;
      stats.matchedIslandCount = 0;
      stats.acceptedMatchedDistanceM = 0;
      stats.canonicalFallbackDistanceM = pathLength(raw);
      const canonical = raw.map(canonicalPoint);
      stats.wholeRouteValidation = evaluateWholeRouteQuality(raw, canonical);
      stats.finalGeometryFingerprint = geometryFingerprint(canonical);
      finishStats();
      return { ok: true, points: canonical, stats };
    }
    stats.finalGeometryFingerprint = geometryFingerprint(final);

    finishStats();
    return { ok: true, points: final, stats };
  } catch (e: any) {
    finishStats();
    return {
      ok: false,
      reason: e?.name === 'AbortError' ? 'aborted' : 'all_chunks_failed',
      stats,
    };
  } finally {
    clearTimeout(totalTimer);
    if (combinedExternalListener && options.signal) {
      try {
        options.signal.removeEventListener('abort', combinedExternalListener);
      } catch {
        /* polyfill missing — fine */
      }
    }
  }
}
