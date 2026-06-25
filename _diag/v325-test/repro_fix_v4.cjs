// V4: full rectangle dissolve. Row-run + greedy vertical merge.
// Algorithm: maintain "active rectangles" from previous row, try to extend each into current row.
// If current row has SAME ix-range as an active rect, extend rect north. Else close it and start new.

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

function cellsToMultiPolygonV4(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);

  // Group by iy → sorted ixs
  const byRow = new Map();
  for (const c of cells) {
    const d=decode(c); if (d.res!==res) continue;
    if (!byRow.has(d.iy)) byRow.set(d.iy, []);
    byRow.get(d.iy).push(d.ix);
  }
  const sortedRows = [...byRow.keys()].sort((a,b)=>a-b);

  // Compute runs per row: Array<[startIx, endIx]>
  function rowRuns(iy) {
    const ixs = byRow.get(iy);
    ixs.sort((a,b)=>a-b);
    const runs = [];
    let s = ixs[0], e = ixs[0];
    for (let i=1; i<ixs.length; i++) {
      if (ixs[i] === e+1) e = ixs[i];
      else { runs.push([s,e]); s=ixs[i]; e=ixs[i]; }
    }
    runs.push([s,e]);
    return runs;
  }

  // Active rectangles: { startIx, endIx, iyStart, iyEnd } — iyEnd is row included
  const polygons = [];
  let active = [];  // sorted by startIx for fast search? keep simple — list

  function emitRect(rect) {
    const dLng = cellDegLng(res, (rect.iyStart + 0.5) * dLat);
    // NOTE: dLng can differ across iy, but for visual fog the row anchor at iyStart is the visible alignment.
    // For correctness we use a single dLng per rectangle from its start row (consistent with how addPointToCells works).
    const west = rect.startIx * dLng;
    const east = (rect.endIx + 1) * dLng;
    const south = rect.iyStart * dLat;
    const north = (rect.iyEnd + 1) * dLat;
    polygons.push([[
      [west, south], [east, south], [east, north], [west, north], [west, south]
    ]]);
  }

  let prevIy = null;
  for (const iy of sortedRows) {
    const runs = rowRuns(iy);
    if (prevIy !== null && iy !== prevIy + 1) {
      // gap row → close ALL active
      for (const a of active) emitRect(a);
      active = [];
    }
    // Match each run to active rect with SAME startIx/endIx
    const used = new Uint8Array(active.length);
    const newActive = [];
    for (const [s, e] of runs) {
      let matched = -1;
      for (let i=0; i<active.length; i++) {
        if (used[i]) continue;
        if (active[i].startIx === s && active[i].endIx === e) { matched = i; break; }
      }
      if (matched >= 0) {
        used[matched] = 1;
        active[matched].iyEnd = iy;
        newActive.push(active[matched]);
      } else {
        newActive.push({ startIx: s, endIx: e, iyStart: iy, iyEnd: iy });
      }
    }
    // Close unmatched active rects
    for (let i=0; i<active.length; i++) {
      if (!used[i]) emitRect(active[i]);
    }
    active = newActive;
    prevIy = iy;
  }
  for (const a of active) emitRect(a);

  return polygons;
}

// Test all scenarios
function test(label, opts) {
  const { centerLat, centerLng, halfDegLng, halfDegLat, blobs, blobSize, res } = opts;
  const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
  const viewRing=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];
  const all = polygonToCells([viewRing], res);
  const visited = new Set();
  let s = 1234;
  const rng = () => (s = (s*16807) % 2147483647) / 2147483647;
  const dLat = cellDegLat(res);
  for (let i=0; i<blobs; i++) {
    const lat = bounds.south + rng() * (bounds.north - bounds.south);
    const lng = bounds.west + rng() * (bounds.east - bounds.west);
    const iy = Math.floor(lat/dLat);
    const anchorLat=(iy+0.5)*dLat;
    const dLng = cellDegLng(res, anchorLat);
    const ix = Math.floor(lng/dLng);
    for (let dx=-blobSize;dx<=blobSize;dx++)
      for (let dy=-blobSize;dy<=blobSize;dy++) visited.add(encode(res,ix+dx,iy+dy));
  }
  const unvisited = all.filter(c=>!visited.has(c));
  const polys = cellsToMultiPolygonV4(unvisited);
  const histo = {};
  for (const p of polys) histo[p[0].length] = (histo[p[0].length]||0)+1;
  const tiny = polys.filter(p=>p[0].length<=4).length;
  console.log(`${label}: viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length}`);
  console.log(`  → ${polys.length} polys, histo=`, histo, ` tiny=${tiny} ${tiny===0?'✅':'❌'}`);
}

console.log('=== V4: row-run + vertical merge ===');
test('scattered 70 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:70, blobSize:1, res:11 });
test('582 walks res=10', { centerLat:31.232, centerLng:121.457, halfDegLng:0.012, halfDegLat:0.020, blobs:180, blobSize:0, res:10 });
test('all unvisited res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:0, blobSize:1, res:11 });
test('sparse 5 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:5, blobSize:1, res:11 });

// Visual render
const fs = require('fs');
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];
const visited = new Set();
let s=1234; const rng=()=>(s=(s*16807)%2147483647)/2147483647;
const dLat = cellDegLat(10);
let lat=centerLat-0.005, lng=centerLng-0.005;
for (let i=0; i<582; i++) {
  lat += (rng()-0.5)*0.0003;
  lng += (rng()-0.5)*0.0003;
  if (Math.abs(lat-centerLat)>0.01) lat = centerLat + (rng()-0.5)*0.01;
  if (Math.abs(lng-centerLng)>0.012) lng = centerLng + (rng()-0.5)*0.024;
  const iy=Math.floor(lat/dLat);
  const dLng=cellDegLng(10,(iy+0.5)*dLat);
  visited.add(encode(10,Math.floor(lng/dLng),iy));
}
const all10 = polygonToCells([ring], 10);
const unvisited10 = all10.filter(c=>!visited.has(c));
const polys = cellsToMultiPolygonV4(unvisited10);

const px=1290, py=2796;
const projX = lng => Math.round((lng-bounds.west)/(bounds.east-bounds.west)*px);
const projY = lat => Math.round((1-(lat-bounds.south)/(bounds.north-bounds.south))*py);
const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${py}" viewBox="0 0 ${px} ${py}">`,
  `<rect width="100%" height="100%" fill="#f5efe1"/>`,
  `<text x="20" y="50" font-size="40" font-family="Arial">v4 (${polys.length} polys)</text>`];
for (const poly of polys) {
  for (const r of poly) {
    const d = r.map(([lng,lat],i)=>`${i===0?'M':'L'}${projX(lng)},${projY(lat)}`).join(' ')+' Z';
    parts.push(`<path d="${d}" fill="rgba(58,42,24,0.58)" stroke="rgba(247,242,229,0.55)" stroke-width="1.5"/>`);
  }
}
parts.push('</svg>');
fs.writeFileSync('compare-v4.svg', parts.join('\n'));
console.log(`\nrendered ${polys.length} polys to compare-v4.svg`);
