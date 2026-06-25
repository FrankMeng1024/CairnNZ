// Test: walk visited res-11 cells projected to res-10 parents, vs viewport res-10 cells
const h3Mod = require('C:\\temp\\h3pure-test\\h3Pure.js');
const h3 = h3Mod.default;

const RES_METERS = { 8: 600, 9: 200, 10: 70, 11: 25 };

// Simulate 582 walk points spread over a 1.5km × 1.5km area (Shanghai 静安)
const visited = new Set();
let lat0 = 31.232, lng0 = 121.457;
for (let i=0; i<582; i++) {
  // Random walk steps
  const a = Math.random()*Math.PI*2;
  const stepM = 5 + Math.random()*30;
  const stepLat = (stepM*Math.sin(a))/111000;
  const stepLng = (stepM*Math.cos(a))/(111000*Math.cos(lat0*Math.PI/180));
  lat0 += stepLat; lng0 += stepLng;
  if (Math.abs(lat0-31.232)>0.01) lat0 = 31.232+Math.random()*0.005;
  if (Math.abs(lng0-121.457)>0.01) lng0 = 121.457+Math.random()*0.005;
  const c = h3.latLngToCell(lat0, lng0, 11);
  visited.add(c);
}
console.log(`582 walks → ${visited.size} unique res-11 cells`);

// Project to res-10 parents
const parentsRes10 = new Set();
for (const c of visited) parentsRes10.add(h3.cellToParent(c, 10));
console.log(`→ ${parentsRes10.size} unique res-10 parents`);

// Viewport at zoom ~14 (res 10)
const centerLat=31.232, centerLng=121.457;
const halfDegLng=0.012, halfDegLat=0.020;
const bounds={west:centerLng-halfDegLng, east:centerLng+halfDegLng, north:centerLat+halfDegLat, south:centerLat-halfDegLat};
const ring=[[bounds.west,bounds.south],[bounds.east,bounds.south],[bounds.east,bounds.north],[bounds.west,bounds.north],[bounds.west,bounds.south]];
const viewport10 = h3.polygonToCells([ring], 10, true);
const viewportSet = new Set(viewport10);
console.log(`Viewport at res 10: ${viewport10.length} cells`);

// HOW MANY parent-res10 cells are actually in viewport?
const hits = [...parentsRes10].filter(c => viewportSet.has(c)).length;
console.log(`\nParent-cells of visited that ARE in viewport: ${hits}/${parentsRes10.size}`);

if (hits < parentsRes10.size) {
  console.log('🚨 MISMATCH: some visited parent cells are NOT in viewport set');
  const missing = [...parentsRes10].filter(c => !viewportSet.has(c));
  console.log('  missing examples:', missing.slice(0,5));
}

// Same for res 9, res 11
for (const targetRes of [8,9,10,11]) {
  const parents = new Set();
  for (const c of visited) {
    if (targetRes === 11) parents.add(c);
    else parents.add(h3.cellToParent(c, targetRes));
  }
  const view = new Set(h3.polygonToCells([ring], targetRes, true));
  const hit = [...parents].filter(c => view.has(c)).length;
  console.log(`res ${targetRes}: ${parents.size} visited parents, ${view.size} viewport, ${hit} match`);
}
