/**
 * DualSourceRouter — Decide between DOC and Mapbox for routing A → B.
 *
 * "Brain" of the edit reroute pipeline.
 *
 * Decision tree (Plan v3.1 §20):
 *   - DOC success + Mapbox fail → DOC (confident)
 *   - Mapbox success + DOC fail → Mapbox (confident)
 *   - Both succeed, similar (≤50m diff) → DOC (confident)
 *   - Both succeed, different (>50m) → DOC (无感知, NZ official)
 *   - Both fail + corridor has originalPoints → originalPoints subset (approximate)
 *   - Both fail + no originalPoints → straight line + modal confirm
 *   - Out-of-corridor drag → reject (handled by caller)
 *
 * Includes RouteClassifier inlined (review v3 angle 1: merged to reduce indirection).
 *
 * Sprint 66 Wave 4.
 */

import type { LngLat } from './corridor/PolylineSampler';
import { haversineMeters, polylineLengthM } from './corridor/PolylineSampler';
import type { TrailGraph } from './graph/TrailGraph';
import type { PointCloudIndex } from './corridor/PointCloudIndex';
import { getFlagsSync } from '../../config/featureFlags';
import {
  logRerouteRequested,
  logRerouteFailed,
  logDualSourceDecision,
} from './editAnalytics';

// ── RouteClassifier (inlined per review C2 in Phase 4) ──────────────────

export type PointClass = 'trail' | 'road' | 'unknown';

const TRAIL_SNAP_THRESHOLD_M = 30;
const TRAIL_NEAR_THRESHOLD_M = 100;

/**
 * Classify a point as 'trail' (DOC graph hit ≤30m), 'road' (likely city / OSM road),
 * or 'unknown' (probably free / off-map).
 *
 * 'road' detection is implicit — Mapbox snap drift will be small if A is on
 * a road. We don't probe a separate road API; let DualSourceRouter try both.
 */
export function classifyPoint(
  lng: number,
  lat: number,
  graph: TrailGraph | null,
): PointClass {
  if (!graph) return 'unknown';
  const snap = graph.snapToGraph(lng, lat);
  if (!snap) return 'unknown';
  if (snap.distance <= TRAIL_SNAP_THRESHOLD_M) return 'trail';
  if (snap.distance <= TRAIL_NEAR_THRESHOLD_M) return 'trail';
  return 'unknown';
}

// ── Mapbox Directions API client ────────────────────────────────────────

const MAPBOX_DIRECTIONS_BASE =
  'https://api.mapbox.com/directions/v5/mapbox/walking';
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '';
// v7-audit (ARCH-009): the rerouteTimeoutMs / rerouteMaxDetourRatio
// flags were defined but never read. Wire them via getFlagsSync()
// inside the relevant call sites so dev-menu / remote-config overrides
// take effect without a code change.
const MAPBOX_TIMEOUT_FALLBACK_MS = 8000;

interface MapboxDirectionsResult {
  ok: boolean;
  geometry?: LngLat[];
  distanceM?: number;
  snapDriftM?: number;
  error?: string;
}

