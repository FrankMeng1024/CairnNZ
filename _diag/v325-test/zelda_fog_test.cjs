// v327 architecture: 全球 fog + visited cells 作为 holes
// 不需要 turf, 不需要 union. 纯几何.

const h3 = require('C:\\temp\\h3pure-test\\h3Pure.js').default;
const fs = require('fs');

// 582 GPS points
const points = [];
let lat=31.232, lng=121.457;
for (let i=0; i<582; i++) {
  lat += (Math.random()-0.5)*0.0006;
  lng += (Math.random()-0.5)*0.0006;
  points.push([lng, lat]);
}
console.log('GPS points:', points.length);

// Convert to res 11 cells (always res 11, no zoom adaptation)
const t0 = Date.now();
const visitedCells = new Set();
for (const [lng,lat] of points) {
  visitedCells.add(h3.latLngToCell(lat, lng, 11));
}
const t1 = Date.now();
console.log('unique visited cells:', visitedCells.size, 'in', t1-t0, 'ms');

// Build the fog feature: one big polygon with holes
// Outer ring: huge bbox covering global (or current viewport with big padding)
// Holes: one rectangular ring per visited cell

const t2 = Date.now();
const outerWest = -180, outerEast = 180, outerSouth = -85, outerNorth = 85;
// Outer ring CCW (Mapbox: actually we want CW outer + CCW hole, or vice versa; both work for even-odd)
const outerRing = [
  [outerWest, outerSouth],
  [outerEast, outerSouth],
  [outerEast, outerNorth],
  [outerWest, outerNorth],
  [outerWest, outerSouth],
];

// Holes
const holes = [];
const RES_METERS = 25;
const dLat = RES_METERS / 111_320;
for (const cell of visitedCells) {
  const parts = cell.split(':');
  const ix = +parts[1], iy = +parts[2];
  const south = iy*dLat;
  const north = (iy+1)*dLat;
  const anchorLat = (iy+0.5)*dLat;
  const cosLat = Math.max(0.1, Math.cos((anchorLat*Math.PI)/180));
  const dLng = RES_METERS / (111_320 * cosLat);
  const west = ix*dLng;
  const east = (ix+1)*dLng;
  // Hole ring CW (reverse of outer)
  holes.push([
    [west, south],
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]);
}
const t3 = Date.now();
console.log('built fog feature:', t3-t2, 'ms,', holes.length, 'holes');

const fogFeature = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [outerRing, ...holes],
  },
};

console.log('GeoJSON size:', JSON.stringify(fogFeature).length, 'chars');

// Render SVG for visual verification at user's viewport zoom
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};

const px=1290, py=2796;
const projX = lng => (lng-bounds.west)/(bounds.east-bounds.west)*px;
const projY = lat => (1-(lat-bounds.south)/(bounds.north-bounds.south))*py;

// SVG with even-odd fill
let svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">`,
  `<rect width="100%" height="100%" fill="#e8dfc8"/>`];

// Compose path with outer + all holes, fill-rule evenodd
let d = '';
// outer ring path
d += 'M' + projX(outerWest) + ',' + projY(outerSouth) + ' ';
d += 'L' + projX(outerEast) + ',' + projY(outerSouth) + ' ';
d += 'L' + projX(outerEast) + ',' + projY(outerNorth) + ' ';
d += 'L' + projX(outerWest) + ',' + projY(outerNorth) + ' Z ';
for (const hole of holes) {
  d += 'M' + hole.map(([lng,lat])=>`${projX(lng)},${projY(lat)}`).join(' L') + ' Z ';
}
svgParts.push(`<path d="${d}" fill="rgba(58,42,24,0.78)" fill-rule="evenodd"/>`);
svgParts.push('</svg>');
fs.writeFileSync('zelda-fog-test.svg', svgParts.join('\n'));
console.log('rendered zelda-fog-test.svg');
