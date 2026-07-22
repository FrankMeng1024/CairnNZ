/**
 * HighlightRegionLayer — v428
 *
 * Renders a sage-tinted fill + outline around the currently selected
 * region in the hierarchy panel. Fetches the polygon lazily when
 * regionId changes; keeps prior polygon visible during fetch (no
 * A→blank→B flicker).
 *
 * Layer stack (bottom-up per v428 plan §7.1):
 *   base → fog → hl-region-fill → hl-region-line → tracks → markers → user
 *
 * Zoom-based fill opacity (v428 plan §7.2):
 *   zoom < 4  → 0.10 (world view — subtle so world map still readable)
 *   zoom 4-14 → 0.25 (normal)
 * Line width:
 *   zoom < 4  → 3px (visible even when polygon tiny)
 *   zoom > 6  → 2px
 *
 * Continent / world levels have empty polygon → source data set to
 * empty FeatureCollection → nothing renders, per user "continent 不高亮"
 * decision.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { fetchPolygon, isEmptyPolygon, type RegionPolygon } from '../services/hierarchyService';
import { getMapbox } from '../services/mapboxAdapter';
import { MemoryColors } from '../config/memoryConfig';
import { Colors } from '../../../components/tokens';
import {
  HL_SOURCE_ID,
  HL_FILL_LAYER_ID,
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
          // v428 §7.2 — interpolate on zoom, no JS runtime cost
          fillOpacity: [
            'interpolate', ['linear'], ['zoom'],
            2, 0.10,   // world zoom — subtle
            4, 0.25,   // country zoom — visible
            14, 0.25,  // street zoom — visible
          ],
        }}
      />
      <LineLayer
        id={HL_LINE_LAYER_ID}
        style={{
          lineColor: Colors.primary,
          lineWidth: [
            'interpolate', ['linear'], ['zoom'],
            2, 3,   // world zoom — thick so still readable
            6, 2,
            14, 2,
          ],
          lineOpacity: 0.9,
        }}
      />
    </ShapeSource>
  );
}

export default HighlightRegionLayer;
