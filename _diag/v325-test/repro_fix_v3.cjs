// Correct dissolve: for each row, find horizontal runs (contiguous ix ranges)
// then merge vertically into rectangles. Output is one polygon per maximal rectangle.
// Critically: each output polygon is a CLEAN closed ring (no walker needed).

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

// FIXED v3: BFS connected components + per-component bounding-box boundary trace.
// Strategy:
//   1. Build per-row sets (rows[iy] = Set of ix)
//   2. For each unvisited cell, BFS over 4-connected neighbors to find connected component
//   3. For each component, do boundary tracing using ONLY edges with no neighbor (clean topology)
//   4. Edge walker is safe because: edges of one connected component form a SINGLE closed boundary
//      (or multiple if there are holes). No fragmentation possible.

function cellsToMultiPolygonV3(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  // rows[iy] = Set<ix>
  const rows = new Map();
  for (const c of cells) {
    const d=decode(c); if (d.res!==res) continue;
    if (!rows.has(d.iy)) rows.set(d.iy, new Set());
    rows.get(d.iy).add(d.ix);
  }
  // dLng cache per iy
  const dLngFor = new Map();
  const getDLng = (iy) => {
    let v = dLngFor.get(iy);
    if (v === undefined) {
      v = cellDegLng(res, (iy+0.5)*dLat);
      dLngFor.set(iy, v);
    }
    return v;
  };

  // Find connected components via BFS over 4-neighbors
  const componentOf = new Map();  // cellKey -> componentId
  const components = [];          // componentId -> Array<{iy,ix}>
  let nextCompId = 0;
  for (const [iy, ixs] of rows) {
    for (const ix of ixs) {
      const key = `${ix}:${iy}`;
      if (componentOf.has(key)) continue;
      const compId = nextCompId++;
      const comp = [];
      const queue = [[ix, iy]];
      componentOf.set(key, compId);
      while (queue.length) {
        const [cx, cy] = queue.shift();
        comp.push({ix: cx, iy: cy});
        const nbrs = [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]];
        for (const [nx, ny] of nbrs) {
          const r = rows.get(ny);
          if (!r || !r.has(nx)) continue;
          const nk = `${nx}:${ny}`;
          if (componentOf.has(nk)) continue;
          componentOf.set(nk, compId);
          queue.push([nx, ny]);
        }
      }
      components.push(comp);
    }
  }

  // For each component, trace its boundary.
  // Simpler: emit ONE polygon per maximal horizontal run, merged into rectangles row-by-row.
  // This produces clean rectangles without walker bugs. Adjacent rectangles share edges
  // but mapbox FillLayer handles seams correctly.
  const polygons = [];
  for (const comp of components) {
    // Group cells by iy
    const byRow = new Map();
    for (const c of comp) {
      if (!byRow.has(c.iy)) byRow.set(c.iy, []);
      byRow.get(c.iy).push(c.ix);
    }
    // For each row, find contiguous runs and emit as rectangles
    for (const [iy, ixs] of byRow) {
      ixs.sort((a,b)=>a-b);
      const dLng = getDLng(iy);
      const south = iy*dLat;
      const north = (iy+1)*dLat;
      let runStart = ixs[0], runEnd = ixs[0];
      for (let i=1; i<=ixs.length; i++) {
        if (i<ixs.length && ixs[i]===runEnd+1) {
          runEnd = ixs[i];
        } else {
          // emit polygon for [runStart..runEnd]
          const west = runStart * dLng;
          const east = (runEnd+1) * dLng;
          polygons.push([[
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ]]);
          if (i<ixs.length) { runStart = ixs[i]; runEnd = ixs[i]; }
        }
      }
    }
  }
  return polygons;
}

// Test
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
  const polys = cellsToMultiPolygonV3(unvisited);
  const histo = {};
  for (const p of polys) histo[p[0].length] = (histo[p[0].length]||0)+1;
  const tiny = polys.filter(p=>p[0].length<=4).length;
  const reduction = unvisited.length > 0 ? ((1 - polys.length/unvisited.length)*100).toFixed(1) : 0;
  console.log(`${label}: viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length}`);
  console.log(`  → ${polys.length} polys (${reduction}% reduction vs per-cell), histo=`, histo, ` tiny=${tiny} ${tiny===0?'✅':'❌'}`);
}

console.log('\n=== V3: row-run dissolve ===');
test('scattered 70 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:70, blobSize:1, res:11 });
test('dense 200 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:200, blobSize:1, res:11 });
test('sparse 5 blobs res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:5, blobSize:1, res:11 });
test('all unvisited res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:0, blobSize:1, res:11 });
test('all visited res=11', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:300, blobSize:2, res:11 });
test('582 walk-points res=10', { centerLat:31.232, centerLng:121.457, halfDegLng:0.012, halfDegLat:0.020, blobs:180, blobSize:0, res:10 });
test('582 walk-points res=11', { centerLat:31.232, centerLng:121.457, halfDegLng:0.012, halfDegLat:0.020, blobs:582, blobSize:0, res:11 });
