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
 * v249: per-stroke feature cache. Keyed by `${strokeId}:${pointCount}` so
 * appending a point invalidates entry for that stroke only; finalized
 * strokes (length unchanged) reuse cached features. Eliminates the O(N)
 * per-frame rebuild that compounded with multiple strokes.
 */
const strokeBuildCache = new Map<string, OneStrokeBuilt>();
function strokeCacheKey(s: BrushStroke): string {
  return `${s.id}:${s.points.length}`;
}

function buildOneStrokeFeatures(
  s: BrushStroke,
  distFn: (c: LngLat) => number,
  warnRadiusM: number,
  corridorRadiusM: number,
  endpointSnapM: number,
): OneStrokeBuilt {
  const sageFeatures: any[] = [];
  const amberFeatures: any[] = [];
  const redFeatures: any[] = [];
  const endpointFeatures: any[] = [];

  if (s.points.length < 2) {
    const p = s.points[0];
    if (p) {
      const valid = distFn(p) <= endpointSnapM;
      endpointFeatures.push({
        type: 'Feature',
        properties: { valid: valid ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      });
    }
    return { sageFeatures, amberFeatures, redFeatures, endpointFeatures };
  }

  let runStart = 0;
  let runSeverity: Severity = 'sage';
  let runComputed = false;
  const flushRun = (endIdx: number) => {
    if (endIdx <= runStart) return;
    const slice = s.points.slice(runStart, endIdx + 1);
    const feature = {
      type: 'Feature',
      properties: { strokeId: s.id },
      geometry: {
        type: 'LineString',
        coordinates: slice.map(p => [p.lng, p.lat]),
      },
    };
    if (runSeverity === 'sage') sageFeatures.push(feature);
    else if (runSeverity === 'amber') amberFeatures.push(feature);
    else redFeatures.push(feature);
  };
  for (let i = 1; i < s.points.length; i++) {
    const a = s.points[i - 1];
    const b = s.points[i];
    const da = distFn(a);
    const db = distFn(b);
    const sev = classify(Math.max(da, db), warnRadiusM, corridorRadiusM);
    if (!runComputed) {
      runSeverity = sev;
      runComputed = true;
      runStart = i - 1;
    } else if (sev !== runSeverity) {
      flushRun(i - 1);
      runStart = i - 1;
      runSeverity = sev;
    }
  }
  flushRun(s.points.length - 1);

  const start = s.points[0];
  const end = s.points[s.points.length - 1];
  const startValid = distFn(start) <= endpointSnapM;
  const endValid = distFn(end) <= endpointSnapM;
  endpointFeatures.push({
    type: 'Feature',
    properties: { valid: startValid ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [start.lng, start.lat] },
  });
  endpointFeatures.push({
    type: 'Feature',
    properties: { valid: endValid ? 1 : 0 },
    geometry: { type: 'Point', coordinates: [end.lng, end.lat] },
  });

  return { sageFeatures, amberFeatures, redFeatures, endpointFeatures };
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

  // v249: walk strokes, reuse cached features for unchanged strokes.
  // Track which keys are still live so we can prune stale entries.
  const liveKeys = new Set<string>();
  for (const s of strokes) {
    const key = strokeCacheKey(s);
    liveKeys.add(key);
    let one = strokeBuildCache.get(key);
    if (!one) {
      one = buildOneStrokeFeatures(s, distFn, warnRadiusM, corridorRadiusM, endpointSnapM);
      strokeBuildCache.set(key, one);
    }
    if (one.sageFeatures.length) sage.push(...one.sageFeatures);
    if (one.amberFeatures.length) amber.push(...one.amberFeatures);
    if (one.redFeatures.length) red.push(...one.redFeatures);
    if (one.endpointFeatures.length) endpoints.push(...one.endpointFeatures);
  }
  // Prune dead entries (erased strokes, post-split with new ids, etc).
  if (strokeBuildCache.size > liveKeys.size + 50) {
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

export function BrushStrokeLayer({
  strokes,
  distanceFromOriginalM,
  endpointSnapM = 50,
  warnRadiusM = 400,
  corridorRadiusM = 500,
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
