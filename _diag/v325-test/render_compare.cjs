// Render V3 vs per-cell as SVG side-by-side for visual comparison
const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };
const METERS_PER_DEG_LAT = 111_320;
function cellDegLat(r) { return RES_METERS[r] / METERS_PER_DEG_LAT; }
function cosLatSafe(lat) { return Math.max(0.1, Math.cos((lat*Math.PI)/180)); }
function cellDegLng(r, anchorLat) { return RES_METERS[r] / (METERS_PER_DEG_LAT * cosLatSafe(anchorLat)); }
function encode(r,ix,iy){return `${r}:${ix}:${iy}`;}
function decode(c){const p=c.split(':');return {res:+p[0],ix:+p[1],iy:+p[2]};}

function polygonToCells(polygon, res) {
  const ring = polygon[0];
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for (const pt of ring) { const lng=pt[0],lat=pt[1]; if(lng<west)west=lng; if(lng>east)east=lng; if(lat<south)south=lat; if(lat>north)north=lat; }
  const dLat=cellDegLat(res);
  const iyMin=Math.floor(south/dLat), iyMax=Math.floor(north/dLat);
  const cells=[];
  for (let iy=iyMin; iy<=iyMax; iy++) {
    const anchorLat=(iy+0.5)*dLat;
    const dLng=cellDegLng(res,anchorLat);
    const ixMin=Math.floor(west/dLng), ixMax=Math.floor(east/dLng);
    for (let ix=ixMin; ix<=ixMax; ix++) cells.push(encode(res,ix,iy));
  }
  return cells;
}

// Per-cell (v325)
function perCell(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  const polys=[];
  for (const c of cells) {
    const d=decode(c);
    const anchorLat=(d.iy+0.5)*dLat;
    const dLng=cellDegLng(res,anchorLat);
    const south=d.iy*dLat, north=(d.iy+1)*dLat;
    const west=d.ix*dLng, east=(d.ix+1)*dLng;
    polys.push([[[west,south],[east,south],[east,north],[west,north],[west,south]]]);
  }
  return polys;
}

// V3 row-run
function rowRun(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  const rows = new Map();
  for (const c of cells) {
    const d=decode(c); if (d.res!==res) continue;
    if (!rows.has(d.iy)) rows.set(d.iy, []);
    rows.get(d.iy).push(d.ix);
  }
  const polys=[];
  for (const [iy, ixs] of rows) {
    ixs.sort((a,b)=>a-b);
    const dLng=cellDegLng(res, (iy+0.5)*dLat);
    const south=iy*dLat, north=(iy+1)*dLat;
    let runStart=ixs[0], runEnd=ixs[0];
    for (let i=1; i<=ixs.length; i++) {
      if (i<ixs.length && ixs[i]===runEnd+1) runEnd=ixs[i];
      else {
        const west=runStart*dLng, east=(runEnd+1)*dLng;
        polys.push([[[west,south],[east,south],[east,north],[west,north],[west,south]]]);
        if (i<ixs.length) { runStart=ixs[i]; runEnd=ixs[i]; }
      }
    }
  }
  return polys;
}

// Scenario: 582 walks in Shanghai
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

const res = 10;
const all = polygonToCells([ring], res);
const visited = new Set();
let s=1234; const rng=()=>(s=(s*16807)%2147483647)/2147483647;
const dLat = cellDegLat(res);
// 582 walk: a connected zigzag track in middle
let lat=centerLat-0.005, lng=centerLng-0.005;
for (let i=0; i<582; i++) {
  lat += (rng()-0.5)*0.0003;
  lng += (rng()-0.5)*0.0003;
  if (Math.abs(lat-centerLat)>0.01) lat = centerLat + (rng()-0.5)*0.01;
  if (Math.abs(lng-centerLng)>0.012) lng = centerLng + (rng()-0.5)*0.024;
  const iy=Math.floor(lat/dLat);
  const dLng=cellDegLng(res,(iy+0.5)*dLat);
  visited.add(encode(res,Math.floor(lng/dLng),iy));
}
const unvisited = all.filter(c=>!visited.has(c));

const polysPer = perCell(unvisited);
const polysRun = rowRun(unvisited);

const fs = require('fs');
const px=1290, py=2796;
const projX = lng => Math.round((lng-bounds.west)/(bounds.east-bounds.west)*px);
const projY = lat => Math.round((1-(lat-bounds.south)/(bounds.north-bounds.south))*py);

function renderSVG(polys, title) {
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">`,
    `<rect width="100%" height="100%" fill="#f5efe1"/>`,
    `<text x="20" y="50" font-size="40" font-family="Arial">${title} (${polys.length} polys)</text>`];
  for (const poly of polys) {
    for (const r of poly) {
      const d = r.map(([lng,lat],i)=>`${i===0?'M':'L'}${projX(lng)},${projY(lat)}`).join(' ')+' Z';
      parts.push(`<path d="${d}" fill="rgba(58,42,24,0.58)" stroke="rgba(247,242,229,0.55)" stroke-width="1.5"/>`);
    }
  }
  parts.push('</svg>');
  return parts.join('\n');
}

fs.writeFileSync('compare-per-cell.svg', renderSVG(polysPer, 'v325 per-cell'));
fs.writeFileSync('compare-row-run.svg', renderSVG(polysRun, 'v326 row-run'));
console.log(`per-cell: ${polysPer.length} polys → compare-per-cell.svg`);
console.log(`row-run:  ${polysRun.length} polys → compare-row-run.svg`);
