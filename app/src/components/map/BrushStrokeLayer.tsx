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

  for (const s of strokes) {
    if (s.points.length < 2) {
      // Single point stroke — show only an endpoint marker.
      const p = s.points[0];
      if (p) {
        const valid = distFn(p) <= endpointSnapM;
        endpoints.push({
          type: 'Feature',
          properties: { valid: valid ? 1 : 0 },
          geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
        });
      }
      continue;
    }
    // Walk segments and group by severity.
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
      if (runSeverity === 'sage') sage.push(feature);
      else if (runSeverity === 'amber') amber.push(feature);
      else red.push(feature);
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
        // Flush prior run [runStart..i-1] (segment ended at i-1)
        flushRun(i - 1);
        runStart = i - 1;
        runSeverity = sev;
      }
    }
    flushRun(s.points.length - 1);

    // Endpoint markers.
    const start = s.points[0];
    const end = s.points[s.points.length - 1];
    const startValid = distFn(start) <= endpointSnapM;
    const endValid = distFn(end) <= endpointSnapM;
    endpoints.push({
      type: 'Feature',
      properties: { valid: startValid ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [start.lng, start.lat] },
    });
    endpoints.push({
      type: 'Feature',
      properties: { valid: endValid ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [end.lng, end.lat] },
    });
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
}: Props): React.JSX.Element | null {
  const built = useMemo(
    () => buildFeatures(strokes, distanceFromOriginalM, warnRadiusM, corridorRadiusM, endpointSnapM),
    [strokes, distanceFromOriginalM, warnRadiusM, corridorRadiusM, endpointSnapM],
  );
  if (!ShapeSource || !LineLayer) return null;
  if (strokes.length === 0) return null;
  return (
    <>
      {built.sage.features.length > 0 && (
        <ShapeSource id="brush-sage-src" shape={built.sage}>
          <LineLayer
            id="brush-sage"
            style={{
              lineColor: Colors.primary,
              lineWidth: 6,
              lineOpacity: 0.92,
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
              lineOpacity: 0.92,
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
              lineOpacity: 0.92,
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
              circleStrokeWidth: 2,
              circleStrokeColor: Colors.surface,
            }}
          />
          <CircleLayer
            id="brush-endpoint-invalid"
            filter={['==', ['get', 'valid'], 0]}
            style={{
              circleRadius: 7,
              circleColor: Colors.surface,
              circleStrokeWidth: 3,
              circleStrokeColor: Colors.severityDanger,
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
