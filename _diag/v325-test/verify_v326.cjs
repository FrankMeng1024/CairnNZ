const h3 = require('C:\\temp\\h3pure-test\\h3Pure.js').default;

// Test 1: row-run dissolve
const cells = ['11:100:50','11:101:50','11:102:50','11:103:50','11:105:50','11:106:50','11:100:51','11:101:51'];
const polys = h3.cellsToMultiPolygon(cells, true);
console.log('Test 1 row-run:');
console.log('  input cells:', cells.length, 'output polys:', polys.length);
let allOk = true;
for (const p of polys) {
  const r = p[0];
  const closed = r[0][0]===r[r.length-1][0] && r[0][1]===r[r.length-1][1];
  console.log(`  poly ring length=${r.length} closed=${closed}`);
  if (!closed || r.length !== 5) allOk = false;
}
console.log(allOk ? '  ✅ all rings 5-vertex closed' : '  ❌ FAIL');

// Test 2: 582-walk Shanghai scenario
console.log('\nTest 2: 582 walks at res 10');
const RES_METERS = { 10: 70 };
const dLat = 70 / 111_320;
const visited = new Set();
let lat=31.232, lng=121.457;
for (let i=0; i<582; i++) {
  lat += (Math.random()-0.5)*0.0003;
  lng += (Math.random()-0.5)*0.0003;
  visited.add(h3.latLngToCell(lat, lng, 10));
}
const halfDegLng=0.012, halfDegLat=0.020;
const ring=[[121.457-halfDegLng,31.232-halfDegLat],[121.457+halfDegLng,31.232-halfDegLat],[121.457+halfDegLng,31.232+halfDegLat],[121.457-halfDegLng,31.232+halfDegLat],[121.457-halfDegLng,31.232-halfDegLat]];
const viewport = h3.polygonToCells([ring], 10, true);
const unvisited = viewport.filter(c => !visited.has(c));
const polys2 = h3.cellsToMultiPolygon(unvisited, true);
console.log(`  viewport=${viewport.length} visited=${visited.size} unvisited=${unvisited.length}`);
console.log(`  polys=${polys2.length} reduction=${((1-polys2.length/unvisited.length)*100).toFixed(1)}%`);
let tiny=0;
for (const p of polys2) if (p[0].length <= 4) tiny++;
console.log(tiny === 0 ? '  ✅ 0 tiny rings (no triangles)' : `  ❌ ${tiny} tiny rings`);

// Test 3: empty input
console.log('\nTest 3: edge cases');
console.log('  empty input:', h3.cellsToMultiPolygon([], true).length);
console.log('  single cell:', h3.cellsToMultiPolygon(['11:0:0'], true).length);
console.log('  all-visited (empty unvisited):', h3.cellsToMultiPolygon([], true).length);
