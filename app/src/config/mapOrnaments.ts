export interface MapOrnamentPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * Keep the genuine Mapbox wordmark at lower-left and the compact interactive
 * attribution control at lower-right. Screens pass the measured height of
 * any sheet or dock that covers a full-screen map; already-resized maps pass
 * only their local safe inset.
 */
export function mapOrnamentsAbove(bottomClearance: number) {
  const bottom = Math.max(8, Math.round(bottomClearance));
  return {
    logoPosition: { bottom, left: 8 } satisfies MapOrnamentPosition,
    attributionPosition: { bottom, right: 8 } satisfies MapOrnamentPosition,
  };
}

/** Route workspace uses the same split legal-control contract. */
export function groupedMapOrnamentsAbove(bottomClearance: number) {
  return mapOrnamentsAbove(bottomClearance);
}

export const MAP_ORNAMENTS_EDGE = groupedMapOrnamentsAbove(8);

/** Memory uses the exposed lower edge because its map is already resized by
 * its surrounding page; the two controls remain on opposite sides. */
export const MEMORY_MAP_ORNAMENTS = groupedMapOrnamentsAbove(8);
