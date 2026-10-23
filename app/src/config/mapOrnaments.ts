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

/** Memory keeps the genuine wordmark and interactive attribution control as
 * one legal cluster at the exposed lower-left edge. */
export const MEMORY_MAP_ORNAMENTS = groupedMapOrnamentsAbove(8);
