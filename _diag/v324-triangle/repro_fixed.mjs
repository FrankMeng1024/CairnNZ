// Fixed cellsToMultiPolygon — proves correctness against scattered visited blobs.
// Strategy (Subagent C recommendation #2): edge-indexed used set + multimap byFrom + strict closed gate.

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

// FIXED cellsToMultiPolygon:
// - byFrom is Map<string, Edge[]> (multimap)
// - used set tracks EDGE INDICES, not vertex keys
// - ring accepted only if walker exited via the proper-close branch
function cellsToMultiPolygonFixed(cells) {
  if (cells.length===0) return { rings: [], edgeCount: 0, rejected: 0 };
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  const rows=new Map();
  for (const c of cells) {
    const d=decode(c); if (d.res!==res) continue;
    let row=rows.get(d.iy);
    if (!row) { const anchorLat=(d.iy+0.5)*dLat; row={ixs:new Set(),dLng:cellDegLng(res,anchorLat),anchorLat}; rows.set(d.iy,row); }
    row.ixs.add(d.ix);
  }
  // Edges with stable indices.
  const edges = [];
  for (const [iy, row] of rows) {
    const south = iy*dLat, north = (iy+1)*dLat;
    for (const ix of row.ixs) {
      const west = ix*row.dLng, east = (ix+1)*row.dLng;
      const sw=[west,south], se=[east,south], ne=[east,north], nw=[west,north];
      const southRow = rows.get(iy-1);
      if (!southRow || !southRow.ixs.has(ix)) edges.push({ from: sw, to: se });
      if (!row.ixs.has(ix+1)) edges.push({ from: se, to: ne });
      const northRow = rows.get(iy+1);
      if (!northRow || !northRow.ixs.has(ix)) edges.push({ from: ne, to: nw });
      if (!row.ixs.has(ix-1)) edges.push({ from: nw, to: sw });
    }
  }

  const ptKey = p => `${p[0]},${p[1]}`;

  // Multimap: vertex-from-key -> list of edge indices
  const byFrom = new Map();
  for (let i=0; i<edges.length; i++) {
    const k = ptKey(edges[i].from);
    let list = byFrom.get(k);
    if (!list) { list = []; byFrom.set(k, list); }
    list.push(i);
  }

  const used = new Uint8Array(edges.length); // 0 = free, 1 = used
  const rings = [];
  let rejectedOpenWalks = 0;

  for (let startIdx=0; startIdx<edges.length; startIdx++) {
    if (used[startIdx]) continue;
    const startEdge = edges[startIdx];
    const startKey = ptKey(startEdge.from);
    const ring = [];
    let curIdx = startIdx;
    let cur = startEdge;
    let closed = false;
    let safety = edges.length + 8;
    while (safety-- > 0) {
      if (used[curIdx]) break;            // shouldn't happen — protective
      used[curIdx] = 1;
      ring.push(cur.from);
      const nextKey = ptKey(cur.to);
      if (nextKey === startKey) { closed = true; break; }
      const candidates = byFrom.get(nextKey);
      if (!candidates) break;             // dead-end (shouldn't happen on a closed ring)
      // pick the first unused candidate
      let nextIdx = -1;
      for (const idx of candidates) {
        if (!used[idx]) { nextIdx = idx; break; }
      }
      if (nextIdx === -1) break;          // all outgoing edges already used
      curIdx = nextIdx;
      cur = edges[curIdx];
    }
    if (closed && ring.length >= 3) {
      // Append closing vertex (== ring[0]) to honor GeoJSON ring spec
      ring.push([ring[0][0], ring[0][1]]);
      rings.push(ring);
    } else {
      rejectedOpenWalks++;
    }
  }
  return { rings, edgeCount: edges.length, rejected: rejectedOpenWalks };
}

// Run repro scenarios

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
  const out = cellsToMultiPolygonFixed(unvisited);
  const histo={};
  for (const r of out.rings) histo[r.length] = (histo[r.length]||0)+1;
  const tiny = out.rings.filter(r=>r.length<=5).length;
  console.log(`${label}: viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length}`);
  console.log(`  → ${out.rings.length} rings, ${out.rejected} open walks rejected, histo:`, histo);
  console.log(`  → tiny (<=5 verts): ${tiny}  ${tiny===0?'✅ no triangle artifacts':'❌ STILL HAS ARTIFACTS'}`);
  return { rings: out.rings.length, tiny, rejected: out.rejected };
}

console.log('\n=== Scenarios ===');
test('scattered 70 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:70, blobSize:1, res:11 });
test('scattered 30 blobs res=10', { centerLat:31.235, centerLng:121.460, halfDegLng:0.01, halfDegLat:0.006, blobs:30, blobSize:1, res:10 });
test('dense 200 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:200, blobSize:1, res:11 });
test('sparse 5 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:5, blobSize:1, res:11 });
test('all visited res=11', (()=>{const o={centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:300, blobSize:2, res:11};return o;})());
test('all unvisited res=11', (()=>{return {centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:0, blobSize:1, res:11};})());

// 真实场景:连续 walking 轨迹
console.log('\nLinear walking track scenario:');
{
  const centerLat=31.235, centerLng=121.460;
  const halfDegLng=0.005, halfDegLat=0.003;
  const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
  const viewRing=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];
  const all = polygonToCells([viewRing], 11);
  const visited = new Set();
  const dLat=cellDegLat(11);
  const midIy = Math.floor(centerLat/dLat);
  for (let ix=Math.floor((centerLng-0.003)/cellDegLng(11,(midIy+0.5)*dLat)); ix<=Math.floor((centerLng+0.003)/cellDegLng(11,(midIy+0.5)*dLat)); ix++) {
    for (let dy=-2; dy<=2; dy++) visited.add(encode(11,ix,midIy+dy));
  }
  const unvisited = all.filter(c=>!visited.has(c));
  const out = cellsToMultiPolygonFixed(unvisited);
  const histo={}; for (const r of out.rings) histo[r.length]=(histo[r.length]||0)+1;
  const tiny = out.rings.filter(r=>r.length<=5).length;
  console.log(`  linear-track: rings=${out.rings.length} rejected=${out.rejected} histo=`, histo, ` tiny=${tiny} ${tiny===0?'✅':'❌'}`);
}
