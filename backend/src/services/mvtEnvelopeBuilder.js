/**
 * mvtEnvelopeBuilder — server-side junction extraction from Mapbox Vector Tiles.
 *
 * Cairn EditEnvelope (v224). Replaces on-device extractor that OOM'd 4
 * times. Spike validated 5 cities (Shanghai/NYC/Tokyo/NZ/Auckland):
 *   - 5KB-200KB per tile fetch
 *   - 0-30ms decode in Node
 *   - 1-378 junctions per tile depending on density
 *
 * Pipeline:
 *   1. padBboxKm(routePoints, 1.5)
 *   2. bboxToTiles → list of (z14, x, y)
 *   3. Parallel fetchTile + decode each
 *   4. For each `road` LineString, project tile-pixel coords → lng/lat
 *   5. Filter ways far from route polyline (perpendicular > 1km)
 *   6. Fingerprint vertices at 5dp (~1.1m) and find degree>=3 junctions
 *   7. Build WayLite + JunctionLite arrays
 *
 * @module mvtEnvelopeBuilder
 */
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf');
const {
  fetchTile,
  bboxToTiles,
  tileToBbox,
  tilePixelToLngLat,
  padBboxKm,
} = require('./mvtTileFetch');

const ZOOM = 14;
const PAD_KM_DEFAULT = 1.5;
const FP_PRECISION = 5; // ~1.1m
const MIN_JUNCTION_DEGREE = 3;
const ROUTE_CORRIDOR_M = 1500; // keep ways within 1.5km of route polyline (slightly > pad)
const MAX_WAYS = 1500;

// Mapbox Streets v8 `class` values to drop (high-speed / non-walkable)
const EXCLUDED_CLASSES = new Set([
  'motorway',
  'motorway_link',
  'trunk',
  'trunk_link',
  'ferry',
  'aerialway',
  'major_rail',
  'minor_rail',
  'service_rail',
  'construction',
]);

function haversineM(a, b) {
  const R = 6_371_000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/**
 * Approximate point-to-polyline minimum distance (meters).
 * Cheap equirectangular at midpoint — accurate to ~1m at city scale.
 */
function pointToPolylineDistM(p, polyline) {
  if (polyline.length < 2) return Infinity;
  let best = Infinity;
  const midLat = polyline[Math.floor(polyline.length / 2)].lat;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const M = 111000;
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1];
    const b = polyline[i];
    const ax = a.lng * cosLat * M;
    const ay = a.lat * M;
    const bx = b.lng * cosLat * M;
    const by = b.lat * M;
    const px = p.lng * cosLat * M;
    const py = p.lat * M;
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-9) {
      const ddx = px - ax;
      const ddy = py - ay;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < best) best = d;
      continue;
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const fx = ax + t * dx;
    const fy = ay + t * dy;
    const ex = px - fx;
    const ey = py - fy;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Decode one tile's road layer to LngLat-space LineStrings.
 * Returns: Array<{ id, klass, coords: [{lng,lat}], featureBbox }>
 */
function decodeTileRoadFeatures(buf, z, x, y) {
  if (!buf || buf.length === 0) return [];
  const tile = new VectorTile(new Pbf(buf));
  const layer = tile.layers.road;
  if (!layer) return [];
  const bbox = tileToBbox(z, x, y);
  const out = [];
  for (let i = 0; i < layer.length; i++) {
    const f = layer.feature(i);
    const klass = f.properties && f.properties.class;
    if (!klass || EXCLUDED_CLASSES.has(klass)) continue;
    const geom = f.loadGeometry(); // Array<Array<{x,y}>>
    for (let r = 0; r < geom.length; r++) {
      const ring = geom[r];
      if (!ring || ring.length < 2) continue;
      const coords = [];
      for (let p = 0; p < ring.length; p++) {
        const ll = tilePixelToLngLat(ring[p].x, ring[p].y, layer.extent, bbox);
        coords.push(ll);
      }
      const id = `way_${z}_${x}_${y}_${f.id != null ? f.id : i}_${r}`;
      out.push({ id, klass, coords });
    }
  }
  return out;
}

