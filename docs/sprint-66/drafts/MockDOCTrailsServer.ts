/**
 * Mock DOC ArcGIS FeatureServer for sprint-66 testing.
 *
 * Replicates `services1.arcgis.com/.../DOC_Tracks_EAM/FeatureServer/0/query`
 * endpoint behavior using local fixture GeoJSON files.
 *
 * Triggered by EXPO_PUBLIC_USE_DOC_MOCK=true.
 *
 * Will move to: app/src/services/routing/doctrails/__mocks__/MockDOCTrailsServer.ts
 */

import wellington from '../fixtures/nz-trails/wellington-cuba-st.geojson' with { type: 'json' };
import tongariro from '../fixtures/nz-trails/tongariro-crossing.geojson' with { type: 'json' };
import kepler from '../fixtures/nz-trails/kepler-track.geojson' with { type: 'json' };
import mtVic from '../fixtures/nz-trails/mt-vic.geojson' with { type: 'json' };
import auckland from '../fixtures/nz-trails/auckland-cbd.geojson' with { type: 'json' };
import mtTaranaki from '../fixtures/nz-trails/mt-taranaki-gap.geojson' with { type: 'json' };

interface BBox {
  west: number;  // lng min
  south: number; // lat min
  east: number;  // lng max
  north: number; // lat max
}

interface Feature {
  type: 'Feature';
  geometry: { type: 'LineString' | 'MultiLineString'; coordinates: number[][] | number[][][] };
  properties: Record<string, any>;
}

interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
  crs?: any;
}

const FIXTURES: Array<{ name: string; bbox: BBox; data: FeatureCollection }> = [
  { name: 'wellington-cuba-st', bbox: { west: 174.770, south: -41.300, east: 174.790, north: -41.280 }, data: wellington as FeatureCollection },
  { name: 'tongariro-crossing', bbox: { west: 175.55, south: -39.20, east: 175.75, north: -39.10 }, data: tongariro as FeatureCollection },
  { name: 'kepler-track', bbox: { west: 167.60, south: -45.45, east: 167.70, north: -45.35 }, data: kepler as FeatureCollection },
  { name: 'mt-vic', bbox: { west: 174.78, south: -41.30, east: 174.79, north: -41.29 }, data: mtVic as FeatureCollection },
  { name: 'auckland-cbd', bbox: { west: 174.755, south: -36.860, east: 174.770, north: -36.840 }, data: auckland as FeatureCollection },
  { name: 'mt-taranaki-gap', bbox: { west: 174.05, south: -39.30, east: 174.10, north: -39.25 }, data: mtTaranaki as FeatureCollection },
];

/**
 * Match a request bbox to the closest fixture (lng/lat overlap).
 * Returns null if no fixture overlaps.
 */
function findMatchingFixture(reqBbox: BBox): FeatureCollection | null {
  for (const f of FIXTURES) {
    // Overlap test
    const overlaps =
      reqBbox.west < f.bbox.east &&
      reqBbox.east > f.bbox.west &&
      reqBbox.south < f.bbox.north &&
      reqBbox.north > f.bbox.south;
    if (overlaps) {
      // Filter features whose geometry intersects request bbox
      const filtered = f.data.features.filter(feat => {
        const coords = (feat.geometry.type === 'LineString'
          ? feat.geometry.coordinates as number[][]
          : (feat.geometry.coordinates as number[][][]).flat());
        return coords.some(([lng, lat]) =>
          lng >= reqBbox.west && lng <= reqBbox.east &&
          lat >= reqBbox.south && lat <= reqBbox.north);
      });
      return { type: 'FeatureCollection', features: filtered, crs: f.data.crs };
    }
  }
  return null;
}

/**
 * Failure injection scenarios (for resilience testing).
 */
type FailureMode =
  | 'none'
  | 'timeout'      // never resolve
  | 'http-500'    // server error
  | 'http-429'    // rate limit
  | 'partial-data'// truncated response
  | 'slow-1mbps'; // throttle (delay proportional to size)

let currentFailureMode: FailureMode = 'none';

export function setFailureMode(mode: FailureMode): void {
  currentFailureMode = mode;
}

/**
 * Simulate a DOC API query.
 *
 * @param bbox  geometry bbox (esriGeometryEnvelope, EPSG:4326)
 * @returns FeatureCollection (or throws / delays based on failure mode)
 */
export async function mockDOCQuery(bbox: BBox): Promise<FeatureCollection> {
  // Inject failure
  switch (currentFailureMode) {
    case 'timeout':
      await new Promise(() => {}); // never resolves
      break;
    case 'http-500':
      throw new Error('MockDOC: 500 Internal Server Error');
    case 'http-429':
      throw Object.assign(new Error('MockDOC: 429 Too Many Requests'), { status: 429, retryAfter: 60 });
    case 'partial-data':
      // Return half features
      const half = findMatchingFixture(bbox);
      if (!half) return { type: 'FeatureCollection', features: [] };
      return { ...half, features: half.features.slice(0, Math.floor(half.features.length / 2)) };
    case 'slow-1mbps':
      const data = findMatchingFixture(bbox);
      if (!data) return { type: 'FeatureCollection', features: [] };
      // Estimate response size, throttle to 1Mbps + 500ms RTT
      const sizeBytes = JSON.stringify(data).length;
      const transferMs = (sizeBytes * 8) / 1_000_000 * 1000;
      const delayMs = 500 + transferMs;
      await new Promise(r => setTimeout(r, delayMs));
      return data;
  }

  // Normal path: 50-200ms latency simulation
  const baseLatency = 50 + Math.random() * 150;
  await new Promise(r => setTimeout(r, baseLatency));

  return findMatchingFixture(bbox) ?? { type: 'FeatureCollection', features: [] };
}

/**
 * Test fixtures registry — for unit test imports.
 */
export const FIXTURES_REGISTRY = FIXTURES.map(({ name, bbox }) => ({ name, bbox }));
