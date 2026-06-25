const h3 = require('C:\\temp\\h3pure-test\\h3Pure.js').default;
const fs = require('fs');

// Same 582-walk scenario as user's snap-186
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

const visited = new Set();
let s=1234; const rng=()=>(s=(s*16807)%2147483647)/2147483647;
let lat=centerLat-0.005, lng=centerLng-0.005;
for (let i=0; i<582; i++) {
  lat += (rng()-0.5)*0.0003;
  lng += (rng()-0.5)*0.0003;
  if (Math.abs(lat-centerLat)>0.01) lat = centerLat + (rng()-0.5)*0.01;
  if (Math.abs(lng-centerLng)>0.012) lng = centerLng + (rng()-0.5)*0.024;
  visited.add(h3.latLngToCell(lat, lng, 10));
}

const all = h3.polygonToCells([ring], 10, true);
const unvisited = all.filter(c=>!visited.has(c));
const polys = h3.cellsToMultiPolygon(unvisited, true);
console.log(`viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length} polys=${polys.length}`);

const px=1290, py=2796;
const projX = lng => Math.round((lng-bounds.west)/(bounds.east-bounds.west)*px);
const projY = lat => Math.round((1-(lat-bounds.south)/(bounds.north-bounds.south))*py);

const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">`,
  `<rect width="100%" height="100%" fill="#f5efe1"/>`];
for (const poly of polys) {
  for (const r of poly) {
    const d = r.map(([lng,lat],i)=>`${i===0?'M':'L'}${projX(lng)},${projY(lat)}`).join(' ')+' Z';
    parts.push(`<path d="${d}" fill="rgba(58,42,24,0.58)" stroke="rgba(247,242,229,0.55)" stroke-width="1.5"/>`);
  }
}
parts.push(`<text x="20" y="50" font-size="40" font-family="Arial">v326: ${polys.length} polys</text>`);
parts.push('</svg>');
fs.writeFileSync('v326-prod.svg', parts.join('\n'));
console.log('rendered v326-prod.svg');
