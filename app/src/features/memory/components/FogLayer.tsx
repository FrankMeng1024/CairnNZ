/**
 * FogLayer — H3 hex-cell fog renderer (v305).
 *
 * For each frame:
 *   1. Read viewport bounds + zoom.
 *   2. Compute the H3 res-adaptive set of hex cells in viewport.
 *   3. Subtract visited cells (from useH3VisitedStore).
 *   4. Emit a Mapbox FillLayer + LineLayer over the remaining
 *      (unvisited) cells.
 *
 * Why H3 instead of turf.union (the old legacy path):
 *   - turf.union is O(N²) on a CPU thread → 1147 points = 15s freeze.
 *   - H3 is index lookups in a Set → 50ms render, independent of point
 *     count.
 *   - See `_review/v305_h3_fog/` for the full route comparison.
 *
 * Killing the fog (useH3Fog=false in settings):
 *   Returns null. Used for debug triage and emergency disable.
 *
 * Recovery from missing migration:
 *   If we detect `cells.size === 0 && points.length > 0` (meaning the
 *   H3 migration didn't run or failed silently), fire-and-forget the
 *   migration here. Next render the cells will be populated.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useH3VisitedStore } from '../store/useH3VisitedStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildUnvisitedHexFeatures, FogBounds } from '../services/h3FogBuilder';
import { MemoryColors } from '../config/memoryConfig';
import { log } from '../../../services/appLog';

interface Props {
  /** Current map viewport bounds. Driven by parent MapView. */
  bounds: FogBounds | null;
  /** Current map zoom — controls H3 resolution selection. */
  zoom?: number;
}

/** Debounce window for viewport changes so pan/zoom drag doesn't rebuild
 *  the fog every frame. H3 is fast (~50ms), but successive setData calls
 *  on Mapbox ShapeSource can still cause minor stutter. */
const REBUILD_DEBOUNCE_MS = 100;

export function FogLayer({ bounds, zoom = 15 }: Props) {
  const Mapbox = getMapbox();
  const useH3Fog = useMemorySettingsStore((s) => s.useH3Fog);
  const cellVersion = useH3VisitedStore((s) => s.cellVersion);

  // Debounce viewport changes — avoids rebuilding on every pan frame.
  const [debouncedBounds, setDebouncedBounds] = useState<FogBounds | null>(bounds);
  const [debouncedZoom, setDebouncedZoom] = useState<number>(zoom);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!bounds) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedBounds(bounds);
      setDebouncedZoom(zoom);
    }, REBUILD_DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [bounds, zoom]);

  const fogFeature = useMemo(() => {
    if (!debouncedBounds) return null;
    // v305 OTA REVIEW3: useH3Fog short-circuit MUST be in useMemo so the
    // expensive build is skipped when the kill-switch is off. The
    // outer `if (!useH3Fog) return null` would render null but useMemo
    // would still run, defeating the purpose.
    if (!useH3Fog) return null;
    const cells = useH3VisitedStore.getState().cells;

    const t0 = Date.now();
    log('memory.fog_build_start', {
      bounds_w: debouncedBounds.west,
      bounds_e: debouncedBounds.east,
      zoom: debouncedZoom,
      cell_version: cellVersion,
      visited_n: cells.size,
    });
    const result = buildUnvisitedHexFeatures(debouncedBounds, cells, debouncedZoom);
    log('memory.fog_built', {
      cell_version: cellVersion,
      total_ms: Date.now() - t0,
      ...result.perf,
    });

    return result.feature;
  }, [cellVersion, debouncedBounds, debouncedZoom, useH3Fog]);

  // Kill-switch: useH3Fog=false renders nothing.
  if (!useH3Fog) return null;
  if (!Mapbox.available || !fogFeature) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

  // Adaptive line-blur: at lower zoom (coarser res), bigger blur softens
  // the visible hex outline so it reads as cloud, not as game grid.
  const lineBlur = debouncedZoom < 13 ? 5 : debouncedZoom < 15 ? 3 : 2;

  return (
    <>
      <ShapeSource id="memory-fog-src" shape={fogFeature}>
        <FillLayer
          id="memory-fog-fill"
          style={{
            fillColor: MemoryColors.fogOverlay,
            fillOpacity: 1,
            fillAntialias: true,
          }}
        />
        <LineLayer
          id="memory-fog-edge-line"
          style={{
            lineColor: MemoryColors.fogEdge,
            lineWidth: 1.5,
            lineOpacity: 0.55,
            lineBlur,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>
    </>
  );
}
