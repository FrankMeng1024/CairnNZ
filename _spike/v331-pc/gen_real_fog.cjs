// Generate the EXACT fog GeoJSON Cairn produces, save to JSON file.
// Uses real h3Pure + globalFogBuilder logic.

const path = require('path');
const fs = require('fs');

// Inline minimal h3Pure (latLngToCell only)
const RES_M = 25;
const M_PER_DEG_LAT = 111320;

function latLngToCell(lat, lng, res) {
  const dLat = RES_M / M_PER_DEG_LAT;
  const iy = Math.floor(lat / dLat);
  const anchorLat = (iy + 0.5) * dLat;
  const dLng = RES_M / (M_PER_DEG_LAT * Math.cos(anchorLat * Math.PI / 180));
  const ix = Math.floor(lng / dLng);
  return `${res}:${ix}:${iy}`;
}

// Simulate v329 hexSpacing=20m recordCircleUnlock (500m reveal centered on user)
const userLat = 31.232;
const userLng = 121.457;
const HEX_SPACING = 20;
const RADIUS = 500;
const ROW_STEP = HEX_SPACING * Math.sqrt(3) / 2;

const dLatPerM = 1 / 111000;
const cosLat = Math.cos(userLat * Math.PI / 180);
const dLngPerM = dLatPerM / Math.max(cosLat, 1e-6);

const rowsHalf = Math.ceil(RADIUS / ROW_STEP);
const colsHalf = Math.ceil(RADIUS / HEX_SPACING);
const RSQ = RADIUS * RADIUS;

const cells = new Map();
for (let row = -rowsHalf; row <= rowsHalf; row++) {
  const dy = row * ROW_STEP;
  const rowOff = (row & 1) === 0 ? 0 : HEX_SPACING / 2;
  for (let col = -colsHalf; col <= colsHalf; col++) {
    const dx = col * HEX_SPACING + rowOff;
    if (dx * dx + dy * dy > RSQ) continue;
    const pLat = userLat + dy * dLatPerM;
    const pLng = userLng + dx * dLngPerM;
    const id = latLngToCell(pLat, pLng, 11);
    if (!cells.has(id)) cells.set(id, true);
  }
}

console.log(`cells: ${cells.size}`);

// Now run globalFogBuilder
const GLOBAL_WEST = -179.9, GLOBAL_EAST = 179.9, GLOBAL_SOUTH = -85, GLOBAL_NORTH = 85;
const dLat = RES_M / M_PER_DEG_LAT;

const outerRing = [
  [GLOBAL_WEST, GLOBAL_SOUTH],
  [GLOBAL_EAST, GLOBAL_SOUTH],
  [GLOBAL_EAST, GLOBAL_NORTH],
  [GLOBAL_WEST, GLOBAL_NORTH],
  [GLOBAL_WEST, GLOBAL_SOUTH],
];

const byRow = new Map();
for (const cid of cells.keys()) {
  const [resStr, ixStr, iyStr] = cid.split(':');
  const ix = parseInt(ixStr, 10), iy = parseInt(iyStr, 10);
  if (!byRow.has(iy)) byRow.set(iy, []);
  byRow.get(iy).push(ix);
}

const holes = [];
for (const [iy, ixs] of byRow) {
  ixs.sort((a, b) => a - b);
  const anchorLat = (iy + 0.5) * dLat;
  const cosL = Math.max(0.1, Math.cos(anchorLat * Math.PI / 180));
  const dLng = RES_M / (M_PER_DEG_LAT * cosL);
  const south = iy * dLat;
  const north = (iy + 1) * dLat;

  let runStart = ixs[0], runEnd = ixs[0];
  for (let i = 1; i <= ixs.length; i++) {
    if (i < ixs.length && ixs[i] === runEnd + 1) {
      runEnd = ixs[i];
    } else {
      const west = runStart * dLng;
      const east = (runEnd + 1) * dLng;
      holes.push([
        [west, south],
        [west, north],
        [east, north],
        [east, south],
        [west, south],
      ]);
      if (i < ixs.length) { runStart = ixs[i]; runEnd = ixs[i]; }
    }
  }
}

console.log(`holes (row-run rectangles): ${holes.length}`);

const feature = {
  type: 'Feature',
  properties: { cell_count: cells.size, hole_count: holes.length },
  geometry: { type: 'Polygon', coordinates: [outerRing, ...holes] },
};

fs.writeFileSync(
  'C:/ClaudeCodeProjects/Cairn/_spike/v331-pc/real_fog.geojson',
  JSON.stringify(feature)
);
console.log('wrote real_fog.geojson');
