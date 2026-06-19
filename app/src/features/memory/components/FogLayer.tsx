/**
 * FogLayer — single FillLayer that draws fog except 25m circles around
 * each visited GPS point.
 *
 * v0.2.6.3 (K5 fix): memoized on `geometryVersion` from the store,
 * NOT on the points array reference. markPointsSyncedByCid mutates
 * the array reference but does not bump geometryVersion — fog is
 * not rebuilt on sync flag flips. This is the perf fix called out
 * by reviewer A.
 *
 * The component subscribes to geometryVersion via a Zustand selector
 * (which triggers re-render on bump), and reads `points` via
 * getState() inside the memo factory (one-shot snapshot — no double
 * subscription).
 */

import React, { useMemo } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildFogPolygon } from '../services/fogBuilder';
import { MemoryColors } from '../config/memoryConfig';

export function FogLayer() {
  const Mapbox = getMapbox();
  // Subscribe to geometryVersion ONLY — triggers re-render when geometry
  // changes (recordPoint / replacePoints / clearAll). Synced-flag flips
  // do NOT bump this counter (per K5 plan).
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);
  const fogShape = useMemo(
    () => buildFogPolygon(useMemoryStore.getState().points),
    [geometryVersion]
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
