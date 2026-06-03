/**
 * Offline map region packs — downloadable tile sets for NZ.
 * Each pack defines bounds, zoom levels, and estimated size.
 *
 * Sprint 43 — STORY-00141: Offline Tile Download Manager
 */
import type { BoundingBox } from './regions';

export interface OfflinePack {
  id: string;
  name: string;
  description: string;
  bounds: [number, number, number, number]; // [swLng, swLat, neLng, neLat]
  minZoom: number;
  maxZoom: number;
  estimatedSizeMB: number;
}

/**
 * Pre-defined NZ offline packs.
 * Bounds are [swLng, swLat, neLng, neLat] format for Mapbox.
 */
export const NZ_OFFLINE_PACKS: OfflinePack[] = [
  {
    id: 'nz-tongariro',
    name: 'Tongariro',
    description: 'Tongariro Alpine Crossing & National Park',
    bounds: [175.4, -39.35, 175.85, -39.05],
    minZoom: 10,
    maxZoom: 15,
    estimatedSizeMB: 85,
  },
  {
    id: 'nz-abel-tasman',
    name: 'Abel Tasman',
    description: 'Abel Tasman Coast Track & Golden Bay',
    bounds: [172.8, -41.1, 173.1, -40.75],
    minZoom: 10,
    maxZoom: 15,
    estimatedSizeMB: 60,
  },
  {
    id: 'nz-routeburn',
    name: 'Routeburn',
    description: 'Routeburn Track, Milford & Key Summit',
    bounds: [167.6, -45.0, 168.3, -44.6],
    minZoom: 10,
    maxZoom: 15,
    estimatedSizeMB: 95,
  },
  {
    id: 'nz-wellington',
    name: 'Wellington Region',
    description: 'Wellington city & surrounding trails',
    bounds: [174.6, -41.4, 175.0, -41.1],
    minZoom: 10,
    maxZoom: 16,
    estimatedSizeMB: 120,
  },
  {
    id: 'nz-queenstown',
    name: 'Queenstown',
    description: 'Queenstown, Remarkables & Ben Lomond',
    bounds: [168.5, -45.15, 168.85, -44.9],
    minZoom: 10,
    maxZoom: 15,
    estimatedSizeMB: 70,
  },
];
