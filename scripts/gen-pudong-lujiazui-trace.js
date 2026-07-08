/**
 * Pudong-South-Road → Lujiazui GPS trace generator
 *
 * Real waypoints along 浦东南路 → 东方路 → 世纪大道 → 陆家嘴
 * (approximate — sampled from Amap for realism)
 *
 * Simulates:
 *  - Normal walk 1.5 m/s (5s per fix ≈ 7.5m spacing)
 *  - Fast walk 2.5 m/s (3s per fix ≈ 7.5m spacing) — brief section
 *  - Stationary 5min at midpoint (5s per fix, ±2m GPS drift)
 *  - 5% noise fixes (±20m random) for snap to actually work on
 *
 * Output: JSON array of { t, lat, lng, acc } ~200-300 points
 */

// Real approx waypoints along the route (curved through streets)
const WAYPOINTS = [
  { lat: 31.22597, lng: 121.50307, name: '浦东南路地铁站' },
  { lat: 31.22700, lng: 121.50350, name: '浦东南路 (向北)' },
  { lat: 31.22850, lng: 121.50410, name: '浦东南路/福山路口' },
  { lat: 31.23050, lng: 121.50470, name: '东方路东侧' },
  { lat: 31.23250, lng: 121.50530, name: '陆家嘴环岛南' },
  { lat: 31.23450, lng: 121.50580, name: '世纪大道' },
  { lat: 31.23600, lng: 121.50620, name: '陆家嘴商圈' },
  { lat: 31.23790, lng: 121.50690, name: '陆家嘴地铁站' },
];

const START_T = 1720000000000; // arbitrary epoch (real timestamp used at run time by index)

function haversine(a, b) {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const s = Math.sin(dLat/2)**2 + Math.cos(a.lat*Math.PI/180)*Math.cos(b.lat*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}

function interpolate(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function addNoise(pt, meters) {
  // convert meters to lat/lng approx (1 deg lat ≈ 111km, 1 deg lng at lat=31 ≈ 95km)
  const dLat = (meters / 111000) * (Math.random() * 2 - 1);
  const dLng = (meters / 95000) * (Math.random() * 2 - 1);
  return { lat: pt.lat + dLat, lng: pt.lng + dLng };
}

function generatePath() {
  const points = [];
  const now = Date.now();
  let t = now - 30 * 60_000; // hike started 30min ago
  let elapsed = 0;

  // Segment 1: WPS 0→3 normal walk 1.5 m/s, 5s interval
  for (let i = 0; i < 3; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i+1];
    const dist = haversine(a, b);
    const seconds = dist / 1.5;
    const nSteps = Math.max(2, Math.floor(seconds / 5));
    for (let s = 0; s < nSteps; s++) {
      const p = interpolate(a, b, s / nSteps);
      const noisy = Math.random() < 0.05 ? addNoise(p, 15) : addNoise(p, 3); // 5% big noise
      points.push({ t: t + elapsed * 1000, lat: noisy.lat, lng: noisy.lng, acc: Math.random() < 0.05 ? 25 : 8 });
      elapsed += 5;
    }
  }

  // Segment 2: standing still 5 minutes at WP 3 (陆家嘴环岛南)
  const stopPoint = WAYPOINTS[3];
  for (let s = 0; s < 60; s++) { // 60 samples * 5s = 5 min
    const drifted = addNoise(stopPoint, 2); // ±2m GPS drift while stationary
    points.push({ t: t + elapsed * 1000, lat: drifted.lat, lng: drifted.lng, acc: 6 });
    elapsed += 5;
  }

  // Segment 3: WPS 3→5 fast walk 2.5 m/s, 3s interval
  for (let i = 3; i < 5; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i+1];
    const dist = haversine(a, b);
    const seconds = dist / 2.5;
    const nSteps = Math.max(2, Math.floor(seconds / 3));
    for (let s = 0; s < nSteps; s++) {
      const p = interpolate(a, b, s / nSteps);
      const noisy = Math.random() < 0.05 ? addNoise(p, 20) : addNoise(p, 4);
      points.push({ t: t + elapsed * 1000, lat: noisy.lat, lng: noisy.lng, acc: Math.random() < 0.05 ? 30 : 10 });
      elapsed += 3;
    }
  }

  // Segment 4: WPS 5→7 normal walk to Lujiazui
  for (let i = 5; i < WAYPOINTS.length - 1; i++) {
    const a = WAYPOINTS[i];
    const b = WAYPOINTS[i+1];
    const dist = haversine(a, b);
    const seconds = dist / 1.5;
    const nSteps = Math.max(2, Math.floor(seconds / 5));
    for (let s = 0; s < nSteps; s++) {
      const p = interpolate(a, b, s / nSteps);
      const noisy = Math.random() < 0.05 ? addNoise(p, 15) : addNoise(p, 3);
      points.push({ t: t + elapsed * 1000, lat: noisy.lat, lng: noisy.lng, acc: Math.random() < 0.05 ? 25 : 8 });
      elapsed += 5;
    }
  }

  // Mark point near WP 4 (chosen mid-walk for user to plant)
  const markPoint = { lat: WAYPOINTS[4].lat, lng: WAYPOINTS[4].lng, t: t + Math.floor(elapsed * 0.6) * 1000 };

  return { points, markPoint, elapsedSeconds: elapsed };
}

const result = generatePath();
const fs = require('fs');
const path = require('path');
const outDir = path.join(__dirname, '..', 'docs', 'qa', 'v409-evidence');
fs.writeFileSync(path.join(outDir, 'pudong-lujiazui-trace.json'), JSON.stringify(result, null, 2));
console.log(`Generated ${result.points.length} GPS points`);
console.log(`Duration: ${(result.elapsedSeconds / 60).toFixed(1)} min`);
console.log(`First: ${JSON.stringify(result.points[0])}`);
console.log(`Last: ${JSON.stringify(result.points[result.points.length-1])}`);
console.log(`Mark at: ${JSON.stringify(result.markPoint)}`);
