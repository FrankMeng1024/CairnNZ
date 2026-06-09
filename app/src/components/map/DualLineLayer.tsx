/**
 * DualLineLayer — Render route geometry on a Mapbox map with edit-mode
 * dual-line semantics:
 *   - originalPoints: dimmed dashed (gray, 0.6 opacity)
 *   - workingPoints: solid colored by source/edit state
 *   - corridor buffer: optional translucent fill
 *
 * Designed to drop into a `<MapboxGL.MapView>`.
 *
 * Sprint 66 Wave 6.
 */

import React from 'react';
import { Platform } from 'react-native';
import type { LngLat } from '../../services/routing/corridor/PolylineSampler';
import type { EditSegment } from '../../services/LocalRouteExtras';

// Lazy-load @rnmapbox/maps so this file is web-safe.
let ShapeSource: any = null;
let LineLayer: any = null;
let FillLayer: any = null;
if (Platform.OS !== 'web') {
  try {
    const Mapbox = require('@rnmapbox/maps');
    ShapeSource = Mapbox.ShapeSource;
    LineLayer = Mapbox.LineLayer;
    FillLayer = Mapbox.FillLayer;
  } catch {
    // Mapbox not available
  }
}

interface DualLineLayerProps {
  /** Original recorded GPS trace (immutable). Rendered dimmed. */
  originalPoints: LngLat[];
  /** Current working points (post-edit). Rendered colored. */
  workingPoints: LngLat[];
  segments: EditSegment[];
  /** Show original line as backdrop (default true in edit mode). */
  showOriginal?: boolean;
}

const COLOR_ORIGINAL = '#9CA3AF';   // gray
const COLOR_CONFIDENT = '#3B82F6';  // blue
const COLOR_APPROXIMATE = '#F59E0B'; // amber
const COLOR_STRAIGHT = '#EF4444';   // red

function pointsToLineString(points: LngLat[]) {
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: points.map(p => [p.lng, p.lat]),
    },
  };
}

function segmentsToFeatureCollections(workingPoints: LngLat[], segments: EditSegment[]) {
  // Sprint 66 Fix-12 (C4): Mapbox lineDasharray does NOT support data-driven
  // expressions, so we can't put solid + dashed segments in one LineLayer
  // and switch via ['get', 'dashed']. Split into two FeatureCollections —
  // one rendered as solid, the other as dashed — each with its own ShapeSource.
  const solidFeatures: any[] = [];
  const dashedFeatures: any[] = [];
  for (const s of segments) {
    if (s.endIdx >= workingPoints.length) continue;
    const slice = workingPoints.slice(s.startIdx, s.endIdx + 1);
    if (slice.length < 2) continue;
    // v2-audit (ARCH-015): default missing confidence to 'approximate'
    // (conservative). Old code defaulted to 'confident' (solid blue),
    // overstating quality on legacy records that predate the field.
    const confidence = s.confidence ?? 'approximate';
    let color = COLOR_CONFIDENT;
    let dashed = false;
    if (confidence === 'approximate') {
      color = COLOR_APPROXIMATE;
      dashed = true;
    }
    if (s.source === 'straight') {
      color = COLOR_STRAIGHT;
      dashed = true;
    }
    const feature = {
      type: 'Feature',
      properties: { color, source: s.source, isEdited: s.isEdited },
      geometry: {
        type: 'LineString',
        coordinates: slice.map(p => [p.lng, p.lat]),
      },
    };
    if (dashed) dashedFeatures.push(feature);
    else solidFeatures.push(feature);
  }
  return {
    solid: { type: 'FeatureCollection' as const, features: solidFeatures },
    dashed: { type: 'FeatureCollection' as const, features: dashedFeatures },
  };
}

export function DualLineLayer({
  originalPoints,
  workingPoints,
  segments,
  showOriginal = true,
}: DualLineLayerProps): React.JSX.Element | null {
  if (!ShapeSource || !LineLayer) return null;

  const collections = segmentsToFeatureCollections(workingPoints, segments);

  return (
    <>
      {showOriginal && originalPoints.length >= 2 && (
        <ShapeSource id="dual-line-original" shape={pointsToLineString(originalPoints)}>
          <LineLayer
            id="dual-line-original-stroke"
            style={{
              lineColor: COLOR_ORIGINAL,
              lineWidth: 3,
              lineOpacity: 0.6,
              lineDasharray: [2, 2],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {collections.solid.features.length > 0 && (
        <ShapeSource id="dual-line-working-solid" shape={collections.solid}>
          <LineLayer
            id="dual-line-working-solid-stroke"
            style={{
              lineColor: ['get', 'color'],
              lineWidth: 5,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
      {collections.dashed.features.length > 0 && (
        <ShapeSource id="dual-line-working-dashed" shape={collections.dashed}>
          <LineLayer
            id="dual-line-working-dashed-stroke"
            style={{
              lineColor: ['get', 'color'],
              lineWidth: 5,
              lineDasharray: [3, 2],
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}

export const DualLineColors = {
  original: COLOR_ORIGINAL,
  confident: COLOR_CONFIDENT,
  approximate: COLOR_APPROXIMATE,
  straight: COLOR_STRAIGHT,
};
