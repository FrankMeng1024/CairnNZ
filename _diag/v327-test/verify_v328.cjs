const { buildGlobalFog } = require('C:\\temp\\zelda-test\\globalFogBuilder.js');
const h3 = require('C:\\temp\\h3pure-test\\h3Pure.js').default;
const fs = require('fs');

// Simulate exact user scenario: 582 GPS points + initial reveal 500m circle (~700 hex-grid pts)
// Use actual recordCircleUnlock logic: 40m hex spacing, 500m radius
const RES_METERS = 25;

const cells = new Map();

// Real GPS walk
let lat=31.232, lng=121.457;
for (let i=0; i<582; i++) {
  lat += (Math.random()-0.5)*0.0006;
  lng += (Math.random()-0.5)*0.0006;
  const id = h3.latLngToCell(lat, lng, 11);
  if (!cells.has(id)) cells.set(id, { first: Date.now(), last: Date.now(), count: 1 });
}
console.log('cells from GPS walk:', cells.size);

// performInitialRevealIfNeeded: 500m radius hex-grid centered at user
const centerLat = 31.232, centerLng = 121.457;
const hexSpacing = 20;
const rowStep = hexSpacing * Math.sqrt(3) / 2;
const requestedRadius = 500;
const radiusSq = requestedRadius * requestedRadius;
const dLatPerM = 1 / 111_000;
const cosLat = Math.cos((centerLat*Math.PI)/180);
const dLngPerM = dLatPerM / Math.max(cosLat, 1e-6);
const rowsHalf = Math.ceil(requestedRadius / rowStep);
const colsHalf = Math.ceil(requestedRadius / hexSpacing);
let addedFromReveal = 0;
for (let row=-rowsHalf; row<=rowsHalf; row++) {
  const dy = row * rowStep;
  const rowOffset = (row & 1) === 0 ? 0 : hexSpacing/2;
  for (let col=-colsHalf; col<=colsHalf; col++) {
    const dx = col*hexSpacing + rowOffset;
    if (dx*dx + dy*dy > radiusSq) continue;
    const pLat = centerLat + dy*dLatPerM;
    const pLng = centerLng + dx*dLngPerM;
    const id = h3.latLngToCell(pLat, pLng, 11);
    if (!cells.has(id)) { cells.set(id, { first: Date.now(), last: Date.now(), count: 1 }); addedFromReveal++; }
  }
}
console.log('cells from 500m reveal hex grid:', addedFromReveal);
console.log('total visited cells:', cells.size);

// Build fog
const t0 = Date.now();
const { feature, perf } = buildGlobalFog(cells);
console.log('buildGlobalFog:', Date.now()-t0, 'ms, perf:', perf);

// Render at user's actual viewport zoom
const bounds={west:centerLng-0.012, east:centerLng+0.012, north:centerLat+0.020, south:centerLat-0.020};
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
fs.writeFileSync('v328-fog.svg', svg);
console.log('rendered v328-fog.svg');
