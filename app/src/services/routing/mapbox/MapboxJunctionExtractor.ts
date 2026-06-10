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
   * Allowed `class` values from the road source-layer. By default we use a
   * blacklist (see `excludedClasses`) so all walkable / drivable street
   * classes are included globally. Pass an explicit allowlist here only if
   * you need stricter filtering (e.g. hiking-only mode that excludes urban
   * streets entirely). When set, this allowlist takes precedence over the
   * default blacklist.
   */
  allowedClasses?: string[];
  /**
   * Class values to exclude when no `allowedClasses` allowlist is provided.
   * Default excludes high-speed and non-walkable infrastructure
   * (motorway / motorway_link / trunk / trunk_link / ferry / golf /
   * aerialway / *_rail / construction). Everything else is kept — primary,
   * secondary, tertiary, street, street_limited, service, pedestrian,
   * track, path, footway, cycleway etc. — so junction extraction works
   * globally on any road network type a hiker / runner might walk through.
   */
  excludedClasses?: string[];
  /** Hard cap on raw vertex count before we abort. Default 20000. */
  maxVertexCount?: number;
  /**
   * Yield to the JS scheduler every N vertices during the fingerprint loop.
   * Keeps UI responsive on dense viewports. Default 1000.
   */
  yieldEveryVertices?: number;
}

/**
 * Mapbox `road` source-layer `class` values to exclude by default.
 *
 * Reference: Mapbox Streets v8 / Traffic v1 schema.
 *   https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/
 *
 * We keep:
 *   primary, secondary, tertiary, street, street_limited, service,
 *   pedestrian, track, path, footway, cycleway, link, *_link
 *   (and any future class Mapbox adds — blacklist gives forward-compat).
 *
 * We exclude:
 *   motorway / trunk and their _link ramps    (un-walkable highways)
 *   ferry                                     (water crossings, not walkable)
 *   golf                                      (golf course paths, ambiguous)
 *   aerialway                                 (gondolas, lifts)
 *   major_rail / minor_rail / service_rail    (train tracks)
 *   construction                              (closed off, not walkable)
 *
 * If a future Sprint adds bicycle-only or driving modes, the caller can pass
 * an explicit allowedClasses to override this blacklist.
 */
const DEFAULT_EXCLUDED_CLASSES = [
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'ferry',
  'golf',
  'aerialway',
  'major_rail',
  'minor_rail',
  'service_rail',
  'construction',
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
    // Whitelist mode (caller-provided) vs blacklist mode (default): the
    // default keeps EVERY road class except the explicitly excluded ones,
    // so primary / secondary / tertiary / residential / pedestrian /
    // path / footway / cycleway / track / service / *_link etc. all
    // contribute junctions globally.
    allowedClasses: options?.allowedClasses, // undefined = use blacklist
    excludedClasses: options?.excludedClasses ?? DEFAULT_EXCLUDED_CLASSES,
    // v213 fix: 20000 was too tight after broadening the class blacklist
    // in v211 — a 0.7km city route padded by editContext to ~3km × 3km
    // bbox in dense urban areas (Shanghai, Manhattan, Tokyo) routinely
    // emits 30-80k vertices. Hitting the cap aborts the entire extract
    // and falls back to endpoint-only edit, completely defeating the
    // class-broadening intent. 60000 keeps the safety net but lets dense
    // urban viewports through. UI-responsiveness is preserved by the
    // existing yield-every-1000-vertices loop.
    maxVertexCount: options?.maxVertexCount ?? 60000,
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
      // v215 fix HM5: pass `undefined` instead of `[]` for the filter.
      // Empty-array filter is interpreted by some Mapbox iOS SDK builds
      // as an empty expression that rejects everything; `undefined`
      // routes through the default no-filter path. We do JS-side class
      // filtering below anyway, so the filter argument adds no value.
      const result = await mapInst.querySourceFeatures(
        src,
        undefined,
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

  // Build the class filter once. Two modes:
  //   - allowlist (caller-provided): only classes in the set pass.
  //   - blacklist (default): every class passes EXCEPT those in the
  //     excluded set. Empty class strings always pass — some Mapbox
  //     features have no `class` property at all (rare, but defensive).
  const useAllowlist =
    Array.isArray(opts.allowedClasses) && opts.allowedClasses.length > 0;
  const allowedClassSet = useAllowlist ? new Set(opts.allowedClasses) : null;
  const excludedClassSet = new Set(opts.excludedClasses);

  // Defer the (potentially heavy) processing past the current interaction.
  await awaitNextInteraction();

  // ── Step 1: filter + densify into MapboxWay[] ──────────────────────────
  const ways: MapboxWay[] = [];
  let rawVertexCount = 0;

  for (let fi = 0; fi < fc.features.length; fi++) {
    const f = fc.features[fi];
    if (!f || !f.geometry) continue;
    const klass: string = String(f.properties?.class ?? '');
    if (allowedClassSet) {
      if (!allowedClassSet.has(klass)) continue;
    } else if (excludedClassSet.has(klass)) {
      continue;
    }
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
