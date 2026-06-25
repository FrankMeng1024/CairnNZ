// Reproduction of h3Pure.cellsToMultiPolygon algorithm against a typical viewport.
// Mirrors the algorithm in app/src/features/memory/lib/h3Pure.ts (subagent-A hypothesis test).

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
  return { rings, overwrites, edgeCount: edges.length, byFromUniqueKeys: byFrom.size };
}

// Simulate a real Memory viewport at Shanghai 静安 area, zoom ~16.5 → res 11
// Half-degree extents matching estimateInitialBounds in MemoryMap
const centerLat=31.235, centerLng=121.460;
const halfDegLng=0.005, halfDegLat=0.003;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];

for (const res of [9, 10, 11]) {
  const cells = polygonToCells([ring], res);
  // Simulate "no visited" - all cells unvisited
  const out = cellsToMultiPolygon(cells);
  // Classify ring sizes
  const sizes = out.rings.map(r=>r.length);
  sizes.sort((a,b)=>a-b);
  const histogram = {};
  for (const s of sizes) histogram[s]=(histogram[s]||0)+1;
  // Compute lng-step-mismatch evidence
  const r0Anchor = (Math.floor(bounds.south/cellDegLat(res))+0.5)*cellDegLat(res);
  const r1Anchor = (Math.floor(bounds.south/cellDegLat(res))+1.5)*cellDegLat(res);
  const dLng0 = cellDegLng(res, r0Anchor);
  const dLng1 = cellDegLng(res, r1Anchor);
  console.log(`res ${res}: ${cells.length} cells, ${out.rings.length} rings produced, edges=${out.edgeCount}, byFrom-collisions=${out.overwrites}`);
  console.log(`  ring-size histogram:`, histogram);
  console.log(`  dLng row0 vs row1: ${dLng0.toExponential(6)} vs ${dLng1.toExponential(6)} diff=${(dLng1-dLng0).toExponential(3)} (${((dLng1-dLng0)/dLng0*1e6).toFixed(2)} ppm)`);
}
