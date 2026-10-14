export interface MapOrnamentPosition {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * Keep the genuine Mapbox logo and attribution control in separate legal
 * corners with the same vertical clearance. Screens pass the height of any
 * persistent bottom surface; both native RNMapbox and the Web adapter consume
 * these exact positions.
 */
export function mapOrnamentsAbove(bottomClearance: number) {
  const bottom = Math.max(8, Math.round(bottomClearance));
  return {
    logoPosition: { bottom, left: 8 } satisfies MapOrnamentPosition,
    attributionPosition: { bottom, right: 8 } satisfies MapOrnamentPosition,
  };
}

export const MAP_ORNAMENTS_EDGE = mapOrnamentsAbove(8);
