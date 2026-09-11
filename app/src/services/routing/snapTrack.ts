/**
 * snapTrack.ts — Activity-length GPS → road-snap pipeline (v7 hybrid).
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
 *   3. For each GOOD run: chunk at 80 with one canonical boundary point. Per-chunk Mapbox
 *      /matching call with `tidy=true` and per-coord radiuses (clamp accuracy
 *      to [10, 40]m). Up to 4 chunks fetched in parallel.
 *   4. On chunk success: take Mapbox geometry. Re-attach alt from raw via
 *      nearest-neighbor.
 *   5. On chunk failure (NoSegment / NoMatch / network / quality): preserve
 *      that chunk's canonical coordinates exactly.
 *   6. Every accepted chunk is anchored to its canonical start/end. Adjacent
 *      chunks share that exact temporal boundary; nearest geography can never
 *      jump to another pass over the same road.
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

interface SnapTrackOptions {
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
  /** Privacy-safe evidence for each external request; never includes token or coordinates. */
  requestResults: Array<{
    inputPointCount: number;
    headTimestamp: number | null;
    tailTimestamp: number | null;
    timestampsIncluded: boolean;
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
const CONF_FALLBACK = 0.3;        // Mapbox match confidence < this => raw fallback
const ENDPOINT_REPLACE_M = 3;     // replace a near-derived endpoint with canonical truth
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
 * middle. Near-coincident derived endpoints are replaced; bounded offsets keep
 * the Mapbox endpoint and add a short canonical connector so legitimate head
 * or tail movement is never erased.
 */
export function preserveTrustedRouteEndpoints(
  raw: RawPoint[],
  matched: SnappedPoint[],
  replaceWithinM = ENDPOINT_REPLACE_M,
): SnappedPoint[] {
  if (raw.length < 2 || matched.length < 2) return matched.slice();
  const coverage = analyzeTrustedEndpointCoverage(raw, matched);
  if (!coverage.eligibleForAnchoring) return matched.slice();
  const first = canonicalPoint(raw[0]);
  const lastRaw = raw[raw.length - 1];
  const last = canonicalPoint(lastRaw);
  const out = matched.slice();
  if (hav(first, out[0]) <= replaceWithinM) out[0] = first;
  else out.unshift(first);
  if (hav(last, out[out.length - 1]) <= replaceWithinM) out[out.length - 1] = last;
  else out.push(last);
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

interface MatchOk {
  ok: true;
  points: SnappedPoint[];
  confidence: number;
  qualities: MatchedGeometryQuality[];
  fallbackObservationCount: number;
  rejectedSubmatchCount: number;
  qualityRejectedSubmatchCount: number;
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
}
type MatchResult = MatchOk | MatchFail;

async function callMapbox(
  chunk: RawPoint[],
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
    `geometries=geojson&overview=full&tidy=true` +
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
      tracepoints?: Array<{ matchings_index?: number } | null>;
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
    // null tracepoints. A matching is usable only when its source observations
    // form one contiguous temporal span. Everything between those spans stays
    // exact canonical fallback; no derived or nearest-neighbour connector is
    // ever inserted.
    const indexSpans = body.matchings.map((_matching, matchingIndex) => {
      if (!body.tracepoints) {
        return body.matchings!.length === 1
          ? Array.from({ length: chunk.length }, (_unused, index) => index)
          : [];
      }
      return body.tracepoints.flatMap((tracepoint, index) => (
        tracepoint?.matchings_index === matchingIndex ? [index] : []
      ));
    });
    const accepted: Array<{
      start: number;
      end: number;
      points: SnappedPoint[];
      confidence: number;
      quality: MatchedGeometryQuality;
    }> = [];
    let rejectedSubmatchCount = 0;
    let qualityRejectedSubmatchCount = 0;
    let rejectedQuality: MatchedGeometryQuality | undefined;
    let rejectedConfidence: number | undefined;
    for (const [matchingIndex, matching] of body.matchings.entries()) {
      const indices = indexSpans[matchingIndex];
      const contiguous = indices.length >= 2
        && indices.every((value, index) => index === 0 || value === indices[index - 1] + 1);
      const confidence = matching.confidence ?? 0;
      const geometry = matching.geometry?.coordinates ?? [];
      if (!contiguous || confidence < CONF_FALLBACK || geometry.length < 2) {
        rejectedSubmatchCount += 1;
        rejectedConfidence = rejectedConfidence == null
          ? confidence
          : Math.min(rejectedConfidence, confidence);
        continue;
      }
      const start = indices[0];
      const end = indices[indices.length - 1];
      const rawSubsection = chunk.slice(start, end + 1);
      const matchedPoints = geometry.map(([lng, lat]) => ({ lng, lat }));
      const quality = evaluateMatchedGeometryQuality(rawSubsection, matchedPoints);
      const endpointCoverage = analyzeTrustedEndpointCoverage(rawSubsection, matchedPoints);
      if (!quality.accepted || !endpointCoverage.eligibleForAnchoring) {
        rejectedSubmatchCount += 1;
        qualityRejectedSubmatchCount += 1;
        rejectedQuality = quality;
        rejectedConfidence = rejectedConfidence == null
          ? confidence
          : Math.min(rejectedConfidence, confidence);
        continue;
      }
      accepted.push({
        start,
        end,
        points: preserveTrustedRouteEndpoints(
          rawSubsection,
          attachSubsectionTime(attachAltFromRaw(matchedPoints, rawSubsection), rawSubsection),
        ),
        confidence,
        quality,
      });
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
        ...diagnostics,
      };
    }
    accepted.sort((a, b) => a.start - b.start);
    const points: SnappedPoint[] = [];
    const append = (piece: SnappedPoint[]) => {
      if (piece.length === 0) return;
      if (points.length > 0 && hav(points[points.length - 1], piece[0]) <= 0.5) {
        points.push(...piece.slice(1));
      } else {
        points.push(...piece);
      }
    };
    let cursor = 0;
    let matchedObservationCount = 0;
    for (const subsection of accepted) {
      if (subsection.start > cursor) {
        append(chunk.slice(cursor, subsection.start + 1).map(canonicalPoint));
      }
      append(subsection.points);
      cursor = subsection.end;
      matchedObservationCount += subsection.end - subsection.start + 1;
    }
    if (cursor < chunk.length - 1) {
      append(chunk.slice(cursor).map(canonicalPoint));
    }
    return {
      ok: true,
      confidence: Math.min(...accepted.map(subsection => subsection.confidence)),
      points,
      qualities: accepted.map(subsection => subsection.quality),
      fallbackObservationCount: Math.max(0, chunk.length - matchedObservationCount),
      rejectedSubmatchCount,
      qualityRejectedSubmatchCount,
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
  start: number; // raw-index (within run)
  end: number;
  snap: SnappedPoint[] | null; // null => fallback raw for this chunk
}

async function snapGoodRun(
  runRaw: RawPoint[],
  token: string,
  perCallTimeoutMs: number,
  concurrency: number,
  stats: SnapTrackStats,
  signal?: AbortSignal,
): Promise<SnappedPoint[]> {
  if (runRaw.length < 2) return runRaw.map(canonicalPoint);

  const chunkBounds: Array<[number, number]> = [];
  let i = 0;
  while (i < runRaw.length) {
    const e = Math.min(i + CHUNK_SIZE, runRaw.length);
    chunkBounds.push([i, e]);
    if (e === runRaw.length) break;
    i = e - CHUNK_OVERLAP;
  }

  const outcomes: ChunkOutcome[] = await fetchChunksConcurrent(
    chunkBounds.length,
    concurrency,
    async (idx) => {
      const [s, e] = chunkBounds[idx];
      const sub = runRaw.slice(s, e);
      stats.apiCalls += 1;
      const requestStartedAt = Date.now();
      const r = await callMapbox(sub, token, perCallTimeoutMs, signal);
      const radiuses = sub.map(point => Math.round(Math.max(
        ACC_RADIUS_MIN,
        Math.min(ACC_RADIUS_MAX, typeof point.accuracy === 'number' ? point.accuracy : 15),
      )));
      const timestamps = sub.map(point => (
        point.t != null && Number.isFinite(point.t) ? Math.floor(point.t / 1_000) : null
      ));
      const timestampsIncluded = timestamps.every((value): value is number => value !== null)
        && timestamps.every((value, index) => index === 0 || value > (timestamps[index - 1] as number));
      stats.requestResults.push({
        inputPointCount: sub.length,
        headTimestamp: sub[0]?.t ?? null,
        tailTimestamp: sub[sub.length - 1]?.t ?? null,
        timestampsIncluded,
        minimumRadiusM: Math.min(...radiuses),
        maximumRadiusM: Math.max(...radiuses),
        durationMs: Date.now() - requestStartedAt,
        result: r.ok
          ? (r.fallbackObservationCount > 0 || r.rejectedSubmatchCount > 0 ? 'accepted_hybrid' : 'accepted')
          : r.reason,
        httpStatus: r.httpStatus ?? null,
        responseCode: r.responseCode ?? null,
        subMatchingCount: r.subMatchingCount ?? null,
        tracepointCount: r.tracepointCount ?? null,
        nullTracepointCount: r.nullTracepointCount ?? null,
        confidence: r.ok ? r.confidence : (r.confidence ?? null),
        qualityReason: r.ok ? 'accepted' : (r.quality?.reason ?? null),
      });
      if (r.ok) {
        stats.chunksOk += 1;
        if (r.fallbackObservationCount > 0 || r.rejectedSubmatchCount > 0) {
          stats.chunksFallback += 1;
        }
        stats.qualityFallbacks += r.qualityRejectedSubmatchCount;
        stats.minConfidence = stats.minConfidence === null ? r.confidence : Math.min(stats.minConfidence, r.confidence);
        for (const quality of r.qualities) {
          stats.maxP95DeviationM = Math.max(stats.maxP95DeviationM, quality.p95DeviationM);
          stats.maxEndpointDeviationM = Math.max(stats.maxEndpointDeviationM, quality.endpointDeviationM);
        }
        return { start: s, end: e, snap: r.points };
      }
      stats.chunksFallback += 1;
      if (r.quality) {
        stats.qualityFallbacks += 1;
        stats.maxP95DeviationM = Math.max(stats.maxP95DeviationM, r.quality.p95DeviationM);
        stats.maxEndpointDeviationM = Math.max(stats.maxEndpointDeviationM, r.quality.endpointDeviationM);
      }
      return { start: s, end: e, snap: null };
    },
    signal,
  );

  // Stitch outcomes
  const out: SnappedPoint[] = [];
  for (const oc of outcomes) {
    let piece: SnappedPoint[];
    if (oc.snap === null) {
      // Canonical fallback remains byte-for-byte coordinate faithful. Final
      // presentation must not silently smooth an internal/unmapped path.
      const rawSlice = runRaw.slice(oc.start, oc.end);
      piece = rawSlice.map(canonicalPoint);
    } else {
      piece = oc.snap;
    }
    if (piece.length === 0) continue;
    if (out.length === 0) {
      out.push(...piece);
      continue;
    }
    // CHUNK_OVERLAP=1 and endpoint anchoring make this the same canonical
    // instant. Drop only that one temporal duplicate. Spatial nearest-neighbour
    // stitching is forbidden because repeated passes share coordinates.
    if (hav(out[out.length - 1], piece[0]) <= 0.5) out.push(...piece.slice(1));
    else out.push(...piece);
  }
  return out;
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
        piece = await snapGoodRun(
          runRaw,
          options.mapboxToken,
          perCallTimeoutMs,
          concurrency,
          stats,
          totalAbort.signal,
        );
      } else {
        stats.lostRuns += 1;
        // LOST run: never call Mapbox and never prettify the fallback.
        piece = runRaw.map(canonicalPoint);
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
