/**
 * BrushStrokeLayer — render every brush stroke on the Mapbox map with
 * per-segment color (sage / amber / red) based on distance to the
 * original GPS trace.
 *
 * Sprint 67 v245.
 *
 * Rendering approach (Option A from plan review):
 *   For each stroke, walk adjacent point pairs. For each segment compute
 *   max(distToOriginal of A, distToOriginal of B) and classify:
 *     - max < 400m → 'sage'
 *     - 400 ≤ max < 500m → 'amber'
 *     - max ≥ 500m → 'red'
 *   Group all segments across all strokes into 3 FeatureCollections,
 *   render each as its own LineLayer with the matching color.
 *
 * Endpoint markers:
 *   For each stroke, render small dots at start and end. Sage if endpoint
 *   is within 50m of originalPoints; red ring if not (live "this stroke
 *   is invalid" feedback).
 */

import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import type { BrushStroke } from '../../store/useRouteEditStore';
import { Colors } from '../tokens';

let ShapeSource: any = null;
let LineLayer: any = null;
let CircleLayer: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    ShapeSource = Mapbox.ShapeSource;
    LineLayer = Mapbox.LineLayer;
    CircleLayer = Mapbox.CircleLayer;
  } catch {
    // Mapbox not available
  }
}

interface Props {
  strokes: BrushStroke[];
  /** Function to compute distance-to-original for a coord (closure of walkedIndex). */
  distanceFromOriginalM: (coord: LngLat) => number;
  /** Threshold for endpoint validity (default 50m). */
  endpointSnapM?: number;
  /** Threshold for "amber" warning (default 400m). */
  warnRadiusM?: number;
  /** Threshold for "red" out-of-range (default 500m). */
  corridorRadiusM?: number;
  /**
   * v247: when true, hide the brush stroke render via opacity rather than
   * unmount. Keeps Mapbox ShapeSource alive so the next show doesn't
   * trigger a full remount + re-paint flicker.
   */
  hidden?: boolean;
}

type Severity = 'sage' | 'amber' | 'red';

function classify(
  maxDist: number,
  warnRadiusM: number,
  corridorRadiusM: number,
): Severity {
  if (maxDist >= corridorRadiusM) return 'red';
  if (maxDist >= warnRadiusM) return 'amber';
  return 'sage';
}

interface Built {
  sage: any;
  amber: any;
  red: any;
  endpoints: any;
}

interface OneStrokeBuilt {
  sageFeatures: any[];
  amberFeatures: any[];
  redFeatures: any[];
  endpointFeatures: any[];
}

/**
 * v251: incremental per-stroke builder. The PRIMARY cause of "longer
 * stroke = laggier draw" in v249/v250 was that the cache key
 * `${id}:${pointCount}` made the active stroke ALWAYS miss cache —
 * every appendStrokePoint frame walked all N points + 2N kdbush
 * lookups. Cumulative cost: O(N²) over a 60s stroke.
 *
 * Fix: cache by stroke id only. Per stroke we keep the in-progress
 * feature accumulators + the last-built point count + the trailing
 * "open" run state (where a severity-coloured polyline is still
 * accepting more points). On each frame we:
 *   - reuse the cached features (sage / amber / red lists)
 *   - process ONLY new segments [lastBuilt-1 .. N-1]
 *   - extend the trailing run, or close it and open a new one when
 *     severity flips
 *   - rewrite the endpoint markers (only 2 points; cheap)
 *
 * Per-frame cost is O(new_points_this_frame), which is 0-1 segment
 * ~12Hz → essentially constant.
 */
interface IncrementalStrokeBuilder {
  lastBuiltPointCount: number;
  sageFeatures: any[];
  amberFeatures: any[];
  redFeatures: any[];
  endpointFeatures: any[];
  /** index in s.points where the trailing-open severity run started */
  runStart: number;
  /** severity of the trailing-open run */
  runSeverity: Severity;
  /** has runStart/runSeverity been initialised? false until first segment */
  runComputed: boolean;
  /** the trailing run's feature object — we mutate its coordinates as
   *  more points arrive, so we never need to rebuild it. */
  runFeature: any | null;
}

const strokeBuildCache = new Map<string, IncrementalStrokeBuilder>();

