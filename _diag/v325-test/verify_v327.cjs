// Verify v327 globalFogBuilder using compiled production code
const { buildGlobalFog } = require('C:\\temp\\zelda-test\\globalFogBuilder.js');
const h3 = require('C:\\temp\\h3pure-test\\h3Pure.js').default;
const fs = require('fs');

// 582 GPS points simulating user
const points = [];
let lat=31.232, lng=121.457;
for (let i=0; i<582; i++) {
  lat += (Math.random()-0.5)*0.0006;
  lng += (Math.random()-0.5)*0.0006;
  points.push([lng, lat]);
}

// Build visited cells map (mirrors useH3VisitedStore.addPointToCells)
const cells = new Map();
for (const [lng,lat] of points) {
  const id = h3.latLngToCell(lat, lng, 11);
  if (!cells.has(id)) cells.set(id, { first: Date.now(), last: Date.now(), count: 1 });
}
console.log('GPS points:', points.length, '→ unique cells:', cells.size);

const t0 = Date.now();
const { feature, perf } = buildGlobalFog(cells);
const t1 = Date.now();
console.log('buildGlobalFog:', t1-t0, 'ms, perf:', perf);
console.log('feature.geometry.coordinates rings:', feature.geometry.coordinates.length);
console.log('  outer ring verts:', feature.geometry.coordinates[0].length);
console.log('  hole sample verts:', feature.geometry.coordinates[1]?.length);
console.log('JSON size:', JSON.stringify(feature).length, 'chars');

// Render SVG at user's viewport for visual check (zoom ~14)
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const px=1290, py=2796;
const projX = lng => (lng-bounds.west)/(bounds.east-bounds.west)*px;
const projY = lat => (1-(lat-bounds.south)/(bounds.north-bounds.south))*py;

const coords = feature.geometry.coordinates;
let d = '';
for (const ring of coords) {
  d += 'M' + ring.map(([lng,lat])=>`${projX(lng).toFixed(2)},${projY(lat).toFixed(2)}`).join(' L') + ' Z ';
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">
  <rect width="100%" height="100%" fill="#e8dfc8"/>
  <path d="${d}" fill="rgba(58,42,24,0.78)" fill-rule="evenodd"/>
</svg>`;
fs.writeFileSync('zelda-v327-prod.svg', svg);
console.log('rendered zelda-v327-prod.svg');

// Also test zoomed-out (city-wide)
const bounds2={west:121.350, east:121.560, north:31.300, south:31.150};
const projX2 = lng => (lng-bounds2.west)/(bounds2.east-bounds2.west)*px;
const projY2 = lat => (1-(lat-bounds2.south)/(bounds2.north-bounds2.south))*py;
let d2 = '';
for (const ring of coords) {
  d2 += 'M' + ring.map(([lng,lat])=>`${projX2(lng).toFixed(2)},${projY2(lat).toFixed(2)}`).join(' L') + ' Z ';
}
const svg2 = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">
  <rect width="100%" height="100%" fill="#e8dfc8"/>
  <path d="${d2}" fill="rgba(58,42,24,0.78)" fill-rule="evenodd"/>
</svg>`;
fs.writeFileSync('zelda-v327-zoomed-out.svg', svg2);
console.log('rendered zelda-v327-zoomed-out.svg');
