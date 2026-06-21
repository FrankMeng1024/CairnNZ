/**
 * FogLayer — Fill layer that renders the sepia fog overlay with a hole
 * for every visited GPS point.
 *
 * The fog is driven by TWO inputs:
 *   1. The store's geometryVersion — bumps when visited points change.
 *   2. The map's current viewport bounds — drives the outer-ring size.
 *
 * Both must be inputs because (per N5 root-cause work) mapbox-gl-js
 * cannot render a polygon whose outer ring spans the world; it must
 * be sized relative to the visible viewport.
 *
 * Performance:
 *   - geometryVersion subscription triggers a re-render only when
 *     points actually change.
 *   - Viewport bound changes are debounced via FogConfig.rebuildDebounceMs
 *     so a fast pan/zoom doesn't rebuild the polygon every frame.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMemoryStore } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildFogPolygon, FogBounds } from '../services/fogBuilder';
import { MemoryColors, FogConfig } from '../config/memoryConfig';
import { log } from '../../../services/appLog';

interface Props {
  /** Current map viewport bounds. Driven by parent MapView. */
  bounds: FogBounds | null;
}

export function FogLayer({ bounds }: Props) {
  const Mapbox = getMapbox();
  const geometryVersion = useMemoryStore((s) => s.geometryVersion);

  // Debounce bounds changes so we don't rebuild on every pan frame.
  const [debouncedBounds, setDebouncedBounds] = useState<FogBounds | null>(bounds);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bounds) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedBounds(bounds);
    }, FogConfig.rebuildDebounceMs);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [bounds]);

  const fogShape = useMemo(() => {
    if (!debouncedBounds) return null;
    const points = useMemoryStore.getState().points;
    const shape = buildFogPolygon(points, debouncedBounds);
    log('memory.fog_built', {
      version: geometryVersion,
      input_points: points.length,
      ring_count: shape.geometry.coordinates.length,
      bounds_w: debouncedBounds.west.toFixed(4),
      bounds_e: debouncedBounds.east.toFixed(4),
    });
    return shape;
  }, [geometryVersion, debouncedBounds]);

  if (!Mapbox.available || !fogShape) return null;
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
