// Visual verify: render the FIXED h3Pure output as PNG via per-cell rectangles.
// Compare against snap-184 to verify no triangle artifacts.

const path = require('path');
const fs = require('fs');
const h3Mod = require('C:\\temp\\h3pure-test\\h3Pure.js');
const h3 = h3Mod.default || h3Mod.h3 || h3Mod;

console.log('exports:', Object.keys(h3Mod));
console.log('polygonToCells type:', typeof h3.polygonToCells);
console.log('cellsToMultiPolygon type:', typeof h3.cellsToMultiPolygon);

// Reproduce user's scenario: Shanghai 静安, 70 scattered 3x3 visited blobs
const centerLat=31.235, centerLng=121.460;
const halfDegLng=0.005, halfDegLat=0.003;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const viewRing=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

const res = 11;
const all = h3.polygonToCells([viewRing], res, true);
console.log('viewport cells:', all.length);

// scatter visited
const visited = new Set();
let s = 1234;
const rng = () => (s = (s*16807) % 2147483647) / 2147483647;
const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };
const METERS_PER_DEG_LAT = 111_320;
function cellDegLat(r) { return RES_METERS[r] / METERS_PER_DEG_LAT; }
function cosLatSafe(lat) { return Math.max(0.1, Math.cos((lat*Math.PI)/180)); }
function cellDegLng(r, anchorLat) { return RES_METERS[r] / (METERS_PER_DEG_LAT * cosLatSafe(anchorLat)); }
const dLat = cellDegLat(res);
for (let i=0; i<70; i++) {
  const lat = bounds.south + rng() * (bounds.north - bounds.south);
  const lng = bounds.west + rng() * (bounds.east - bounds.west);
  const iy = Math.floor(lat/dLat);
  const anchorLat=(iy+0.5)*dLat;
  const dLng = cellDegLng(res, anchorLat);
  const ix = Math.floor(lng/dLng);
  for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) visited.add(`${res}:${ix+dx}:${iy+dy}`);
}
const unvisited = all.filter(c => !visited.has(c));
console.log(`visited=${visited.size} unvisited=${unvisited.length}`);

const polys = h3.cellsToMultiPolygon(unvisited, true);
console.log('polys count:', polys.length);
// Verify all clean rings
const histo = {};
let tinyCount = 0;
for (const p of polys) {
  for (const r of p) {
    histo[r.length] = (histo[r.length]||0)+1;
    if (r.length <= 4) tinyCount++;
  }
}
console.log('ring-size histogram:', histo);
console.log(`tiny rings (<=4): ${tinyCount}`);
console.log(tinyCount === 0 ? '✅ NO TRIANGLE ARTIFACTS' : '❌ TRIANGLES STILL PRESENT');

// Render to SVG/PNG for visual inspection
const px = 1290, py = 2796;
const projX = lng => Math.round((lng-bounds.west)/(bounds.east-bounds.west)*px);
const projY = lat => Math.round((1-(lat-bounds.south)/(bounds.north-bounds.south))*py);

const svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}"><rect width="100%" height="100%" fill="#f5efe1"/>`];
for (const poly of polys) {
  for (const ring of poly) {
    const d = ring.map(([lng,lat],i)=>`${i===0?'M':'L'}${projX(lng)},${projY(lat)}`).join(' ')+' Z';
    svgParts.push(`<path d="${d}" fill="rgba(58,42,24,0.58)" stroke="rgba(247,242,229,0.55)" stroke-width="1.5"/>`);
  }
}
svgParts.push('</svg>');
fs.writeFileSync('fixed-output.svg', svgParts.join('\n'));
console.log('saved fixed-output.svg');
