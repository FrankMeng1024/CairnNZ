/**
 * HighlightRegionLayer — v432 (halo/glow style)
 *
 * Renders a sage glow around the currently selected region. v432 pivots
 * from a hard "boundary line + fill" to a soft halo because our polygon
 * data (geoBoundaries ADM1) doesn't match Mapbox's proprietary admin
 * boundaries pixel-for-pixel — the mismatch looked broken.
 *
 * Halo strategy (subagent report: mapbox-boundary-mismatch.md option c):
 *   - Fill: very faint (0.06-0.10) — user sees which area is selected
 *     but doesn't focus on the exact border pixel.
 *   - Line: two-layer glow effect
 *     • Outer wide+blurred line (halo)
 *     • Inner thin+low-opacity line (soft edge, not a hard boundary)
 *   Visual reads as "this region is glowing" not "here is the boundary".
 *
 * Layer stack (bottom-up):
 *   base → fog → hl-region-fill → hl-region-halo → hl-region-line
 *        → tracks → markers → user
 *
 * Continent / world levels have empty polygon → nothing renders, per
 * user "continent 不高亮" decision.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { fetchPolygon, isEmptyPolygon, type RegionPolygon } from '../services/hierarchyService';
import { getMapbox } from '../services/mapboxAdapter';
import { MemoryColors } from '../config/memoryConfig';
import { Colors } from '../../../components/tokens';
import {
  HL_SOURCE_ID,
  HL_FILL_LAYER_ID,
  HL_HALO_LAYER_ID,
  HL_LINE_LAYER_ID,
} from '../config/highlightLayerIds';

interface Props {
  /** ID of the region currently selected in hierarchy panel; null = no highlight */
  regionId: string | null;
}

const EMPTY_FC = Object.freeze({ type: 'FeatureCollection' as const, features: [] });

export function HighlightRegionLayer({ regionId }: Props) {
  const [polygon, setPolygon] = useState<RegionPolygon | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!regionId) {
      // No selection — clear polygon (but don't clear immediately if we had one
      // and are just switching between regions; MemoryScreen handles that).
      // Here regionId=null truly means "no highlight at all".
      setPolygon(null);
      return;
    }
    // Keep old polygon visible during fetch (no white flicker between A→B).
    // Do NOT setPolygon(null) here — let the swap happen atomically once fetch resolves.
    fetchPolygon(regionId).then((p) => {
      if (cancelled) return;
      setPolygon(p);
    });
    return () => { cancelled = true; };
  }, [regionId]);

  const Mapbox = getMapbox();
  if (!Mapbox.available) return null;
  const { ShapeSource, FillLayer, LineLayer } = Mapbox as any;
  if (!ShapeSource || !FillLayer || !LineLayer) return null;

  // Feed FC to source. If empty (continent/world/pre-fetch), source has no
  // features and neither layer renders anything visible.
  // Memoize the shape object identity to prevent web adapter (mapbox-gl-js)
  // from kicking a fresh tile reload on every render.
  const shape = useMemo(
    () => (!polygon || isEmptyPolygon(polygon) ? EMPTY_FC : polygon),
    [polygon]
  );

  return (
    <ShapeSource id={HL_SOURCE_ID} shape={shape}>
      <FillLayer
        id={HL_FILL_LAYER_ID}
        style={{
          fillColor: Colors.primary,
          // v432 halo: much fainter fill so mismatch with Mapbox admin
          // lines doesn't jump out. User sees "this area is selected"
          // without focusing on the exact border pixel.
          fillOpacity: [
            'interpolate', ['linear'], ['zoom'],
            2, 0.04,   // world zoom — barely there
            4, 0.08,   // country zoom — subtle
            14, 0.10,  // street zoom — visible but soft
          ],
        }}
      />
      {/* Outer halo — wide + blurred + low opacity → glow effect */}
      <LineLayer
        id={HL_HALO_LAYER_ID}
        style={{
          lineColor: Colors.primary,
          lineWidth: [
            'interpolate', ['linear'], ['zoom'],
            2, 10,
            6, 14,
            14, 18,
          ],
          lineBlur: [
            'interpolate', ['linear'], ['zoom'],
            2, 6,
            6, 10,
            14, 14,
          ],
          lineOpacity: 0.35,
        }}
      />
      {/* Inner soft edge — thin + faint, NOT a hard boundary */}
      <LineLayer
        id={HL_LINE_LAYER_ID}
        style={{
          lineColor: Colors.primary,
          lineWidth: [
            'interpolate', ['linear'], ['zoom'],
            2, 1,
            6, 1.2,
            14, 1.5,
          ],
          lineBlur: 1.5,
          lineOpacity: 0.45,
        }}
      />
    </ShapeSource>
  );
}

export default HighlightRegionLayer;
