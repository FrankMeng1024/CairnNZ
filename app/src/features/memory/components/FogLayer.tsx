/**
 * FogLayer — single FillLayer that draws fog everywhere except a set of
 * 25m circles centered on each visited GPS point.
 *
 * v0.2.6.2 (J1 B4 fix): memo signature was previously `count|lastTs`,
 * which missed cases where pull/replacePoints produced an array with
 * the same count + lastTs but different content (e.g. a server pull
 * that replaces 5 local points with 5 different server points). Now
 * memoize on the array reference itself — the store always replaces
 * the array on any mutation (no in-place modification), so reference
 * equality is a sound signal for "set changed".
 */

import React, { useMemo } from 'react';
import { VisitedPoint } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildFogPolygon } from '../services/fogBuilder';
import { MemoryColors } from '../config/memoryConfig';

interface Props {
  visitedPoints: VisitedPoint[];
}

export function FogLayer({ visitedPoints }: Props) {
  const Mapbox = getMapbox();
  const fogShape = useMemo(
    () => buildFogPolygon(visitedPoints),
    [visitedPoints]
  );

  if (!Mapbox.available) return null;
  const { ShapeSource, FillLayer } = Mapbox;

  return (
    <ShapeSource id="memory-fog-src" shape={fogShape}>
      <FillLayer
        id="memory-fog-fill"
        style={{
          fillColor: MemoryColors.fogOverlay,
          fillOpacity: 1,
        }}
      />
    </ShapeSource>
  );
}
