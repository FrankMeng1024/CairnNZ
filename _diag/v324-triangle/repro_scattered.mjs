// Test with SCATTERED visited cells (Swiss cheese fog pattern)
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
const all = polygonToCells([viewRing], 11);

// Simulate 573 GPS points scattered → ~150 small visited blobs distributed across viewport.
// Each blob ~3x3 cells.
const visited = new Set();
const rng = (() => { let s = 1234; return () => (s = (s*16807) % 2147483647) / 2147483647; })();
const dLat = cellDegLat(11);
for (let i=0; i<70; i++) {  // 70 little visited blobs
  const lat = bounds.south + rng() * (bounds.north - bounds.south);
  const lng = bounds.west + rng() * (bounds.east - bounds.west);
  const iy = Math.floor(lat/dLat);
  const anchorLat=(iy+0.5)*dLat;
  const dLng = cellDegLng(11, anchorLat);
  const ix = Math.floor(lng/dLng);
  for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) visited.add(encode(11,ix+dx,iy+dy));
}
const unvisited = all.filter(c=>!visited.has(c));
console.log(`viewport=${all.length}, visited=${visited.size}, unvisited=${unvisited.length}`);

const result = cellsToMultiPolygon(unvisited);
const histogram = {};
for (const r of result.rings) histogram[r.length] = (histogram[r.length]||0)+1;
console.log(`rings: ${result.rings.length}, overwrites: ${result.overwrites}`);
console.log(`ring-size histogram:`, histogram);

// Find the small rings
const tiny = result.rings.filter(r => r.length <= 6);
console.log(`tiny rings (<=6 vertices): ${tiny.length}`);

// Project tiny rings to pixel coords
const px=1290, py=2796;
const projX = lng => Math.round((lng-bounds.west)/(bounds.east-bounds.west)*px);
const projY = lat => Math.round((1-(lat-bounds.south)/(bounds.north-bounds.south))*py);
console.log('\n3-4 vertex rings sample:');
for (const r of tiny.slice(0,8)) {
  const projd = r.map(([lng,lat])=>[projX(lng),projY(lat)]);
  console.log(`  verts=${r.length}:`, JSON.stringify(projd));
}
