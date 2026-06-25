// Approach 2: Each cell → one rectangle polygon. No dissolve. No walker.
// Trade-off: LineLayer would draw internal grid lines. But with fogEdge opacity 0.55 + blur, may be acceptable.
// Better trade-off: emit ONLY the unique boundary edges as a separate LineLayer source.

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

// FIX v2: per-cell polygon, no dissolve, no walker.
// Output shape matches MultiPolygon: array of polygons, each polygon is array-of-rings, each ring is array-of-[lng,lat].
function cellsToMultiPolygonPerCell(cells) {
  if (cells.length===0) return [];
  const first=decode(cells[0]); const res=first.res; const dLat=cellDegLat(res);
  const polygons = [];
  for (const c of cells) {
    const d = decode(c);
    if (d.res !== res) continue;
    const anchorLat = (d.iy + 0.5) * dLat;
    const dLng = cellDegLng(res, anchorLat);
    const south = d.iy * dLat;
    const north = (d.iy + 1) * dLat;
    const west = d.ix * dLng;
    const east = (d.ix + 1) * dLng;
    // GeoJSON polygon: single outer ring, closed (last==first)
    polygons.push([[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]]);
  }
  return polygons;
}

// Run scenarios
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
  const polys = cellsToMultiPolygonPerCell(unvisited);
  // Verify each polygon is a clean rectangle (5 verts)
  const histo = {};
  for (const p of polys) histo[p[0].length] = (histo[p[0].length]||0)+1;
  console.log(`${label}: viewport=${all.length} visited=${visited.size} unvisited=${unvisited.length} polys=${polys.length} histo=`, histo);
}
console.log('\n=== Per-cell approach ===');
test('scattered 70 blobs', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:70, blobSize:1, res:11 });
test('dense 200 blobs', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:200, blobSize:1, res:11 });
test('all unvisited', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:0, blobSize:1, res:11 });
test('all visited', { centerLat:31.235, centerLng:121.460, halfDegLng:0.005, halfDegLat:0.003, blobs:300, blobSize:2, res:11 });