function newBuilder(): IncrementalStrokeBuilder {
  return {
    lastBuiltPointCount: 0,
    sageFeatures: [],
    amberFeatures: [],
    redFeatures: [],
    endpointFeatures: [],
    runStart: 0,
    runSeverity: 'sage',
    runComputed: false,
    runFeature: null,
  };
}

function pushFeatureToBucket(
  builder: IncrementalStrokeBuilder,
  severity: Severity,
  feature: any,
): void {
  if (severity === 'sage') builder.sageFeatures.push(feature);
  else if (severity === 'amber') builder.amberFeatures.push(feature);
  else builder.redFeatures.push(feature);
}

/**
 * Build endpoint marker features (2 features at most). Cheap; rewritten
 * each render. Returns a fresh array.
 */
function buildEndpointFeatures(
  s: BrushStroke,
  distFn: (c: LngLat) => number,
  endpointSnapM: number,
): any[] {
  const out: any[] = [];
  if (s.points.length < 1) return out;
  if (s.points.length < 2) {
    const p = s.points[0];
    const valid = distFn(p) <= endpointSnapM;
    out.push({
      type: 'Feature',
      properties: { valid: valid ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    });
    return out;
  }
  const start = s.points[0];
  const end = s.points[s.points.length - 1];
  out.push({
    type: 'Feature',
    properties: { valid: distFn(start) <= endpointSnapM ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [start.lng, start.lat] },
  });
  out.push({
    type: 'Feature',
    properties: { valid: distFn(end) <= endpointSnapM ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [end.lng, end.lat] },
  });
  return out;
}

/**
 * Incrementally bring a stroke's builder up to date. Mutates `builder`.
 * Walks only segments [builder.lastBuiltPointCount-1 .. s.points.length-1].
 * Returns the same builder for convenience.
 */
function buildStrokeIncremental(
  s: BrushStroke,
  builder: IncrementalStrokeBuilder,
  distFn: (c: LngLat) => number,
  warnRadiusM: number,
  corridorRadiusM: number,
  endpointSnapM: number,
): IncrementalStrokeBuilder {
  const N = s.points.length;
  // Endpoint markers — always rebuilt (2 features, cheap)
  builder.endpointFeatures = buildEndpointFeatures(s, distFn, endpointSnapM);

  if (N < 2) {
    builder.lastBuiltPointCount = N;
    return builder;
  }

  // Process segments [startSeg .. N-1] where startSeg is the index of
  // the first point of the first un-processed segment.
  // Already processed segments end at point index `lastBuiltPointCount - 1`.
  // First unprocessed segment is [lastBuiltPointCount-1, lastBuiltPointCount].
  let startSeg = Math.max(1, builder.lastBuiltPointCount);

  for (let i = startSeg; i < N; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const da = distFn(a);
    const db = distFn(b);
    const sev = classify(Math.max(da, db), warnRadiusM, corridorRadiusM);

    if (!builder.runComputed) {
      // Open the very first run.
      builder.runComputed = true;
      builder.runSeverity = sev;
      builder.runStart = i - 1;
      builder.runFeature = {
        type: 'Feature',
        properties: { strokeId: s.id },
        geometry: {
          type: 'LineString',
          coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
        },
      };
      pushFeatureToBucket(builder, sev, builder.runFeature);
    } else if (sev === builder.runSeverity) {
      // Same severity → just append b's coord to the open run's geometry.
      builder.runFeature.geometry.coordinates.push([b.lng, b.lat]);
    } else {
      // Severity flip → close the prior run; open a new one starting at
      // a (which is the shared vertex).
      builder.runStart = i - 1;
      builder.runSeverity = sev;
      builder.runFeature = {
        type: 'Feature',
        properties: { strokeId: s.id },
        geometry: {
          type: 'LineString',
          coordinates: [[a.lng, a.lat], [b.lng, b.lat]],
        },
      };
      pushFeatureToBucket(builder, sev, builder.runFeature);
    }
  }
  builder.lastBuiltPointCount = N;
  return builder;
}

function buildFeatures(
  strokes: BrushStroke[],
  distFn: (c: LngLat) => number,
  warnRadiusM: number,
  corridorRadiusM: number,
  endpointSnapM: number,
): Built {
  const sage: any[] = [];
  const amber: any[] = [];
  const red: any[] = [];
  const endpoints: any[] = [];

  const liveKeys = new Set<string>();
  for (const s of strokes) {
    liveKeys.add(s.id);
    let builder = strokeBuildCache.get(s.id);
    if (!builder || builder.lastBuiltPointCount > s.points.length) {
      // Cache miss OR stroke shrank (erase-split / undo): rebuild fresh.
      builder = newBuilder();
      strokeBuildCache.set(s.id, builder);
    }
    if (builder.lastBuiltPointCount < s.points.length || s.points.length < 2) {
      buildStrokeIncremental(s, builder, distFn, warnRadiusM, corridorRadiusM, endpointSnapM);
    } else {
      // length unchanged — just refresh endpoints (cheap, 2 features).
      builder.endpointFeatures = buildEndpointFeatures(s, distFn, endpointSnapM);
    }

    if (builder.sageFeatures.length) sage.push(...builder.sageFeatures);
    if (builder.amberFeatures.length) amber.push(...builder.amberFeatures);
    if (builder.redFeatures.length) red.push(...builder.redFeatures);
    if (builder.endpointFeatures.length) endpoints.push(...builder.endpointFeatures);
  }
  // Prune cache entries for strokes no longer present (erased / preview-committed).
  if (strokeBuildCache.size > liveKeys.size + 8) {
    for (const k of strokeBuildCache.keys()) {
      if (!liveKeys.has(k)) strokeBuildCache.delete(k);
    }
  }

  return {
    sage: { type: 'FeatureCollection', features: sage },
    amber: { type: 'FeatureCollection', features: amber },
    red: { type: 'FeatureCollection', features: red },
    endpoints: { type: 'FeatureCollection', features: endpoints },
  };
}

/** v251: exported for test/debug only — clears the module cache. */
export function _clearBrushBuildCache(): void {
  strokeBuildCache.clear();
}

export function BrushStrokeLayer({
  strokes,
  distanceFromOriginalM,
  endpointSnapM = 50,
  warnRadiusM = 240,
  corridorRadiusM = 300,
  hidden = false,
}: Props): React.JSX.Element | null {
  const built = useMemo(
    () => buildFeatures(strokes, distanceFromOriginalM, warnRadiusM, corridorRadiusM, endpointSnapM),
    [strokes, distanceFromOriginalM, warnRadiusM, corridorRadiusM, endpointSnapM],
  );
  if (!ShapeSource || !LineLayer) return null;
  if (strokes.length === 0) return null;
  // v247: instead of unmounting when hidden, render at opacity 0 so the
  // Mapbox ShapeSource stays alive — prevents the "first stroke redraws"
  // flicker when the user re-enters drawing after a Preview.
  const lineOpacity = hidden ? 0 : 0.92;
  const endpointOpacity = hidden ? 0 : 1;
  return (
    <>
      {built.sage.features.length > 0 && (
        <ShapeSource id="brush-sage-src" shape={built.sage}>
          <LineLayer
            id="brush-sage"
            style={{
              lineColor: Colors.primary,
              lineWidth: 6,
              lineOpacity,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {built.amber.features.length > 0 && (
        <ShapeSource id="brush-amber-src" shape={built.amber}>
          <LineLayer
            id="brush-amber"
            style={{
              lineColor: Colors.severityCaution,
              lineWidth: 6,
              lineOpacity,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {built.red.features.length > 0 && (
        <ShapeSource id="brush-red-src" shape={built.red}>
          <LineLayer
            id="brush-red"
            style={{
              lineColor: Colors.severityDanger,
              lineWidth: 6,
              lineOpacity,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {CircleLayer && built.endpoints.features.length > 0 && (
        <ShapeSource id="brush-endpoints-src" shape={built.endpoints}>
          <CircleLayer
            id="brush-endpoint-valid"
            filter={['==', ['get', 'valid'], 1]}
            style={{
              circleRadius: 6,
              circleColor: Colors.primary,
              circleOpacity: endpointOpacity,
              circleStrokeWidth: 2,
              circleStrokeColor: Colors.surface,
              circleStrokeOpacity: endpointOpacity,
            }}
          />
          <CircleLayer
            id="brush-endpoint-invalid"
            filter={['==', ['get', 'valid'], 0]}
            style={{
              circleRadius: 7,
              circleColor: Colors.surface,
              circleOpacity: endpointOpacity,
              circleStrokeWidth: 3,
              circleStrokeColor: Colors.severityDanger,
              circleStrokeOpacity: endpointOpacity,
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
