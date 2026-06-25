// Prove the latLngToCell vs polygonToCells anchor inconsistency
const h3Mod = require('C:\\temp\\h3pure-test\\h3Pure.js');
const h3 = h3Mod.default;

// User in Shanghai 静安, lat=31.235, lng=121.460 area
// Walking creates GPS points each calling latLngToCell at res 11
const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };
const METERS_PER_DEG_LAT = 111_320;

const res = 11;
const dLat = RES_METERS[res] / METERS_PER_DEG_LAT;

// Simulate a walk: 50 sequential points moving N-E
const visited = new Set();
const walkPoints = [];
let lat = 31.230, lng = 121.455;
for (let i=0; i<50; i++) {
  lat += 0.00005;  // step ~5.5m north
  lng += 0.00005;  // step ~5m east at this lat
  const cell = h3.latLngToCell(lat, lng, res);
  walkPoints.push({lat, lng, cell});
  visited.add(cell);
}
console.log(`Walk: 50 points → ${visited.size} unique cells`);

// Now compute viewport cells via polygonToCells (this is what fog rendering uses)
const halfDegLng=0.003, halfDegLat=0.003;
const cLat = 31.232, cLng = 121.457;
const bounds={west:cLng-halfDegLng, east:cLng+halfDegLng, north:cLat+halfDegLat, south:cLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];
const viewport = h3.polygonToCells([ring], res, true);
console.log(`Viewport cells via polygonToCells: ${viewport.length}`);

// CRITICAL TEST: are ANY of the walk cells in the viewport set?
const viewportSet = new Set(viewport);
const matches = walkPoints.filter(p => viewportSet.has(p.cell));
const cellsBoth = [...visited].filter(c => viewportSet.has(c));
console.log(`\nWalk points whose cell is also in viewport: ${matches.length}/${walkPoints.length}`);
console.log(`Unique visited cells also in viewport: ${cellsBoth.length}/${visited.size}`);

if (cellsBoth.length === 0) {
  console.log('\n🚨 BUG CONFIRMED — visited cells NEVER match viewport cells');
}

// Show example: take one walk point, see what cell it gets, and what cell polygonToCells would give for the same lat/lng
const p = walkPoints[0];
console.log(`\nExample walk point: lat=${p.lat.toFixed(6)} lng=${p.lng.toFixed(6)} → cellID=${p.cell}`);
// Reconstruct what cell polygonToCells would assign at this lat/lng position
const iy = Math.floor(p.lat / dLat);
const rowAnchorLat = (iy + 0.5) * dLat;
const cosRowLat = Math.max(0.1, Math.cos((rowAnchorLat * Math.PI)/180));
const dLngRow = RES_METERS[res] / (METERS_PER_DEG_LAT * cosRowLat);
const ixViaPolygon = Math.floor(p.lng / dLngRow);

// vs latLngToCell uses own-lat as anchor:
//   iy = floor(lat/dLat), anchorLat = (iy+0.5)*dLat -> dLng -> ix = floor(lng/dLng)
// These should be the same! Let's check.
console.log(`  polygonToCells would assign: cellID="${res}:${ixViaPolygon}:${iy}"`);
console.log(`  latLngToCell assigned:        cellID="${p.cell}"`);

// Actually inspect latLngToCell internals manually
const iy2 = Math.floor(p.lat / dLat);
const anchorLat2 = (iy2 + 0.5) * dLat;
const cosLat2 = Math.max(0.1, Math.cos((anchorLat2 * Math.PI)/180));
const dLng2 = RES_METERS[res] / (METERS_PER_DEG_LAT * cosLat2);
const ix2 = Math.floor(p.lng / dLng2);
console.log(`  manual reconstruction: iy=${iy2} ix=${ix2} dLng=${dLng2.toExponential(6)}`);

// Are visited cells "in viewport" via x/y RANGE compare?
console.log(`\nViewport cells x/y ranges:`);
const cellMin={ix:Infinity,iy:Infinity}, cellMax={ix:-Infinity,iy:-Infinity};
for (const c of viewport) {
  const parts = c.split(':');
  const ix = +parts[1], iy = +parts[2];
  if (ix<cellMin.ix) cellMin.ix=ix;
  if (ix>cellMax.ix) cellMax.ix=ix;
  if (iy<cellMin.iy) cellMin.iy=iy;
  if (iy>cellMax.iy) cellMax.iy=iy;
}
console.log(`  ix=[${cellMin.ix}..${cellMax.ix}] iy=[${cellMin.iy}..${cellMax.iy}]`);

console.log(`\nVisited cells x/y ranges:`);
const vMin={ix:Infinity,iy:Infinity}, vMax={ix:-Infinity,iy:-Infinity};
for (const c of visited) {
  const parts = c.split(':');
  const ix = +parts[1], iy = +parts[2];
  if (ix<vMin.ix) vMin.ix=ix;
  if (ix>vMax.ix) vMax.ix=ix;
  if (iy<vMin.iy) vMin.iy=iy;
  if (iy>vMax.iy) vMax.iy=iy;
}
console.log(`  ix=[${vMin.ix}..${vMax.ix}] iy=[${vMin.iy}..${vMax.iy}]`);