async function mapboxDirections(
  from: LngLat,
  to: LngLat,
  signal?: AbortSignal,
): Promise<MapboxDirectionsResult> {
  if (!MAPBOX_TOKEN) return { ok: false, error: 'no-token' };
  // v3-audit (ARCH-009): if caller's signal is already aborted, return
  // 'aborted' immediately instead of letting fetch() throw AbortError
  // and getting reported as 'timeout' (misleading telemetry).
  if (signal?.aborted) return { ok: false, error: 'aborted' };

  const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
  const params = new URLSearchParams({
    geometries: 'geojson',
    overview: 'full',
    access_token: MAPBOX_TOKEN,
  });

  const ctrl = new AbortController();
  // v7-audit (ARCH-009) + v8-audit (V7-BUG-004): use the flag value
  // with explicit positive-finite validation. Type allows any number
  // including 0/Infinity/NaN — corrupted remote config could deploy
  // a 0 timeout (no time at all). Validate.
  const flagTimeout = getFlagsSync().rerouteTimeoutMs;
  const timeoutMs =
    Number.isFinite(flagTimeout) && flagTimeout > 0 ? flagTimeout : MAPBOX_TIMEOUT_FALLBACK_MS;
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  // v2-audit (ARCH-011): capture the listener so we can removeEventListener
  // on settle, otherwise long-lived parent signals accumulate one closure
  // per request (memory leak proportional to reroute count).
  const onParentAbort = () => ctrl.abort();
  if (signal) signal.addEventListener('abort', onParentAbort);

  try {
    const res = await fetch(`${MAPBOX_DIRECTIONS_BASE}/${coords}?${params}`, {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onParentAbort);
    if (!res.ok) return { ok: false, error: `http-${res.status}` };
    const data = await res.json();
    if (!data?.routes?.length) return { ok: false, error: 'NoRoute' };
    const route = data.routes[0];
    const coordsArr: number[][] = route?.geometry?.coordinates ?? [];
    if (coordsArr.length < 2) return { ok: false, error: 'malformed' };
    const geometry: LngLat[] = coordsArr.map(([lng, lat]) => ({ lng, lat }));
    // snap drift: distance from requested `from` to first geometry point
    const snapDriftM = haversineMeters(from, geometry[0]);
    return { ok: true, geometry, distanceM: route.distance, snapDriftM };
  } catch (err: any) {
    clearTimeout(t);
    if (signal) signal.removeEventListener('abort', onParentAbort);
    if (err?.name === 'AbortError') return { ok: false, error: 'timeout' };
    return { ok: false, error: err?.message ?? 'network-error' };
  }
}

// ── DualSourceRouter ────────────────────────────────────────────────────

export type RouteSource = 'doc' | 'mapbox' | 'original' | 'straight' | 'mixed';
export type Confidence = 'confident' | 'approximate';

export interface RouteResponse {
  geometry: LngLat[];
  source: RouteSource;
  confidence: Confidence;
  distanceM: number;
  warning?: string;
}

export interface RouteRequest {
  from: LngLat;
  to: LngLat;
  /** Pre-built TrailGraph for current corridor (or null if no DOC data). */
  trailGraph: TrailGraph | null;
  /** Pre-built PointCloudIndex of "走过的点" (originalPoints + activity history). */
  walkedIndex: PointCloudIndex | null;
  /** Mapbox max acceptable snap drift (m). Beyond this → not trustworthy. */
  maxMapboxSnapDriftM?: number;
  /** Mapbox max acceptable detour ratio (returned/straight). Beyond → reject. */
  maxDetourRatio?: number;
}

const DEFAULT_MAX_SNAP_DRIFT = 100;
const DEFAULT_MAX_DETOUR_RATIO = 3.0;
const SIMILARITY_THRESHOLD_M = 50;

/**
 * Try DOC + Mapbox in parallel, pick best, fallback to originalPoints/straight.
 *
 * Caller is responsible for corridor membership check (CorridorQuery).
 */
export async function routeBetween(req: RouteRequest): Promise<RouteResponse> {
  // v7-audit (ARCH-009): honor flags.dualSourceMode + enableDOCSource +
  // enableMapboxSource + rerouteMaxDetourRatio. Caller-supplied
  // maxDetourRatio overrides flag value (test/explicit), otherwise
  // flag wins, falling back to constant.
  const flags = getFlagsSync();
  const docEnabled = flags.enableDOCSource && flags.dualSourceMode !== 'mapbox-only';
  const mapboxEnabled = flags.enableMapboxSource && flags.dualSourceMode !== 'doc-only';
  const maxDrift = req.maxMapboxSnapDriftM ?? DEFAULT_MAX_SNAP_DRIFT;
  // v8-audit (V7-BUG-004) + v9-audit (BUG-V8-012): validate flag value
  // AND caller-supplied req.maxDetourRatio for finite + positive.
  // Bare `??` would let NaN/0/Infinity through.
  const reqDetour = req.maxDetourRatio;
  const reqDetourValid = typeof reqDetour === 'number' && Number.isFinite(reqDetour) && reqDetour > 0;
  const flagDetour = flags.rerouteMaxDetourRatio;
  const flagDetourValid = Number.isFinite(flagDetour) && flagDetour > 0;
  const maxDetour = reqDetourValid
    ? reqDetour
    : (flagDetourValid ? flagDetour : DEFAULT_MAX_DETOUR_RATIO);
  const straightDistM = haversineMeters(req.from, req.to);

  logRerouteRequested({ source: 'dual', distanceM: straightDistM });
  const tStart = Date.now();

  // Run both providers concurrently — but only if their flag is enabled.
  // v7-audit (ARCH-009): dualSourceMode='doc-only' / 'mapbox-only' /
  // enable*Source flags now actually gate the calls.
  const [docResult, mapboxResult] = await Promise.all([
    docEnabled ? tryDOC(req) : Promise.resolve(null),
    mapboxEnabled
      ? mapboxDirections(req.from, req.to)
      : Promise.resolve({ ok: false, error: 'disabled' } as MapboxDirectionsResult),
  ]);

  // Quality gates on Mapbox
  let mapboxAcceptable = mapboxResult.ok;
  if (mapboxAcceptable && mapboxResult.snapDriftM !== undefined && mapboxResult.snapDriftM > maxDrift) {
    mapboxAcceptable = false;
  }
  if (mapboxAcceptable && mapboxResult.distanceM !== undefined && straightDistM > 0) {
    const ratio = mapboxResult.distanceM / straightDistM;
    if (ratio > maxDetour) mapboxAcceptable = false;
  }

  const decide = (chosen: string, reason: string, confidence: string) => {
    logDualSourceDecision({ chosen, reason, confidence });
  };

  // v8-audit (V7-BUG-004): respect debug semantics — when dualSourceMode
  // is doc-only or mapbox-only and the requested provider failed, do
  // NOT fall back to original/straight. The user explicitly chose a
  // single-source debug mode; falling back would mask the real
  // failure.
  const isDebugSingleSource =
    flags.dualSourceMode === 'doc-only' || flags.dualSourceMode === 'mapbox-only';

  // Decision tree
  if (docResult && mapboxAcceptable) {
    decide('doc', 'both-ok-prefer-doc', 'confident');
    // v6-audit (FUNC-002): truncated graph emits a warning but does NOT
    // downgrade confidence. shortestPath already refuses paths that
    // traverse the truncated bucket (TrailGraph.shortestPath checks
    // `ids.includes('tnTRUNC')`), so any docResult here is verified
    // bucket-free. Old behavior universally demoted to 'approximate'
    // even for paths in the well-junctioned region of a truncated
    // graph — over-conservative and confusing to users.
    const truncatedWarning = req.trailGraph?.truncated
      ? 'Trail data was truncated for performance in this area.'
      : undefined;
    return {
      geometry: docResult,
      source: 'doc',
      confidence: 'confident',
      distanceM: polylineLengthM(docResult),
      warning: truncatedWarning,
    };
  }
  if (docResult) {
    decide('doc', 'doc-only', 'confident');
    const truncatedWarning = req.trailGraph?.truncated
      ? 'Trail data was truncated for performance in this area.'
      : undefined;
    return {
      geometry: docResult,
      source: 'doc',
      confidence: 'confident',
      distanceM: polylineLengthM(docResult),
      warning: truncatedWarning,
    };
  }
  if (mapboxAcceptable && mapboxResult.geometry) {
    decide('mapbox', 'mapbox-only', 'confident');
    return {
      geometry: mapboxResult.geometry,
      source: 'mapbox',
      confidence: 'confident',
      distanceM: mapboxResult.distanceM ?? polylineLengthM(mapboxResult.geometry),
    };
  }

  // At this point both providers failed. Log the reasons for ops visibility.
  // v8-audit (ARCH-REVIEW-V7-008): skip telemetry for sources disabled
  // by flag — they're not failures, they're explicit user/ops choices.
  if (!docResult && docEnabled) {
    logRerouteFailed({ source: 'doc', errorCode: 'no-graph-or-snap-fail', durationMs: Date.now() - tStart });
  }
  if (!mapboxResult.ok && mapboxEnabled) {
    logRerouteFailed({
      source: 'mapbox',
      errorCode: mapboxResult.error ?? 'unknown',
      durationMs: Date.now() - tStart,
    });
  }

  // v8-audit (V7-BUG-004): in single-source debug mode, refuse to
  // fall through to walked-original / straight — those would mask
  // the real failure of the user's chosen provider.
  if (isDebugSingleSource) {
    decide('straight', 'debug-single-source-failed', 'approximate');
    return {
      geometry: [req.from, req.to],
      source: 'straight',
      confidence: 'approximate',
      distanceM: straightDistM,
      warning: `Debug mode: ${flags.dualSourceMode} requested but no result.`,
    };
  }

  // Both failed → try originalPoints subset
  if (req.walkedIndex && req.walkedIndex.size() > 0) {
    const originalSubset = sampleAlongOriginal(req.from, req.to, req.walkedIndex);
    if (originalSubset.length >= 2) {
      decide('original', 'both-failed-walked-fallback', 'approximate');
      return {
        geometry: originalSubset,
        source: 'original',
        confidence: 'approximate',
        distanceM: polylineLengthM(originalSubset),
        warning: 'Using approximate path from your original walk',
      };
    }
  }

  // Last resort: straight line + warning (caller should show modal)
  decide('straight', 'no-walked-no-source', 'approximate');
  return {
    geometry: [req.from, req.to],
    source: 'straight',
    confidence: 'approximate',
    distanceM: straightDistM,
    warning: 'No trail data here. Showing direct path.',
  };
}

async function tryDOC(req: RouteRequest): Promise<LngLat[] | null> {
  if (!req.trailGraph || req.trailGraph.size() === 0) return null;
  const fromSnap = req.trailGraph.snapToGraph(req.from.lng, req.from.lat);
  const toSnap = req.trailGraph.snapToGraph(req.to.lng, req.to.lat);
  if (!fromSnap || !toSnap) return null;
  // Snap quality gates: both endpoints should be within 100m of trail graph
  if (fromSnap.distance > 100 || toSnap.distance > 100) return null;
  // v3-audit (FUNC-008): when from and to snap to the SAME node (e.g.
  // a tiny intra-node move on a known trail), shortestPath returns a
  // 1-point path. Old code rejected it → user got a straight-fallback
  // modal for a clearly on-trail micro-edit. Treat it as a valid 2-point
  // segment letting the orchestrator stitch a confident geometry.
  // v7-audit (ARCH-002): use the SNAP NODE's coordinates instead of
  // the raw req.from/req.to.
  // v8-audit (V7-BUG-005): if the user's actual from→to distance is
  // larger than the JUNCTION_THRESHOLD (~30m), the same-node snap is
  // suspicious (the user's drag spans terrain the graph treats as one
  // point). Refuse to claim DOC for that case — let Mapbox/walked
  // fallback handle it honestly.
  if (fromSnap.nodeId === toSnap.nodeId) {
    const directDistM = haversineMeters(req.from, req.to);
    if (directDistM > 30) {
      return null; // not a confident DOC route at this scale
    }
    const m = req.trailGraph.meta.get(fromSnap.nodeId);
    if (m) {
      return [{ lng: m.lng, lat: m.lat }, { lng: m.lng, lat: m.lat }];
    }
    return [req.from, req.to];
  }
  const path = req.trailGraph.shortestPath(fromSnap.nodeId, toSnap.nodeId);
  if (!path || path.length < 2) return null;
  return path;
}

/**
 * Sample points from the walked index that lie roughly along the line A→B.
 * (For "original" fallback when both DOC + Mapbox fail.)
 *
 * Simple approach: take all walked points within a thin corridor (50m) of
 * the A→B line, sorted by progress along the line.
 */
function sampleAlongOriginal(
  from: LngLat,
  to: LngLat,
  index: PointCloudIndex,
): LngLat[] {
  const lineLen = haversineMeters(from, to);
  if (lineLen < 1) return [from, to];

  // Use bbox of A→B + 100m buffer
  const minLng = Math.min(from.lng, to.lng);
  const maxLng = Math.max(from.lng, to.lng);
  const minLat = Math.min(from.lat, to.lat);
  const maxLat = Math.max(from.lat, to.lat);
  const midLng = (minLng + maxLng) / 2;
  const midLat = (minLat + maxLat) / 2;
  const radiusM = lineLen / 2 + 100;

  const candidates = index.within(midLng, midLat, radiusM);
  const points: Array<{ p: LngLat; t: number }> = [];
  for (const i of candidates) {
    const pt = index.get(i);
    if (!pt) continue;
    const p: LngLat = { lng: pt.lng, lat: pt.lat };
    // Project onto line to get parameter t in [0,1]
    const t = projectOntoLine(from, to, p);
    if (t < 0 || t > 1) continue;
    // Distance from line ≤ 50m
    const projected = lerp(from, to, t);
    if (haversineMeters(p, projected) > 50) continue;
    points.push({ p, t });
  }
  points.sort((a, b) => a.t - b.t);
  // Always include endpoints
  return [from, ...points.map(x => x.p), to];
}

function projectOntoLine(a: LngLat, b: LngLat, p: LngLat): number {
  // v2-audit (FUNC-005): scale lng deltas by cos(meanLat) so projection
  // works in approximate meter space, not raw degree space. Without this,
  // at NZ latitudes (lat=-44, cos≈0.72) lng degrees are weighted equal
  // to lat degrees in the dot product — t skews and points beside the
  // line near endpoints can be wrongly accepted/rejected by the t∈[0,1]
  // gate. Same correction trick metersToDegrees uses elsewhere.
  const meanLat = (a.lat + b.lat) / 2;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const ABx = (b.lng - a.lng) * cosLat;
  const ABy = b.lat - a.lat;
  const APx = (p.lng - a.lng) * cosLat;
  const APy = p.lat - a.lat;
  const denom = ABx * ABx + ABy * ABy;
  if (denom < 1e-12) return 0;
  return (APx * ABx + APy * ABy) / denom;
}

function lerp(a: LngLat, b: LngLat, t: number): LngLat {
  return { lng: a.lng + (b.lng - a.lng) * t, lat: a.lat + (b.lat - a.lat) * t };
}
