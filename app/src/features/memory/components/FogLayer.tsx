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
import { buildFogPolygon, FogBounds, extractHoleRings } from '../services/fogBuilder';
import { MemoryColors, FogConfig } from '../config/memoryConfig';
import { log } from '../../../services/appLog';

interface Props {
  /** Current map viewport bounds. Driven by parent MapView. */
  bounds: FogBounds | null;
  /** v303 OTA: 当前 map zoom,fogBuilder 用它决定 padFactor。 */
  zoom?: number;
}

export function FogLayer({ bounds, zoom = 15 }: Props) {
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
    const shape = buildFogPolygon(points, debouncedBounds, zoom);
    log('memory.fog_built', {
      version: geometryVersion,
      input_points: points.length,
      ring_count: shape.geometry.coordinates.length,
      bounds_w: debouncedBounds.west.toFixed(4),
      bounds_e: debouncedBounds.east.toFixed(4),
      zoom: zoom.toFixed(1),
    });
    return shape;
  }, [geometryVersion, debouncedBounds, zoom]);

  if (!Mapbox.available || !fogShape) return null;
  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;
  const holeRings = extractHoleRings(fogShape);

  return (
    <>
      <ShapeSource id="memory-fog-src" shape={fogShape}>
        <FillLayer
          id="memory-fog-fill"
          style={{
            fillColor: MemoryColors.fogOverlay,
            fillOpacity: 1,
            // v303 OTA: antialias 默认 false 在 Android 才显著,iOS 上没害
            fillAntialias: true,
          }}
        />
      </ShapeSource>
      {/* v303 OTA: 第二层 LineLayer 在 hole rings 上画一条柔光线,看起来像
          羊皮纸边沿。color 用 MemoryColors.fogEdge(淡 cream 透明),只画
          holes(extractHoleRings 已经跳掉 outer ring),不会出现把整 viewport
          framed 的问题(v302 N5 备忘提到的旧坑)。 */}
      {holeRings && (
        <ShapeSource id="memory-fog-edge-src" shape={holeRings as any}>
          <LineLayer
            id="memory-fog-edge-line"
            style={{
              lineColor: MemoryColors.fogEdge,
              lineWidth: 1.5,
              lineOpacity: 0.7,
              lineBlur: 1.2,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          />
        </ShapeSource>
      )}
    </>
  );
}
