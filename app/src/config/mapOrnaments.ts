export interface MapOrnamentPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * Keep the genuine Mapbox logo and attribution control together at the
 * lower-left of the exposed map. Screens pass the measured height of any
 * sheet that covers a full-screen map; already-resized maps pass only their
 * local safe inset.
 */
export function mapOrnamentsAbove(bottomClearance: number) {
  const bottom = Math.max(8, Math.round(bottomClearance));
  return {
    logoPosition: { bottom, left: 8 } satisfies MapOrnamentPosition,
    attributionPosition: { bottom, left: 92 } satisfies MapOrnamentPosition,
  };
}

/** Route workspace keeps both genuine legal controls together at lower-left. */
export function groupedMapOrnamentsAbove(bottomClearance: number) {
  const bottom = Math.max(8, Math.round(bottomClearance));
  return {
    logoPosition: { bottom, left: 8 } satisfies MapOrnamentPosition,
    attributionPosition: { bottom, left: 92 } satisfies MapOrnamentPosition,
  };
}

export const MAP_ORNAMENTS_EDGE = groupedMapOrnamentsAbove(8);

/** Memory has persistent controls above the map, so its legal marks can use
 * the actual exposed bottom edge: logo left, attribution/info right. */
export const MEMORY_MAP_ORNAMENTS = {
  logoPosition: { bottom: 8, left: 8 } satisfies MapOrnamentPosition,
  attributionPosition: { bottom: 8, right: 8 } satisfies MapOrnamentPosition,
};
