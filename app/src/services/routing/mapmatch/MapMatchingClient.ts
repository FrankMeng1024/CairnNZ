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
// v253: profile changed from /walking to /driving. Per PO product
// principle "走过的路才是路", Mapbox snap should ONLY assist when there
// is an obvious public road within the corridor. /walking matches to
// pedestrian footways including hospital interiors, mall passages,
// building paths — invisible to the user, produces "穿楼" artifacts.
// /driving sticks strictly to motor-vehicle roads, so:
//   - city: snaps to streets the user can see and likely meant ✓
//   - park / pedestrian-only: NoMatch → caller falls back to raw GPS
//   - mountain trail: NoMatch → caller falls back to raw GPS
// This implements "200m 内允许微调到熟悉旁路, 不 100% 确认就回归原 GPS".
const ENDPOINT_BASE = 'https://api.mapbox.com/matching/v5/mapbox/driving';
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

function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
      reject(new Error('timeout'));
    }, ms);
    fetch(url, { method: 'GET', signal: controller.signal })
      .then(r => {
        clearTimeout(timer);
        resolve(r);
      })
      .catch(e => {
        clearTimeout(timer);
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
  // null means "use the default" → we send 50m (the upper bound) so
  // Mapbox has the most freedom while still being a valid value.
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
export async function matchSegment(segment: MatchSegment): Promise<MatchResult> {
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
      const res = await fetchWithTimeout(url, TIMEOUT_MS);
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
