/**
 * MapMatchingClient — wrapper around Mapbox Map Matching API
 * `/matching/v5/mapbox/walking`.
 *
 * https://docs.mapbox.com/api/navigation/map-matching/
 *
 * Sprint 67 v236.
 *
 * Why Map Matching, not Directions:
 *   - Map Matching snaps an existing trace to roads → preserves shape.
 *     This is "走过的路才是路" semantics: we're saying "here is the trace,
 *     polish it onto road centerlines."
 *   - Directions free-routes from point A to point B (independent of how
 *     the user actually walked). That violates the product principle.
 *   - MM coord cap = 100 (vs Directions 25); fits whole-route input better.
 *
 * Network policy:
 *   - 8s timeout per request.
 *   - No hidden retry. The editor owns one finite Draw operation deadline.
 *   - 300 req/min Mapbox rate limit; we don't enforce client-side
 *     because debounce + via cap (5) keeps us well under.
 */

import type { LngLat } from '../corridor/PolylineSampler';
import type { MatchResult, MatchSegment } from './types';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
// v255: profile reverted /driving → /walking. Cairn is a hike + run app
// — small/visible foot trails MUST be snappable. /driving excluded
// footway/path/pedestrian and PO reported "我按照小路画了一个地图上可
// 以看到的 以前是可以的 现在报错" — driving NoMatch'd the obvious
// trail. PO direction: snap to walking; if Mapbox confidence is low,
// WARN the user but still accept the stroke. The user is the source of
// truth ("走过的路才是路"); Mapbox is advisory. Building/hospital-corridor
// false-snap is mitigated by the warning + user's own visual review.
const ENDPOINT_BASE = 'https://api.mapbox.com/matching/v5/mapbox/walking';
const TIMEOUT_MS = 8_000;

interface MapboxMatchingResponse {
  code: string;
  matchings?: Array<{
    confidence: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    legs?: Array<{ confidence?: number }>;
  }>;
  tracepoints?: Array<null | {
    matchings_index: number;
    waypoint_index: number | null;
    alternatives_count: number;
    location: [number, number];
  }>;
  message?: string;
}

interface ProjectedTracepoint {
  inputIndex: number;
  location: [number, number];
  progress: number;
  alternativesCount: number;
}

function projectToGeometry(
  geometry: LngLat[],
  location: [number, number],
  minimumProgress: number,
): { point: LngLat; progress: number } | null {
  if (geometry.length < 2) return null;
  const target = { lng: location[0], lat: location[1] };
  const latitude = target.lat * Math.PI / 180;
  const scaleX = Math.max(0.01, Math.cos(latitude));
  let best: { point: LngLat; progress: number; distanceSquared: number } | null = null;
  const firstSegment = Math.max(0, Math.min(geometry.length - 2, Math.floor(minimumProgress)));
  for (let index = firstSegment; index < geometry.length - 1; index += 1) {
    const start = geometry[index];
    const end = geometry[index + 1];
    const ax = (start.lng - target.lng) * scaleX;
    const ay = start.lat - target.lat;
    const bx = (end.lng - target.lng) * scaleX;
    const by = end.lat - target.lat;
    const dx = bx - ax;
    const dy = by - ay;
    const denominator = dx * dx + dy * dy;
    const minimumFraction = index === firstSegment ? Math.max(0, minimumProgress - index) : 0;
    const fraction = denominator <= Number.EPSILON
      ? minimumFraction
      : Math.max(minimumFraction, Math.min(1, -(ax * dx + ay * dy) / denominator));
    const x = ax + fraction * dx;
    const y = ay + fraction * dy;
    const candidate = {
      point: {
        lng: start.lng + (end.lng - start.lng) * fraction,
        lat: start.lat + (end.lat - start.lat) * fraction,
      },
      progress: index + fraction,
      distanceSquared: x * x + y * y,
    };
    if (!best || candidate.distanceSquared < best.distanceSquared) best = candidate;
  }
  return best ? { point: best.point, progress: best.progress } : null;
}

function geometryBetween(
  geometry: LngLat[],
  start: ProjectedTracepoint,
  end: ProjectedTracepoint,
): LngLat[] | null {
  if (end.progress <= start.progress + 1e-6) return null;
  const points: LngLat[] = [{ lng: start.location[0], lat: start.location[1] }];
  for (let index = Math.floor(start.progress) + 1; index <= Math.floor(end.progress); index += 1) {
    const point = geometry[index];
    if (point) points.push({ ...point });
  }
  points.push({ lng: end.location[0], lat: end.location[1] });
  return points.filter((point, index) => index === 0
    || Math.abs(point.lng - points[index - 1].lng) > 1e-10
    || Math.abs(point.lat - points[index - 1].lat) > 1e-10);
}

