// Test partial-unvisited scenarios — what algorithm does when some cells are gone
import { readFileSync, writeFileSync } from 'fs';

const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };
const METERS_PER_DEG_LAT = 111_320;
function metersForRes(r) { return RES_METERS[r] ?? 25; }
function cosLatSafe(lat) { return Math.max(0.1, Math.cos((lat*Math.PI)/180)); }
function cellDegLat(r) { return metersForRes(r) / METERS_PER_DEG_LAT; }
function cellDegLng(r, anchorLat) { return metersForRes(r) / (METERS_PER_DEG_LAT * cosLatSafe(anchorLat)); }
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

function cellsToMultiPolygon(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  const rows=new Map();
  for (const c of cells) {
    const d=decode(c); if (d.res!==res) continue;
    let row=rows.get(d.iy);
    if (!row) { const anchorLat=(d.iy+0.5)*dLat; row={ixs:new Set(),dLng:cellDegLng(res,anchorLat),anchorLat}; rows.set(d.iy,row); }
    row.ixs.add(d.ix);
  }
  const edges=[];
  for (const [iy,row] of rows) {
    const south=iy*dLat, north=(iy+1)*dLat;
    for (const ix of row.ixs) {
      const west=ix*row.dLng, east=(ix+1)*row.dLng;
      const sw=[west,south],se=[east,south],ne=[east,north],nw=[west,north];
      const southRow=rows.get(iy-1);
      if (!southRow || !southRow.ixs.has(ix)) edges.push({from:sw,to:se});
      if (!row.ixs.has(ix+1)) edges.push({from:se,to:ne});
      const northRow=rows.get(iy+1);
      if (!northRow || !northRow.ixs.has(ix)) edges.push({from:ne,to:nw});
      if (!row.ixs.has(ix-1)) edges.push({from:nw,to:sw});
    }
  }
  const ptKey=p=>`${p[0]},${p[1]}`;
  const byFrom=new Map();
  let overwrites=0;
  for (const e of edges) {
    if (byFrom.has(ptKey(e.from))) overwrites++;
    byFrom.set(ptKey(e.from),e);
  }
  const used=new Set();
  const rings=[];
  for (const start of edges) {
    const sk=ptKey(start.from);
    if (used.has(sk)) continue;
    const ring=[];
    let cur=start; let safety=edges.length+8;
    while (cur && safety-- > 0) {
      const ck=ptKey(cur.from);
      if (used.has(ck)) break;
      used.add(ck); ring.push(cur.from);
      const nk=ptKey(cur.to);
      cur=byFrom.get(nk);
      if (cur && ptKey(cur.from)===ptKey(start.from)) { ring.push(cur.from); break; }
    }
    if (ring.length>=3) {
      const f=ring[0],l=ring[ring.length-1];
      if (f[0]!==l[0]||f[1]!==l[1]) ring.push([f[0],f[1]]);
      rings.push(ring);
    }
  }
  return { rings, overwrites, edgeCount: edges.length };
}

const centerLat=31.235, centerLng=121.460;
const halfDegLng=0.005, halfDegLat=0.003;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const viewRing=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

// At res 11 (zoom 16+) there are 1094 viewport cells.
// User has places_visited=573 → many GPS points → likely 50-100 cells visited at res 11.
// Simulate: take all 1094 viewport cells, remove ~50 of them in a roughly cross/walk pattern (user's track).
const all = polygonToCells([viewRing], 11);
console.log(`res 11 viewport cells: ${all.length}`);

// Walk track ≈ user walking ~500m E-W along the middle and ~300m N-S
const visited = new Set();
// E-W strip near middle
{
  const d=decode(all[0]); const dLat=cellDegLat(11);
  const midIy = Math.floor(centerLat/dLat);
  const midAnchor=(midIy+0.5)*dLat;
  const dLng=cellDegLng(11, midAnchor);
  const startIx=Math.floor((centerLng-0.002)/dLng);
  const endIx=Math.floor((centerLng+0.002)/dLng);
  for (let ix=startIx; ix<=endIx; ix++) {
    visited.add(encode(11, ix, midIy));
    visited.add(encode(11, ix, midIy+1));
    visited.add(encode(11, ix, midIy-1));
  }
}
const unvisited = all.filter(c => !visited.has(c));
console.log(`visited cells: ${visited.size}, unvisited: ${unvisited.length}`);

const result = cellsToMultiPolygon(unvisited);
const histogram = {};
for (const r of result.rings) histogram[r.length] = (histogram[r.length]||0)+1;
console.log(`rings produced: ${result.rings.length}, byFrom-collisions: ${result.overwrites}`);
console.log(`ring-size histogram (vertex count : count):`, histogram);

// Critical analysis — find the SHORT rings (3-4 vertex)
const tinyRings = result.rings.filter(r => r.length <= 5);
console.log(`tiny rings (<=5 vertices): ${tinyRings.length}`);
if (tinyRings.length) {
  console.log('first few tiny rings:');
  for (const r of tinyRings.slice(0,5)) console.log('  ', JSON.stringify(r));
}
// Long-ring count
const big = result.rings.filter(r => r.length > 5);
console.log(`big rings (>5 vertices): ${big.length}, largest=${Math.max(...big.map(r=>r.length))}`);

// Map output: each ring → its bounding box, render as PNG via simple Math
const allRings = result.rings;
// Project rings to pixel coords (1290x2796 viewport)
const px = 1290, py = 2796;
const projX = lng => Math.round((lng - bounds.west) / (bounds.east - bounds.west) * px);
const projY = lat => Math.round((1 - (lat - bounds.south) / (bounds.north - bounds.south)) * py);

// Pixel-area of tiny rings
console.log('\nRing pixel-area summary:');
const sizes = result.rings.map(r => {
  // Bounding box pixel size
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for (const [lng,lat] of r) { const x=projX(lng),y=projY(lat); if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
  return { verts: r.length, bbox_w: maxX-minX, bbox_h: maxY-minY };
});
sizes.sort((a,b)=>a.bbox_w - b.bbox_w);
console.log('smallest 10:', sizes.slice(0,10));
console.log('largest 5:', sizes.slice(-5));
