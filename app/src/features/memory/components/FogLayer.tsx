/**
 * FogLayer — single FillLayer that draws fog everywhere except the
 * user's explored tiles (rendered as holes in the polygon).
 *
 * GeoJSON shape produced by buildFogPolygon:
 *   - Outer ring: whole world rectangle (clockwise)
 *   - Inner rings: one rect per explored zoom-17 tile (counter-clockwise)
 *
 * Mapbox's FillLayer renders Polygon-with-holes natively, so this is
 * the cleanest way to "cut" fog. No two-layer hack needed.
 *
 * Performance: Map ref changes on every recordCircleUnlock (every 5m
 * of walking) but the actual TILE SET only grows when a new tile is
 * crossed (every ~150m of walking at zoom 17). Memoizing on Map
 * reference would force a full polygon rebuild + Mapbox shape upload
 * on every step. Instead we memoize on a stable signature of the tile
 * set so the polygon is only rebuilt when the SET actually changes.
 */

import React, { useMemo } from 'react';
import { ExploredTile } from '../store/useMemoryStore';
import { getMapbox } from '../services/mapboxAdapter';
import { buildFogPolygon } from '../services/fogBuilder';
import { MemoryColors } from '../config/memoryConfig';

interface Props {
  exploredTiles: Map<string, ExploredTile>;
}

/**
 * Build a stable signature of the tile set: tile count + sorted keys
 * joined. Same set → same signature, regardless of Map identity.
 * For large tile sets this is O(N log N) once per render, but the
 * memo skips the polygon rebuild entirely when the signature matches —
 * net win on every walking step that doesn't cross a new tile.
 */
function tileSetSignature(tiles: Map<string, ExploredTile>): string {
  if (tiles.size === 0) return '0';
  const keys = Array.from(tiles.keys()).sort();
  return `${tiles.size}|${keys.join(',')}`;
}

export function FogLayer({ exploredTiles }: Props) {
  const Mapbox = getMapbox();
  const signature = tileSetSignature(exploredTiles);
  const fogShape = useMemo(
    () => buildFogPolygon(Array.from(exploredTiles.values())),
    // Memo on the stable signature, not on Map identity.
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
          fillOpacity: 1,  // color already has alpha
        }}
      />
    </ShapeSource>
  );
}
