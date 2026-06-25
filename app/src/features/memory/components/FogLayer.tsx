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
import { buildGlobalFog } from '../services/globalFogBuilder';
import { FogBounds } from '../services/h3FogBuilder';
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

  const { ShapeSource, FillLayer } = Mapbox as any;

  return (
    <>
      <ShapeSource id="memory-fog-src" shape={fogFeature}>
        <FillLayer
          id="memory-fog-fill"
          style={{
            fillColor: MemoryColors.fogOverlay,
            fillOpacity: 1,
            fillAntialias: true,
            // Even-odd fill rule turns the holes (visited cells) into
            // transparent windows. Without this, holes are also painted
            // and the user sees no clearing.
            //
            // NOTE: Mapbox GL JS supports `fill-sort-key` but not an
            // explicit fill-rule — Polygon evenodd is the default for
            // single-feature polygons with multiple rings (outer + holes).
            // Each visited cell is in the SAME Polygon's coordinates[]
            // so they ARE holes by virtue of being non-first rings.
            // No additional flag needed.
          }}
        />
      </ShapeSource>
    </>
  );
}
