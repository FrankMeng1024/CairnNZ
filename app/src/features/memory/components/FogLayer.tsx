/**
 * FogLayer — single FillLayer that draws fog everywhere except a set of
 * 25m circles centered on each visited GPS point.
 *
 * v0.2.6.1: rewritten from tile-bitmap holes to point-based circles.
 * Memo signature is point count + last point timestamp; same set of
 * points → same signature, no rebuild. New point → signature changes,
 * polygon rebuilt.
 */

import React, { useMemo } from 'react';
import { VisitedPoint } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildFogPolygon } from '../services/fogBuilder';
import { MemoryColors } from '../config/memoryConfig';

interface Props {
  visitedPoints: VisitedPoint[];
}

function pointsSignature(points: VisitedPoint[]): string {
  if (points.length === 0) return '0';
  const last = points[points.length - 1];
  return `${points.length}|${last.ts}`;
}

export function FogLayer({ visitedPoints }: Props) {
  const Mapbox = getMapbox();
  const signature = pointsSignature(visitedPoints);
  const fogShape = useMemo(
    () => buildFogPolygon(visitedPoints),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [signature]
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
