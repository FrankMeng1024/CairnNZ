/**
 * DOCTrailsTypes — TypeScript types for DOC ArcGIS Feature Service responses.
 *
 * Sprint 66 Wave 2.
 */

import type { LngLat } from '../corridor/PolylineSampler';

/**
 * GeoJSON Feature returned by DOC Feature Service.
 * outSR=4326 → coordinates in [lng, lat].
 */
export interface DOCTrailFeature {
  trackId: string;        // mapped from OBJECTID
  name: string;           // mapped from TechObjectName
  objectType?: string;    // ObjectType
  geometry: {
    type: 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][];
  };
}

/** Bounding box in WGS84 lng/lat. */
export interface BBox {
  west: number;   // lng min
  south: number;  // lat min
  east: number;   // lng max
  north: number;  // lat max
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'LineString' | 'MultiLineString'; coordinates: any };
    properties: Record<string, any>;
  }>;
}

export type DOCFetchResult =
  | { ok: true; trails: DOCTrailFeature[]; cached: boolean; durationMs: number }
  | { ok: false; error: string; transient: boolean; durationMs: number };
