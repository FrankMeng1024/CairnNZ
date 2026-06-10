/**
 * MapboxJunctionExtractor — Extract topological junctions and road ways from
 * the Mapbox vector tiles already loaded by the running MapView.
 *
 * Replaces the NZ-only DOC ArcGIS pipeline as the global default data source
 * for edit-mode node anchors.
 *
 * Strategy (from sprint-mapbox-spec §1.1):
 *   1. mapRef.current.querySourceFeatures('composite', filter, ['road'])
 *      reads the trail/road geometries that Mapbox SDK already cached for
 *      rendering — no network call.
 *   2. Filter to relevant `class` values (path/track/footway/...).
 *   3. Densify each LineString to 10m resolution (matches DOC pipeline).
 *   4. Count vertex coincidences using a 5-decimal lng/lat fingerprint
 *      (~1.1m precision). Vertices appearing in ≥3 different ways are
 *      topological junctions.
 *
 * The output is consumed by `buildTrailGraphFromMapbox` to build a TrailGraph
 * (so downstream Dijkstra reachability and snap-to-graph keep working
 * unchanged). The junction list itself is kept for diagnostics.
 *
 * Sprint Mapbox-Migration §1.1.
 */

import type { RefObject } from 'react';
import { InteractionManager } from 'react-native';
import {
  densify,
  flattenGeometryToParts,
  type LngLat,
} from '../corridor/PolylineSampler';
import type { BBox } from '../doctrails/DOCTrailsTypes';

/** A junction extracted from Mapbox vector tiles. */
export interface MapboxJunction {
  /** Stable fingerprint id — `mj_${lng5}_${lat5}` (~1.1m precision). */
  id: string;
  lng: number;
  lat: number;
  /** Number of unique ways meeting at this point (≥ minDegree). */
  degree: number;
  /** Way feature ids that touch this point. */
  wayFeatureIds: string[];
}

/** A road feature simplified to densified LngLat[] + class + id. */
export interface MapboxWay {
  /** Stable id — `mw_${properties.id ?? hash(coords)}`. */
  id: string;
  /** highway class — 'path' | 'footway' | 'track' | etc. */
  klass: string;
  /** Densified vertices in WGS-84 lng/lat. */
  coords: LngLat[];
}

export interface ExtractDiagnostics {
  rawFeatureCount: number;
  rawVertexCount: number;
  extractMs: number;
  bboxArea: number;
}

export interface ExtractResult {
  ok: true;
  junctions: MapboxJunction[];
  ways: MapboxWay[];
  diagnostics: ExtractDiagnostics;
}

export interface ExtractError {
  ok: false;
  error:
    | 'no-map-ref'
    | 'map-not-ready'
    | 'zoom-too-low'
    | 'no-features'
    | 'query-failed'
    | 'vertex-cap-exceeded';
  detail?: string;
  diagnostics?: Partial<ExtractDiagnostics>;
}

export interface ExtractOptions {
  /** Minimum unique-way count for a vertex to count as a junction. Default 3. */
  minDegree?: number;
  /** Coordinate fingerprint precision (decimal places). Default 5 (~1.1m). */
  fingerprintPrecision?: number;
  /** Densify interval (m). Default 10. */
  densifyIntervalM?: number;
  /** Map zoom floor. Default 14. Below this, vector tiles are too simplified. */
  minZoom?: number;
  /** Source-layer to query. Default 'road'. */
  sourceLayer?: string;
  /** Source name in the Mapbox style. Default 'composite'. */
  sourceName?: string;
  /**
   * Allowed `class` values from the road source-layer. Default keeps the
   * trail-relevant ones plus minor city streets (parks/towns where path tags
   * are inconsistent). Excludes motorway/trunk/etc to control vertex count.
   */
  allowedClasses?: string[];
  /** Hard cap on raw vertex count before we abort. Default 20000. */
  maxVertexCount?: number;
  /**
   * Yield to the JS scheduler every N vertices during the fingerprint loop.
   * Keeps UI responsive on dense viewports. Default 1000.
   */
  yieldEveryVertices?: number;
}

const DEFAULT_ALLOWED_CLASSES = [
  'path',
  'track',
  'footway',
  'pedestrian',
  'cycleway',
  'street',
  'service',
  'tertiary',
];

/** Round a number to `precision` decimal places. */
function roundTo(n: number, precision: number): number {
  const f = Math.pow(10, precision);
  return Math.round(n * f) / f;
}

