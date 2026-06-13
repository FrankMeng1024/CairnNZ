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
 *   - 1 retry on network/5xx (not on 4xx).
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
const MAX_RETRIES = 1;

interface MapboxMatchingResponse {
  code: string;
  matchings?: Array<{
    confidence: number;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    legs?: Array<{ confidence?: number }>;
  }>;
  message?: string;
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
  // v6.3 (plan §1.2): default radius is 25m. Empirically (spike-fresh-v63-summary.md)
  // r ∈ {15, 25, 40} all produce identical match output on the 250-case corpus,
  // so 25 is chosen as a balanced midpoint. r=50 (the legacy default) was looser
  // than needed; r=8 (pre-v252) was too tight and produced spurious NoMatch on
  // long strokes (spike-corridor-100v-results.md, J1-036 800m → only 60m snapped).
  const DEFAULT_RADIUS_M = 25;
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
} | null {
  if (!body.matchings || body.matchings.length === 0) return null;
  const m = body.matchings[0];
  if (!m.geometry || m.geometry.type !== 'LineString') return null;
  const matchedPoints: LngLat[] = m.geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
  return { matchedPoints, confidence: m.confidence ?? 0 };
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
  let lastErr: any = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetchWithTimeout(url, TIMEOUT_MS, options?.signal);
      if (res.status === 429) {
        return { ok: false, reason: 'rate-limit', durationMs: Date.now() - t0 };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, reason: 'auth', detail: `HTTP ${res.status}`, durationMs: Date.now() - t0 };
      }
      if (res.status >= 500) {
        if (attempt < MAX_RETRIES) {
          lastErr = new Error(`HTTP ${res.status}`);
          continue;
        }
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
        durationMs: Date.now() - t0,
      };
    } catch (e: any) {
      lastErr = e;
      if (e?.message === 'timeout') {
        if (attempt < MAX_RETRIES) continue;
        return { ok: false, reason: 'timeout', durationMs: Date.now() - t0 };
      }
      // v6.3 R3 C3: external AbortSignal cancellation. Distinct from timeout
      // (which retries) — caller-cancel must NOT retry: the user backed out.
      if (e?.message === 'aborted') {
        return { ok: false, reason: 'invalid-input', detail: 'aborted', durationMs: Date.now() - t0 };
      }
      if (attempt < MAX_RETRIES) continue;
      return {
        ok: false,
        reason: 'network',
        detail: String(e?.message ?? e).slice(0, 200),
        durationMs: Date.now() - t0,
      };
    }
  }
  return {
    ok: false,
    reason: 'network',
    detail: lastErr ? String(lastErr.message ?? lastErr) : 'unknown',
    durationMs: Date.now() - t0,
  };
}