function mappedSegmentsForMatching(
  geometry: LngLat[],
  tracepoints: NonNullable<MapboxMatchingResponse['tracepoints']>,
  matchingIndex: number,
  confidence: number,
): Array<{
  points: LngLat[];
  confidence: number;
  inputStartIndex?: number;
  inputEndIndex?: number;
  alternativesCount?: number;
}> {
  const belonging = tracepoints
    .map((tracepoint, inputIndex) => ({ tracepoint, inputIndex }))
    .filter(({ tracepoint }) => tracepoint?.matchings_index === matchingIndex && Array.isArray(tracepoint.location));
  if (belonging.length === 0) return [{ points: geometry, confidence }];
  const projected: ProjectedTracepoint[] = [];
  let minimumProgress = 0;
  for (const { tracepoint, inputIndex } of belonging) {
    const projection = projectToGeometry(geometry, tracepoint!.location, minimumProgress);
    if (!projection) continue;
    minimumProgress = projection.progress;
    projected.push({
      inputIndex,
      location: tracepoint!.location,
      progress: projection.progress,
      alternativesCount: tracepoint!.alternatives_count ?? 0,
    });
  }
  const runs: ProjectedTracepoint[][] = [];
  for (const point of projected) {
    const current = runs.at(-1);
    if (!current || point.inputIndex !== current.at(-1)!.inputIndex + 1) runs.push([point]);
    else current.push(point);
  }
  return runs.flatMap(run => {
    if (run.length < 2) return [];
    const points = geometryBetween(geometry, run[0], run.at(-1)!);
    if (!points || points.length < 2) return [];
    return [{
      points,
      confidence,
      inputStartIndex: run[0].inputIndex,
      inputEndIndex: run.at(-1)!.inputIndex,
      alternativesCount: Math.max(...run.map(point => point.alternativesCount)),
    }];
  });
}

function fetchWithTimeout(
  url: string,
  ms: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ms);
    // v6.3 plan §1.2 / R3 C3: caller may pass an AbortSignal so hardware-back
    // / app-background can immediately cancel an in-flight Mapbox request
    // (saves quota + lets fence trigger return cleanly on the same tick).
    // R6 C3: { once: true } makes the listener self-detach the first time
    // it fires, so we never leak a listener even if removeEventListener
    // is unsupported on the target's polyfill.
    let externalListener: (() => void) | null = null;
    let cleanupExternal: (() => void) | null = null;
    if (externalSignal) {
      if (externalSignal.aborted) {
        clearTimeout(timer);
        reject(new Error('aborted'));
        return;
      }
      externalListener = () => {
        controller.abort();
        clearTimeout(timer);
        reject(new Error('aborted'));
      };
      try {
        externalSignal.addEventListener('abort', externalListener, { once: true });
        cleanupExternal = () => {
          try {
            externalSignal.removeEventListener('abort', externalListener!);
          } catch {
            /* polyfill missing removeEventListener — once:true already detached */
          }
        };
      } catch {
        /* no addEventListener at all — best-effort fallback: skip */
        externalListener = null;
      }
    }
    fetch(url, { method: 'GET', signal: controller.signal })
      .then(r => {
        clearTimeout(timer);
        if (cleanupExternal) cleanupExternal();
        resolve(r);
      })
      .catch(e => {
        clearTimeout(timer);
        if (cleanupExternal) cleanupExternal();
        reject(e);
      });
  });
}

function buildUrl(segment: MatchSegment): string {
  const coordsStr = segment.coords
    .map(c => `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`)
    .join(';');
  // Mapbox radiuses constraint: each value must be 0 < r <= 50 meters
  // (verified via live API — 'unlimited' is rejected with InvalidInput).
  //
  // v258 (PO direction "穿楼直线" diag):
  //   bumped DEFAULT from 25 → 50 (Mapbox cap). Why: when the user draws a
  //   stroke whose middle segment crosses a building (no walking edge inside
  //   25m of those points), HMM /matching at r=25 collapses the segment to
  //   a 2-point degenerate match (just the endpoints' nearest road snaps).
  //   That 2-point match shows up as a literal straight line through the
  //   building. With r=50 Mapbox has 2× the search radius to find a real
  //   detour — typically the parallel road behind/around the building, or
  //   the nearest junction — and returns a multi-vertex polyline that
  //   actually goes around. PO standard: brush always snaps to a real road,
  //   never a straight line. r=50 is the API cap so this is the largest
  //   we can give it; if the building is wider than 100m diameter this
  //   still won't find a detour, which is a hard limit of /matching at the
  //   API level.
  //
  // Prior history (kept for audit):
  //   v6.3 (plan §1.2): default 25m. Empirically (spike-fresh-v63-summary.md)
  //   r ∈ {15, 25, 40} all produce identical match output on the 250-case corpus,
  //   so 25 was chosen as a balanced midpoint. r=50 was originally rejected
  //   for being "looser than needed" — but the 250-case corpus did NOT include
  //   the through-building stress case PO is now reporting. r=8 (pre-v252)
  //   was too tight and produced spurious NoMatch on long strokes
  //   (spike-corridor-100v-results.md, J1-036 800m → only 60m snapped).
  const DEFAULT_RADIUS_M = 50;
  const radiusesStr = segment.radiuses
    .map(r => (r === null ? String(DEFAULT_RADIUS_M) : String(Math.min(50, Math.max(1, r)))))
    .join(';');
  // overview=full, geometries=geojson, tidy=true.
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    tidy: 'true',
    access_token: MAPBOX_TOKEN,
  });
  return `${ENDPOINT_BASE}/${coordsStr}?${params.toString()}&radiuses=${radiusesStr}`;
}