/**
 * Compute the lng-degree × lat-degree area of the route bbox. Useful as a
 * diagnostic — large bbox = potential vertex blow-up.
 */
function bboxAreaDeg(b: BBox): number {
  return Math.max(0, b.east - b.west) * Math.max(0, b.north - b.south);
}

/**
 * Wait for the next post-interaction frame. Defers heavy work past current
 * gesture/touch dispatch so UI doesn't drop frames.
 */
function awaitNextInteraction(): Promise<void> {
  return new Promise(resolve => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
}

/** setTimeout-based scheduler yield. */
function yieldToScheduler(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Extract junctions + ways from the currently-loaded Mapbox vector tiles.
 *
 * Caller is responsible for:
 *   - Holding a non-null mapRef pointing at a mounted MapView.
 *   - Camera fitted to the route bbox at zoom ≥ minZoom.
 *   - Tiles already loaded (await `onDidFinishRenderingMapFully` or a manual
 *     ~600ms settle).
 *
 * Failures are non-fatal — caller decides whether to fall back to
 * endpoint-only edit mode. See ExtractError.error variants.
 */
export async function extractJunctions(
  mapRef: RefObject<any> | { current: any } | null,
  routeBbox: BBox,
  options?: ExtractOptions,
): Promise<ExtractResult | ExtractError> {
  const opts = {
    minDegree: options?.minDegree ?? 3,
    fingerprintPrecision: options?.fingerprintPrecision ?? 5,
    densifyIntervalM: options?.densifyIntervalM ?? 10,
    minZoom: options?.minZoom ?? 14,
    sourceLayer: options?.sourceLayer ?? 'road',
    sourceName: options?.sourceName ?? 'composite',
    allowedClasses: options?.allowedClasses ?? DEFAULT_ALLOWED_CLASSES,
    maxVertexCount: options?.maxVertexCount ?? 20000,
    yieldEveryVertices: options?.yieldEveryVertices ?? 1000,
  };

  if (!mapRef || !mapRef.current) {
    return { ok: false, error: 'no-map-ref' };
  }
  const mapInst: any = mapRef.current;

  // Optional zoom check — not all MapView refs expose getZoom() synchronously.
  // If the API is missing, we trust the caller to have set zoom correctly.
  if (typeof mapInst.getZoom === 'function') {
    try {
      const z: number = await mapInst.getZoom();
      if (typeof z === 'number' && z < opts.minZoom) {
        return {
          ok: false,
          error: 'zoom-too-low',
          detail: `zoom ${z.toFixed(1)} < ${opts.minZoom}`,
        };
      }
    } catch {
      // best-effort; proceed
    }
  }

  const t0 = Date.now();
  // v208 fix C3: Android Mapbox SDK variants don't always expose road
  // features under the 'composite' source — some bundle them under
  // 'mapbox-streets' or 'streets' instead. Try the configured source
  // first, then fall back. We treat both throw-from-querySourceFeatures
  // and zero-features-returned as "this source doesn't have it"
  // signals and continue down the chain. If every candidate fails or
  // returns empty, surface the most informative error (the original
  // throw if any, otherwise no-features).
  const sourceCandidates = [
    opts.sourceName,
    'mapbox-streets',
    'streets',
  ].filter((s, i, arr) => s && arr.indexOf(s) === i); // dedupe + truthy

  let fc: any = null;
  let lastQueryError: string | null = null;
  let usedSourceName: string = opts.sourceName;
  for (const src of sourceCandidates) {
    try {
      const result = await mapInst.querySourceFeatures(
        src,
        [], // no native filter — we filter `class` in JS for full control
        [opts.sourceLayer],
      );
      if (result && Array.isArray(result.features) && result.features.length > 0) {
        fc = result;
        usedSourceName = src;
        break;
      }
      // empty result — try next candidate
    } catch (e: any) {
      lastQueryError = e?.message ?? String(e);
      // try next candidate
    }
  }

  if (!fc) {
    if (lastQueryError) {
      return {
        ok: false,
        error: 'query-failed',
        detail: `${lastQueryError} (tried sources: ${sourceCandidates.join(', ')})`,
      };
    }
    return {
      ok: false,
      error: 'no-features',
      detail: `no features in any source candidate: ${sourceCandidates.join(', ')}`,
      diagnostics: {
        rawFeatureCount: 0,
        rawVertexCount: 0,
        extractMs: Date.now() - t0,
        bboxArea: bboxAreaDeg(routeBbox),
      },
    };
  }
  // Quiet hint for diagnostics — no behaviour change.
  void usedSourceName;

  const allowedClassSet = new Set(opts.allowedClasses);

  // Defer the (potentially heavy) processing past the current interaction.
  await awaitNextInteraction();

  // ── Step 1: filter + densify into MapboxWay[] ──────────────────────────
  const ways: MapboxWay[] = [];
  let rawVertexCount = 0;

  for (let fi = 0; fi < fc.features.length; fi++) {
    const f = fc.features[fi];
    if (!f || !f.geometry) continue;
    const klass: string = String(f.properties?.class ?? '');
    if (!allowedClassSet.has(klass)) continue;
    if (
      f.geometry.type !== 'LineString' &&
      f.geometry.type !== 'MultiLineString'
    ) {
      continue;
    }

    const parts = flattenGeometryToParts(f.geometry);
    if (!parts.length) continue;

    // Stable id: prefer feature.id; fall back to a small hash on first/last coord.
    const baseId =
      f.id != null
        ? `mw_${String(f.id)}`
        : `mw_${fi}_${tinyHash(parts[0]?.[0])}`;

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      if (part.length < 2) continue;
      const dense = densify(part, opts.densifyIntervalM);
      if (dense.length < 2) continue;
      ways.push({
        id: parts.length > 1 ? `${baseId}_p${pi}` : baseId,
        klass,
        coords: dense,
      });
      rawVertexCount += dense.length;
      if (rawVertexCount > opts.maxVertexCount) {
        return {
          ok: false,
          error: 'vertex-cap-exceeded',
          detail: `rawVertexCount > ${opts.maxVertexCount}`,
          diagnostics: {
            rawFeatureCount: fc.features.length,
            rawVertexCount,
            extractMs: Date.now() - t0,
            bboxArea: bboxAreaDeg(routeBbox),
          },
        };
      }
    }
  }

  if (ways.length === 0) {
    return {
      ok: false,
      error: 'no-features',
      detail: 'no allowed-class line features',
      diagnostics: {
        rawFeatureCount: fc.features.length,
        rawVertexCount: 0,
        extractMs: Date.now() - t0,
        bboxArea: bboxAreaDeg(routeBbox),
      },
    };
  }

  // ── Step 2: vertex fingerprint counter ─────────────────────────────────
  // Map<fp, { lng, lat, ways: Set<wayId> }>
  const fpMap: Map<
    string,
    { lng: number; lat: number; ways: Set<string> }
  > = new Map();

  let processed = 0;
  for (const w of ways) {
    for (const c of w.coords) {
      const lng5 = roundTo(c.lng, opts.fingerprintPrecision);
      const lat5 = roundTo(c.lat, opts.fingerprintPrecision);
      const fp = `${lng5}_${lat5}`;
      let entry = fpMap.get(fp);
      if (!entry) {
        entry = { lng: lng5, lat: lat5, ways: new Set() };
        fpMap.set(fp, entry);
      }
      entry.ways.add(w.id);
      processed++;
      if (processed % opts.yieldEveryVertices === 0) {
        // Yield to scheduler every N vertices on dense viewports.
        // eslint-disable-next-line no-await-in-loop
        await yieldToScheduler();
      }
    }
  }

  // ── Step 3: build junction list ────────────────────────────────────────
  const junctions: MapboxJunction[] = [];
  for (const [fp, entry] of fpMap.entries()) {
    if (entry.ways.size >= opts.minDegree) {
      junctions.push({
        id: `mj_${fp}`,
        lng: entry.lng,
        lat: entry.lat,
        degree: entry.ways.size,
        wayFeatureIds: Array.from(entry.ways),
      });
    }
  }

  return {
    ok: true,
    junctions,
    ways,
    diagnostics: {
      rawFeatureCount: fc.features.length,
      rawVertexCount,
      extractMs: Date.now() - t0,
      bboxArea: bboxAreaDeg(routeBbox),
    },
  };
}

/**
 * Tiny non-cryptographic hash for synthesising a stable id from a coord pair.
 * Purpose: differentiate ways without an `id` property in the same query.
 */
function tinyHash(p?: LngLat | number): string {
  if (typeof p === 'number' || p == null) return String(p ?? 'na');
  return `${p.lng?.toFixed(5) ?? 'na'}_${p.lat?.toFixed(5) ?? 'na'}`;
}
