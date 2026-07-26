/**
 * Region configuration — geo-extensibility foundation.
 * All geographic constants live here. No lat/lng or region codes
 * are hardcoded in components or stores.
 *
 * To add a new region: append to REGIONS and update getCurrentRegion()
 * logic when user-region selection is implemented.
 */

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface Region {
  code: string;          // e.g. 'nz', 'au', 'us-pnw'
  name: string;          // Display name
  centerLat: number;
  centerLng: number;
  defaultZoom: number;
  boundingBox: BoundingBox;
}

// ── Region definitions ─────────────────────────────────────────────────────

const NZ: Region = {
  code: 'nz',
  name: 'New Zealand',
  centerLat: -41.2865,
  centerLng: 174.7762,
  defaultZoom: 6,
  boundingBox: {
    minLat: -47.5,
    maxLat: -34.0,
    minLng: 166.0,
    maxLng: 178.6,
  },
};

// O1 (2026-07-26): removed REGIONS record + getRegion(code). Both had 0
// external caller — multi-region was a Phase-2 aspiration never realized,
// getCurrentRegion() is the only consumer and inlines NZ directly.
// If Phase-2 multi-region ships: reintroduce REGIONS map + getRegion()
// with the same shape.

/**
 * Returns the currently active region.
 * Phase 1: always NZ. Phase 2: read from user preference store.
 */
export function getCurrentRegion(): Region {
  return NZ;
}