function parseResponse(body: MapboxMatchingResponse): {
  matchedPoints: LngLat[];
  confidence: number;
  segments: {
    points: LngLat[];
    confidence: number;
    inputStartIndex?: number;
    inputEndIndex?: number;
    alternativesCount?: number;
  }[];
} | null {
  if (!body.matchings || body.matchings.length === 0) return null;
  // v263: extract ALL matchings. Mapbox can split a single input into
  // multiple matching segments when mid-input deviates too far from
  // roads (HMM cuts the trace). Earlier we only read matchings[0],
  // missing the segment containing the end-anchor C → 300m+ splice gaps.
  // Legacy fields (matchedPoints / confidence) keep v260-v262 behavior
  // = matchings[0]; new callers consume `segments`.
  const segments: {
    points: LngLat[];
    confidence: number;
    inputStartIndex?: number;
    inputEndIndex?: number;
    alternativesCount?: number;
  }[] = [];
  for (let matchingIndex = 0; matchingIndex < body.matchings.length; matchingIndex += 1) {
    const m = body.matchings[matchingIndex];
    if (!m.geometry || m.geometry.type !== 'LineString') continue;
    const points: LngLat[] = m.geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
    segments.push(...mappedSegmentsForMatching(
      points,
      body.tracepoints ?? [],
      matchingIndex,
      m.confidence ?? 0,
    ));
  }
  if (segments.length === 0) return null;
  return {
    matchedPoints: segments[0].points,
    confidence: segments[0].confidence,
    segments,
  };
}

/**
 * Match a single segment. Single HTTP call. Caller responsible for
 * stitching multi-segment results.
 */
export async function matchSegment(
  segment: MatchSegment,
  options?: { signal?: AbortSignal },
): Promise<MatchResult> {
  const t0 = Date.now();
  if (!MAPBOX_TOKEN) {
    return {
      ok: false,
      reason: 'auth',
      detail: 'EXPO_PUBLIC_MAPBOX_TOKEN not configured',
      durationMs: 0,
    };
  }
  if (segment.coords.length < 2) {
    return {
      ok: false,
      reason: 'invalid-input',
      detail: `coord count ${segment.coords.length} < 2`,
      durationMs: 0,
    };
  }
  if (segment.coords.length > 100) {
    return {
      ok: false,
      reason: 'invalid-input',
      detail: `coord count ${segment.coords.length} > 100 (Mapbox cap)`,
      durationMs: 0,
    };
  }

  const url = buildUrl(segment);
  try {
      const res = await fetchWithTimeout(url, TIMEOUT_MS, options?.signal);
      if (res.status === 429) {
        return { ok: false, reason: 'rate-limit', durationMs: Date.now() - t0 };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'auth', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
      }
      if (res.status >= 500) {
        return {
          ok: false,
          reason: 'network',
          detail: `HTTP ${res.status}`,
          durationMs: Date.now() - t0,
        };
      }
      const body = (await res.json()) as MapboxMatchingResponse;
      if (body.code !== 'Ok') {
        // NoMatch / NoSegment / TooManyCoordinates / etc.
        if (body.code === 'NoMatch' || body.code === 'NoSegment') {
          return {
            ok: false,
            reason: 'no-match',
            detail: body.message ?? body.code,
            durationMs: Date.now() - t0,
          };
        }
        return {
          ok: false,
          reason: 'invalid-input',
          detail: `${body.code}: ${body.message ?? ''}`.slice(0, 200),
          durationMs: Date.now() - t0,
        };
      }
      const parsed = parseResponse(body);
      if (!parsed) {
        return {
          ok: false,
          reason: 'no-match',
          detail: 'empty matchings',
          durationMs: Date.now() - t0,
        };
      }
      return {
        ok: true,
        matchedPoints: parsed.matchedPoints,
        confidence: parsed.confidence,
        segments: parsed.segments,
        durationMs: Date.now() - t0,
      };
    } catch (e: any) {
      if (e?.message === 'timeout') {
        return { ok: false, reason: 'timeout', durationMs: Date.now() - t0 };
      }
      // v6.3 R3 C3: external AbortSignal cancellation. Distinct from timeout;
      // caller-cancel must remain terminal because the user backed out.
      if (e?.message === 'aborted') {
        return { ok: false, reason: 'invalid-input', detail: 'aborted', durationMs: Date.now() - t0 };
      }
      return {
        ok: false,
        reason: 'network',
        detail: String(e?.message ?? e).slice(0, 200),
        durationMs: Date.now() - t0,
      };
    }
}
