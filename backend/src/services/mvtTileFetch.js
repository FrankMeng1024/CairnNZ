/**
 * mvtTileFetch — Mapbox Vector Tile HTTP client.
 *
 * Cairn server-side helper for the EditEnvelope pipeline (v224).
 * Pure HTTP fetch + slippy-map math. No app deps. No DB.
 *
 * Token: MAPBOX_SERVER_TOKEN env var (server-side secret, separate from
 * EXPO_PUBLIC_MAPBOX_TOKEN baked into the app bundle).
 *
 * Tile endpoint: https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.mvt
 *
 * @module mvtTileFetch
 */
// v229 fix B2: only read MAPBOX_SERVER_TOKEN. Do NOT fall back to
// EXPO_PUBLIC_MAPBOX_TOKEN — that's the app-bundle var name, not
// readable from the backend process. The fallback just hides the
// "token not configured" error until the next Mapbox call fails.
const TOKEN = process.env.MAPBOX_SERVER_TOKEN;
const TILESET = 'mapbox.mapbox-streets-v8';
const TILE_FETCH_TIMEOUT_MS = 8000;

/**
 * Convert lng/lat to slippy tile (x, y) at given zoom.
 */
function lngLatToTile(lng, lat, z) {
  const n = 2 ** z;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y, z };
}

/**
 * Compute the WGS-84 bbox of a single tile.
 */
function tileToBbox(z, x, y) {
  const n = 2 ** z;
  const lng1 = (x / n) * 360 - 180;
  const lng2 = ((x + 1) / n) * 360 - 180;
  const lat1 = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const lat2 =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return { west: lng1, east: lng2, north: lat1, south: lat2 };
}

/**
 * Convert a tile-local pixel coordinate (0..extent) to lng/lat using the
 * tile's own bbox. extent is normally 4096 (Mapbox default).
 */
function tilePixelToLngLat(px, py, extent, bbox) {
  const lng = bbox.west + (px / extent) * (bbox.east - bbox.west);
  const lat = bbox.north + (py / extent) * (bbox.south - bbox.north);
  return { lng, lat };
}

/**
 * Compute the full set of (z, x, y) tiles needed to cover a bbox at a zoom.
 * Returns deduplicated, ordered top-left → bottom-right.
 */
function bboxToTiles(bbox, zoom) {
  const tl = lngLatToTile(bbox.west, bbox.north, zoom);
  const br = lngLatToTile(bbox.east, bbox.south, zoom);
  const tiles = [];
  for (let x = tl.x; x <= br.x; x++) {
    for (let y = tl.y; y <= br.y; y++) {
      tiles.push({ z: zoom, x, y });
    }
  }
  return tiles;
}

/**
 * Pad a route's bbox by N km (haversine approximation at midlat).
 */
function padBboxKm(points, padKm) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const p of points) {
    if (p.lng < west) west = p.lng;
    if (p.lng > east) east = p.lng;
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
  }
  const midLat = (south + north) / 2;
  const latPad = padKm / 111;
  const lngPad =
    padKm / (111 * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return {
    west: west - lngPad,
    east: east + lngPad,
    south: south - latPad,
    north: north + latPad,
  };
}

/**
 * Fetch a single .mvt tile as a Buffer. Returns null on 4xx/5xx after
 * one retry; throws only on token misconfiguration.
 */
async function fetchTile(z, x, y) {
  if (!TOKEN) {
    throw new Error('MAPBOX_SERVER_TOKEN not set');
  }
  const url = `https://api.mapbox.com/v4/${TILESET}/${z}/${x}/${y}.mvt?access_token=${TOKEN}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), TILE_FETCH_TIMEOUT_MS);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(t);
      if (!res.ok) {
        // 404 means no data for this tile (out of OSM coverage); not an error
        if (res.status === 404) return null;
        // 429/5xx — retry once
        if (attempt === 0 && (res.status === 429 || res.status >= 500)) continue;
        return null;
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (e) {
      if (attempt === 0) continue;
      return null;
    }
  }
  return null;
}

module.exports = {
  fetchTile,
  bboxToTiles,
  lngLatToTile,
  tileToBbox,
  tilePixelToLngLat,
  padBboxKm,
};
