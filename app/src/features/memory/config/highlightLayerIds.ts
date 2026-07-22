/**
 * highlightLayerIds — v428, v432 halo added
 *
 * Constants for the Mapbox source & layer IDs used by the hierarchy panel's
 * region-highlight feature. Extracted to a shared file so both the map
 * component and Playwright tests reference the same string.
 *
 * v432: added HL_HALO_LAYER_ID for the outer blurred glow ring used by
 * the halo visual style (no hard boundary line — see HighlightRegionLayer).
 */

export const HL_SOURCE_ID = 'hl-region';
export const HL_FILL_LAYER_ID = 'hl-region-fill';
export const HL_HALO_LAYER_ID = 'hl-region-halo';
export const HL_LINE_LAYER_ID = 'hl-region-line';