/**
 * Build the EditEnvelope from a route's points.
 *
 * @param {Object} args
 * @param {string|number} args.routeId
 * @param {Array<{lng:number, lat:number}>} args.routePoints
 * @param {number} [args.padKm]
 * @returns {Promise<EditEnvelope>}
 */
async function buildEnvelope(args) {
  const { routeId, routePoints } = args;
  const padKm = args.padKm != null ? args.padKm : PAD_KM_DEFAULT;
  if (!Array.isArray(routePoints) || routePoints.length < 2) {
    throw new Error('routePoints must have >= 2 points');
  }

  const t0 = Date.now();
  const bbox = padBboxKm(routePoints, padKm);
  const tiles = bboxToTiles(bbox, ZOOM);

  // Cap tile count to avoid pathological 30km routes blowing up. ~50 tiles
  // covers 30km at z14 (~620m × ~470m per tile at midlat). Beyond this we
  // accept reduced coverage rather than fail.
  const TILE_CAP = 60;
  const tilesToFetch = tiles.slice(0, TILE_CAP);

  // Parallel fetch + decode
  const decodedPerTile = await Promise.all(
    tilesToFetch.map(async t => {
      const buf = await fetchTile(t.z, t.x, t.y);
      return decodeTileRoadFeatures(buf, t.z, t.x, t.y);
    }),
  );

  // Flatten + filter to corridor
  const allWays = [];
  let rawFeatureCount = 0;
  let rawVertexCount = 0;
  for (const features of decodedPerTile) {
    rawFeatureCount += features.length;
    for (const f of features) {
      rawVertexCount += f.coords.length;
      // cheap pre-filter: at least one vertex of the way within corridor
      let inCorridor = false;
      for (let i = 0; i < f.coords.length; i++) {
        if (pointToPolylineDistM(f.coords[i], routePoints) <= ROUTE_CORRIDOR_M) {
          inCorridor = true;
          break;
        }
      }
      if (inCorridor) allWays.push(f);
    }
  }

  // Subsample if too many ways (preserve representative coverage)
  let waysSubsampled = false;
  let waysOut = allWays;
  if (allWays.length > MAX_WAYS) {
    waysSubsampled = true;
    const step = Math.ceil(allWays.length / MAX_WAYS);
    waysOut = allWays.filter((_, i) => i % step === 0);
  }

  // Fingerprint pass — find junction vertices
  const fpMap = new Map();
  for (const w of waysOut) {
    for (let i = 0; i < w.coords.length; i++) {
      const c = w.coords[i];
      const lng5 = Math.round(c.lng * 1e5) / 1e5;
      const lat5 = Math.round(c.lat * 1e5) / 1e5;
      const fp = `${lng5}_${lat5}`;
      let entry = fpMap.get(fp);
      if (!entry) {
        entry = { lng: lng5, lat: lat5, ways: new Set() };
        fpMap.set(fp, entry);
      }
      entry.ways.add(w.id);
    }
  }

  const junctions = [];
  for (const [fp, entry] of fpMap) {
    if (entry.ways.size >= MIN_JUNCTION_DEGREE) {
      junctions.push({
        id: `j_${fp}`,
        lng: entry.lng,
        lat: entry.lat,
        degree: entry.ways.size,
        wayIds: Array.from(entry.ways).slice(0, 12),
      });
    }
  }

  const extractMs = Date.now() - t0;
  const bboxAreaKm2 =
    (bbox.east - bbox.west) *
    (bbox.north - bbox.south) *
    111 *
    111 *
    Math.cos((((bbox.north + bbox.south) / 2) * Math.PI) / 180);

  return {
    version: 1,
    routeId: String(routeId),
    bbox,
    padKm,
    source: 'mapbox-mvt',
    generatedAt: Date.now(),
    generatorV: 1,
    ways: waysOut.map(w => ({
      id: w.id,
      coords: w.coords,
      klass: w.klass,
    })),
    junctions,
    diagnostics: {
      rawFeatureCount,
      rawVertexCount,
      extractMs,
      bboxAreaKm2,
      waysAfterSubsample: waysOut.length,
      waysSubsampled,
      tilesRequested: tilesToFetch.length,
      tilesTotal: tiles.length,
    },
  };
}

module.exports = { buildEnvelope };
