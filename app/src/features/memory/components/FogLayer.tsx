/**
 * FogLayer — v327 Zelda-style fog of war.
 *
 * One global Polygon: outer ring covers the whole world, holes are
 * the visited 25m × 25m cells. Mapbox FillLayer with even-odd fill rule
 * paints the world in fog and lets the holes show through.
 *
 * Why this is different from v305-v326:
 *   - v305-v324 (h3 zoom-adaptive): viewport-clipped + cellToParent
 *     over-visit → user saw "中间亮一大块,远处也亮,只是补丁".
 *   - v325 (per-cell): grid checkerboard everywhere.
 *   - v326 (row-run): horizontal stripe grid.
 *   - v327 (this file): GLOBAL fog with hole-per-visited-cell.
 *     Zooms freely. No over-visit. No grid stripes. Matches Zelda
 *     fog-of-war: dark world, only visited spots clear.
 *
 * Bounds prop and zoom prop are accepted but no longer drive a rebuild.
 * They're kept on the type for back-compat with MemoryMap's existing
 * callsite; the new builder is bounds-independent (the outer ring is
 * always the global bbox).
 *
 * Rebuild trigger: cellVersion from useH3VisitedStore. Bumps when the
 * user enters a NEW cell (not every GPS tick — see useH3VisitedStore
 * for the de-dup logic). Typical walking: a few bumps per minute.
 *
 * Soft edges are NOT done here yet. The outer-and-hole polygon has
 * sharp 25m-grid edges. Feathering will be a separate FogLayer feature
 * once the core fog model is validated by users — done as either
 * Mapbox's `paint.fill-blur` or a multi-stop fill stack.
 */

import React, { useMemo } from 'react';
import { useMemorySettingsStore } from '../store/useMemorySettingsStore';
import { useH3VisitedStore } from '../store/useH3VisitedStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildGlobalFog, FogBounds } from '../services/globalFogBuilder';
import { MemoryColors } from '../config/memoryConfig';
import { log } from '../../../services/appLog';

interface Props {
  /** Kept for back-compat with MemoryMap; ignored by the v327 builder. */
  bounds?: FogBounds | null;
  /** Kept for back-compat with MemoryMap; ignored by the v327 builder. */
  zoom?: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function FogLayer(_props: Props) {
  const Mapbox = getMapbox();
  const useH3Fog = useMemorySettingsStore((s) => s.useH3Fog);
  const cellVersion = useH3VisitedStore((s) => s.cellVersion);

  const fogFeature = useMemo(() => {
    if (!useH3Fog) return null;
    const cells = useH3VisitedStore.getState().cells;

    const t0 = Date.now();
    log('memory.fog_build_start', {
      cell_version: cellVersion,
      visited_n: cells.size,
      builder: 'global_v327',
    });
    const result = buildGlobalFog(cells);
    log('memory.fog_built', {
      cell_version: cellVersion,
      total_ms: Date.now() - t0,
      ...result.perf,
    });

    return result.feature;
  }, [cellVersion, useH3Fog]);

  // Kill-switch.
  if (!useH3Fog) return null;
  if (!Mapbox.available || !fogFeature) return null;

  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;

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
        {/* v330 fix — soft-edge feathering done RIGHT.
            v327.1–v329 used lineColor = fogOverlay (the dark fog color)
            with lineWidth=6 + lineBlur=8. At high zoom each 25m cell
            projected to ~30-50 px, so the 14 px halo only feathered
            the outer perimeter and looked correct. As soon as the user
            zoomed out, each cell's projected size dropped below the
            stroke width — the dark fog-colored stroke covered the
            entire cell interior, re-painting fog over the cleared
            reveal. Adjacent row-run rectangles each contributed their
            own top+bottom strokes, producing the persistent
            checkerboard the user reported on v326/327/328.
            Two-part fix:
              1. Use MemoryColors.fogEdge (the cream halo color that
                 was already in config since v303 but never wired up
                 here) instead of fogOverlay. Even if strokes overlap
                 at low zoom, they paint cream — the SAME color the
                 cleared reveal already shows — so no checkerboard.
              2. Cut lineWidth 6→2 and lineBlur 8→3 so the stroke is
                 too thin to ever fully cover a cell. Keeps the soft
                 perimeter feathering visible at all zoom levels. */}
        <LineLayer
          id="memory-fog-edge-soft"
          style={{
            lineColor: MemoryColors.fogEdge,
            lineWidth: 2,
            lineBlur: 3,
            lineOpacity: 0.7,
            lineCap: 'round',
            lineJoin: 'round',
          }}
        />
      </ShapeSource>
    </>
  );
}
