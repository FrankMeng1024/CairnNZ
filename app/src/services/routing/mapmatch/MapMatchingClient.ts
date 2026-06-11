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
  // radiuses: per-coord max snap radius. Mapbox accepts numeric or
  // 'unlimited'. Build manually so the literal `;` separators are NOT
  // URL-encoded (URLSearchParams percent-encodes `;`, which Mapbox parses
  // as part of a single token rather than as a delimiter).
  const radiusesStr = segment.radiuses
    .map(r => (r === null ? 'unlimited' : String(r)))
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
