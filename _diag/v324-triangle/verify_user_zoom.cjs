// Visual verify at user's actual zoom (res 10)
const h3Mod = require('C:\\temp\\h3pure-test\\h3Pure.js');
const h3 = h3Mod.default;
const fs = require('fs');

// User snap-184 viewport ≈ 1.5km × 3.5km (showed multiple districts)
// At lat 31.235, that's roughly halfDegLat=0.017, halfDegLng=0.012
const centerLat=31.235, centerLng=121.460;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const viewRing=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

// Test at res 9 and res 10 (user's zoom band)
for (const res of [9, 10]) {
  const all = h3.polygonToCells([viewRing], res, true);
  // 573 GPS points → maybe 40-100 unique cells at res 10/11
  const visited = new Set();
  let s = 5555;
  const rng = () => (s = (s*16807) % 2147483647) / 2147483647;
  const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };
  const dLat = RES_METERS[res] / 111_320;
  for (let i=0; i<50; i++) {
    const lat = bounds.south + rng() * (bounds.north - bounds.south);
    const lng = bounds.west + rng() * (bounds.east - bounds.west);
    const iy = Math.floor(lat/dLat);
    const anchorLat=(iy+0.5)*dLat;
    const cosLat = Math.max(0.1, Math.cos((anchorLat*Math.PI)/180));
    const dLng = RES_METERS[res] / (111_320 * cosLat);
    const ix = Math.floor(lng/dLng);
    visited.add(`${res}:${ix}:${iy}`);
  }
  const unvisited = all.filter(c=>!visited.has(c));
  const polys = h3.cellsToMultiPolygon(unvisited, true);
  let tiny=0; const histo={};
  for (const p of polys) for (const r of p) { histo[r.length]=(histo[r.length]||0)+1; if (r.length<=4) tiny++; }
  console.log(`res ${res}: viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length} polys=${polys.length} histo=`, histo, `tiny=${tiny}`);
}
