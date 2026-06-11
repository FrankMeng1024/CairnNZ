/**
 * CorridorBoundaryLayer — render the 1km adjust-radius around the user's
 * recorded GPS trace as a translucent green fill, so the user can see
 * exactly where they are allowed to drop a detour point.
 *
 * Sprint 67 v241.
 *
 * Implementation: sample originalPoints to ~50 anchor points, draw a 32-
 * segment polygon (circle approximation) around each anchor at 1km radius,
 * and let Mapbox composite them as overlapping features. We skip true
 * polygon union (too heavy on JS) — visually identical at this opacity.
 */

import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import { Colors } from '../tokens';

let ShapeSource: any = null;
let FillLayer: any = null;
let LineLayer: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    ShapeSource = Mapbox.ShapeSource;
    FillLayer = Mapbox.FillLayer;
    LineLayer = Mapbox.LineLayer;
  } catch {
    // Mapbox unavailable
  }
}

interface Props {
  originalPoints: Array<{ lat: number; lng: number }>;
  /** Radius in meters. Default 1000 (1km). */
  radiusM?: number;
}

const SAMPLES_PER_TRACE = 50;
const CIRCLE_SEGMENTS = 24;

function buildCorridorGeoJSON(
  originalPoints: Array<{ lat: number; lng: number }>,
  radiusM: number,
): any {
  if (originalPoints.length === 0) {
    return { type: 'FeatureCollection', features: [] };
  }
  // Sample anchors uniformly across the trace.
  const step = Math.max(1, Math.floor(originalPoints.length / SAMPLES_PER_TRACE));
  const anchors: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < originalPoints.length; i += step) {
    anchors.push(originalPoints[i]);
  }
  // Always include the last point.
  const last = originalPoints[originalPoints.length - 1];
  if (anchors[anchors.length - 1] !== last) anchors.push(last);

  const features = anchors.map((anchor) => {
    const lat = anchor.lat;
    const lng = anchor.lng;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const dLatPerM = 1 / 111_000;
    const dLngPerM = 1 / (111_000 * Math.max(cosLat, 0.1));
    const ring: number[][] = [];
    for (let s = 0; s <= CIRCLE_SEGMENTS; s++) {
      const theta = (s / CIRCLE_SEGMENTS) * 2 * Math.PI;
      const dx = Math.cos(theta) * radiusM;
      const dy = Math.sin(theta) * radiusM;
      const cLng = lng + dx * dLngPerM;
      const cLat = lat + dy * dLatPerM;
      ring.push([cLng, cLat]);
    }
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [ring] },
    };
  });
  return { type: 'FeatureCollection', features };
}

export function CorridorBoundaryLayer({ originalPoints, radiusM = 1000 }: Props): React.JSX.Element | null {
  // Hooks must run unconditionally (Rules of Hooks).
  const shape = useMemo(
    () => buildCorridorGeoJSON(originalPoints, radiusM),
    [originalPoints, radiusM],
  );
  if (!ShapeSource || !FillLayer) return null;
  if (originalPoints.length < 2) return null;
  if (shape.features.length === 0) return null;
  return (
    <ShapeSource id="corridor-boundary" shape={shape}>
      <FillLayer
        id="corridor-boundary-fill"
        style={{
          fillColor: Colors.primary,
          fillOpacity: 0.10,
        }}
      />
      {LineLayer && (
        <LineLayer
          id="corridor-boundary-stroke"
          style={{
            lineColor: Colors.primary,
            lineWidth: 1.5,
            lineOpacity: 0.35,
            lineDasharray: [3, 3],
          }}
        />
      )}
    </ShapeSource>
  );
}
