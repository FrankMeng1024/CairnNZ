#!/usr/bin/env node

/**
 * Runs the exact O50 production compositor over every canonical point of the
 * real `snap`. Exact coordinates stay in a chmod-0600 local handoff artifact;
 * committed review authority is privacy-safe local-metre geometry and metrics.
 * Production access is SELECT-only.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const app = resolve(root, 'app');
const require = createRequire(import.meta.url);
const EARTH_R = 6_371_000;

function compileProductionCompositor() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-o50-final-'));
  const result = spawnSync(resolve(app, 'node_modules/.bin/tsc'), [
    resolve(app, 'src/services/routing/snapTrack.ts'),
    resolve(app, 'src/services/routing/pedestrianFinalRoute.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`O50 compile failed: ${result.stderr || result.stdout}`);
  return { output, compositor: require(resolve(output, 'pedestrianFinalRoute.js')) };
}

function selectReferenceActivities() {
  const source = String.raw`
const db=require('./src/config/db');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
(async()=>{const [rows]=await db.query('SELECT id,name,distance_m,duration_s,route_points,route_points_raw FROM sessions WHERE id IN (?,?) ORDER BY id',[46,2073]);console.log(JSON.stringify(rows.map(row=>({...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)}))));await db.end()})().catch(async e=>{console.error(e.stack||e);try{await db.end()}catch{}process.exit(1)});
`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', 'sudo', '-n', 'docker', 'exec', '-i', 'cairn-backend', 'node'],
    { input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production SELECT failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function loadToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.trim().startsWith('pk.')) {
    return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  }
  const fixture = readFileSync(resolve(app, '_spike/v346-fog-https/test.html'), 'utf8');
  const token = fixture.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/i)?.[1];
  if (!token) throw new Error('Mapbox public token unavailable');
  return token;
}

function normalise(value) {
  const timeValue = value.t ?? value.timestamp;
  const parsedTime = typeof timeValue === 'number' ? timeValue : Date.parse(timeValue);
  return {
    lat: Number(value.lat ?? value.latitude),
    lng: Number(value.lng ?? value.longitude),
    alt: value.alt ?? value.altitude ?? null,
    accuracy: value.acc ?? value.accuracy ?? null,
    speed: value.speed_mps ?? value.speed ?? null,
    ...(Number.isFinite(parsedTime) ? { t: parsedTime } : {}),
  };
}

function rad(value) { return value * Math.PI / 180; }
function hav(left, right) {
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}
function pathLength(points) {
  return points.slice(1).reduce((total, point, index) => total + hav(points[index], point), 0);
}
function bearing(left, right) {
  const lat1 = rad(left.lat); const lat2 = rad(right.lat); const dLng = rad(right.lng - left.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function angle(left, right) {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
}
function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}
function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
function fingerprint(points) {
  let hash = 0x811c9dc5;
  for (const point of points) {
    const text = `${point.lat.toFixed(6)},${point.lng.toFixed(6)};`;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function pointToSegment(point, start, end) {
  const cosLat = Math.cos(rad(point.lat));
  const ax = (start.lng - point.lng) * 111_320 * cosLat;
  const ay = (start.lat - point.lat) * 111_320;
  const bx = (end.lng - point.lng) * 111_320 * cosLat;
  const by = (end.lat - point.lat) * 111_320;
  const dx = bx - ax; const dy = by - ay; const squared = dx * dx + dy * dy;
  const ratio = squared > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / squared)) : 0;
  return Math.hypot(ax + dx * ratio, ay + dy * ratio);
}
function pointToPath(point, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegment(point, path[index - 1], path[index]));
  }
  return best;
}

function visualMetrics(points, canonical = points) {
  const headings = [];
  for (let index = 1; index < points.length; index += 1) {
    if (hav(points[index - 1], points[index]) >= 1) headings.push(bearing(points[index - 1], points[index]));
  }
  const changes = headings.slice(1).map((heading, index) => angle(headings[index], heading));
  const meaningfulTurns = changes.filter(value => value >= 55).length;
  const jitter = changes.filter(value => value < 55);
  let smallZigzags = 0;
  for (let index = 2; index < headings.length; index += 1) {
    const first = ((headings[index - 1] - headings[index - 2] + 540) % 360) - 180;
    const second = ((headings[index] - headings[index - 1] + 540) % 360) - 180;
    if (Math.sign(first) !== Math.sign(second) && Math.abs(first) >= 8 && Math.abs(second) >= 8
      && Math.abs(first) < 55 && Math.abs(second) < 55) smallZigzags += 1;
  }
  const deviations = canonical.map(point => pointToPath(point, points));
  const lengthM = pathLength(points);
  return {
    pointCount: points.length,
    lengthM: round(lengthM),
    verticesPerKm: round(points.length / Math.max(0.001, lengthM / 1_000), 1),
    shortScaleHeadingJitterP50Deg: round(percentile(jitter, 0.5), 2),
    shortScaleHeadingJitterP95Deg: round(percentile(jitter, 0.95), 2),
    smallZigzagCount: smallZigzags,
    meaningfulTurnCount: meaningfulTurns,
    canonicalDisplacementP50M: round(percentile(deviations, 0.5)),
    canonicalDisplacementP95M: round(percentile(deviations, 0.95)),
    canonicalDisplacementMaxM: round(Math.max(...deviations)),
    lengthRatioToCanonical: round(lengthM / Math.max(1, pathLength(canonical)), 5),
  };
}

function localise(points, origin) {
  const cosLat = Math.cos(rad(origin.lat));
  return points.map(point => ({
    x: round((point.lng - origin.lng) * 111_320 * cosLat, 2),
    y: round((point.lat - origin.lat) * 111_320, 2),
  }));
}

function loadO49Reference(origin) {
  const html = readFileSync(resolve(here, 'O49_SNAP_FULL_ROUTE_PREVIEW.html'), 'utf8');
  const encoded = html.match(/const data=(\{.*?\});const c=/s)?.[1];
  if (!encoded) throw new Error('O49 privacy-safe visual reference unavailable');
  const local = JSON.parse(encoded).final;
  const cosLat = Math.cos(rad(origin.lat));
  return {
    local,
    points: local.map(point => ({
      lng: origin.lng + point.x / (111_320 * cosLat),
      lat: origin.lat + point.y / 111_320,
    })),
  };
}

const namedRanges = [
  ['opening road', 0, 61], ['road crossing', 62, 104], ['internal outbound', 105, 158],
  ['lower/middle corridor', 159, 283], ['stop area', 284, 304],
  ['internal return', 284, 327], ['U-turn/repeated path', 254, 327], ['final road', 328, 391],
];

function rangeReports(canonical, final, sections) {
  return namedRanges.map(([name, start, requestedEnd]) => {
    const end = Math.min(requestedEnd, canonical.length - 1);
    const overlaps = sections.filter(section => section.sourceStart <= end && section.sourceEnd >= start);
    const subsection = canonical.slice(start, end + 1);
    const deviations = subsection.map(point => pointToPath(point, final));
    const canonicalM = pathLength(subsection);
    const estimatedDisplayM = sections.reduce((sum, section) => {
      const overlapStart = Math.max(start, section.sourceStart);
      const overlapEnd = Math.min(end, section.sourceEnd);
      if (overlapEnd <= overlapStart) return sum;
      const overlapCanonicalM = pathLength(canonical.slice(overlapStart, overlapEnd + 1));
      return sum + overlapCanonicalM * section.lengthRatio;
    }, 0);
    return {
      name, sourceRange: [start, end],
      states: [...new Set(overlaps.map(section => section.state))],
      geometryModes: [...new Set(overlaps.map(section => section.geometryMode))],
      networkSources: [...new Set(overlaps.map(section => section.networkSource))],
      decisions: [...new Set(overlaps.map(section => section.decision))],
      lateralOffsetsM: overlaps.flatMap(section => section.lateralOffsetM == null ? [] : [round(section.lateralOffsetM)]),
      confidence: overlaps.length ? round(Math.min(...overlaps.map(section => section.confidence)), 4) : null,
      canonicalDistanceM: round(canonicalM),
      canonicalDisplacementP95M: round(percentile(deviations, 0.95)),
      lengthRatio: round(estimatedDisplayM / Math.max(1, canonicalM), 4),
      reasons: [...new Set(overlaps.map(section => section.reason))],
    };
  });
}

function comparisonHtml(layers, scorecard, sections) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>O50 Snap Product Comparison</title><style>
*{box-sizing:border-box}body{margin:0;background:#f1ede3;color:#183e35;font:14px Inter,system-ui,sans-serif}header{padding:18px 20px}h1{font-size:20px;margin:0 0 5px}.sub{color:#5d6d67}.grid{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:14px;padding:0 18px 18px}.panel{background:#fcfaf4;border:1px solid #d7d0bf;border-radius:18px;overflow:hidden}.title{padding:13px 15px;font-weight:700}.canvas{height:56vh;min-height:430px}canvas{width:100%;height:100%;display:block}.metrics{padding:12px 15px;border-top:1px solid #e1dacb;font-size:12px;line-height:1.55}.debug{padding:0 18px 24px}table{width:100%;border-collapse:collapse;background:#fcfaf4}th,td{text-align:left;padding:7px;border-bottom:1px solid #e1dacb}@media(max-width:900px){.grid{grid-template-columns:1fr}.canvas{height:55vh}}
</style></head><body><header><h1>O50 pedestrian Final · product comparison</h1><div class="sub">Independent frame for historical back; shared local-metre frame for O49/O50 snap. No absolute coordinates.</div></header><main class="grid">${[
    ['back', 'Historical back visual reference'], ['o49', 'O49 current snap'], ['o50', 'O50 Final snap'],
  ].map(([key, title]) => `<section class="panel"><div class="title">${title}</div><div class="canvas"><canvas data-key="${key}"></canvas></div><div class="metrics" id="m-${key}"></div></section>`).join('')}</main><section class="debug"><h2>O50 section modes</h2><table><thead><tr><th>Range</th><th>State</th><th>Mode</th><th>Source</th><th>Offset</th><th>Reason</th></tr></thead><tbody>${sections.map(section => `<tr><td>${section.sourceStart}–${section.sourceEnd}</td><td>${section.state}</td><td>${section.geometryMode}</td><td>${section.networkSource}</td><td>${section.lateralOffsetM == null ? '—' : round(section.lateralOffsetM)+' m'}</td><td>${section.reason}</td></tr>`).join('')}</tbody></table></section><script>
const layers=${JSON.stringify(layers)},scores=${JSON.stringify(scorecard)};
for(const canvas of document.querySelectorAll('canvas')){const key=canvas.dataset.key,data=layers[key],ctx=canvas.getContext('2d');function draw(){const d=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,w,h);const all=data.flatMap(layer=>layer.points),xs=all.map(p=>p.x),ys=all.map(p=>p.y),pad=25,scale=Math.min((w-pad*2)/(Math.max(...xs)-Math.min(...xs)||1),(h-pad*2)/(Math.max(...ys)-Math.min(...ys)||1)),tx=x=>pad+(x-Math.min(...xs))*scale,ty=y=>h-pad-(y-Math.min(...ys))*scale;for(const layer of data){ctx.beginPath();layer.points.forEach((p,i)=>i?ctx.lineTo(tx(p.x),ty(p.y)):ctx.moveTo(tx(p.x),ty(p.y)));ctx.strokeStyle=layer.color;ctx.lineWidth=layer.width;ctx.globalAlpha=layer.alpha;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke()}ctx.globalAlpha=1}draw();addEventListener('resize',draw);document.getElementById('m-'+key).textContent=Object.entries(scores[key]).map(([k,v])=>k+': '+v).join(' · ')}</script></body></html>`;
}

const compiled = compileProductionCompositor();
try {
  const activities = selectReferenceActivities();
  const backup = JSON.parse(readFileSync(resolve(here, 'SNAP_BEFORE_O49_DB_BACKUP.json'), 'utf8'));
  const canonical = backup.source.route_points.map(normalise);
  const back = activities.find(activity => Number(activity.id) === 46).route_points.map(normalise);
  const origin = canonical[0];
  const o49Reference = loadO49Reference(origin);
  const snapCurrent = o49Reference.points;
  const result = await compiled.compositor.reconstructPedestrianFinalRoute(canonical, {
    mapboxToken: loadToken(), totalTimeoutMs: 10_000, perCallTimeoutMs: 2_600,
    concurrency: 4, directionsFallback: true, maxDirectionsRequests: 3,
  });
  if (!result.ok) throw new Error(`O50 compositor failed: ${result.reason}`);
  const exactPath = resolve(here, 'O50_SNAP_PRIVATE_RESULT.json');
  writeFileSync(exactPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(), algorithmVersion: result.stats.algorithmVersion,
    sourceBackupRouteHash: backup.source.route_hash, canonicalPointCount: canonical.length,
    finalGeometryFingerprint: result.stats.finalGeometryFingerprint,
    points: result.points, stats: result.stats,
  }, null, 2)}\n`, { mode: 0o600 });
  chmodSync(exactPath, 0o600);
  const backOrigin = back[0];
  const layers = {
    back: [{ points: localise(back, backOrigin), color: '#173f35', width: 5, alpha: 1 }],
    o49: [
      { points: localise(canonical, origin), color: '#bb705c', width: 2.5, alpha: 0.48 },
      { points: o49Reference.local, color: '#173f35', width: 5, alpha: 1 },
    ],
    o50: [
      { points: localise(canonical, origin), color: '#bb705c', width: 2.5, alpha: 0.35 },
      { points: localise(result.points, origin), color: '#173f35', width: 5, alpha: 1 },
    ],
  };
  const scorecard = {
    back: visualMetrics(back),
    o49: visualMetrics(snapCurrent, canonical),
    o50: visualMetrics(result.points, canonical),
  };
  const rangeReport = rangeReports(canonical, result.points, result.stats.sections);
  const review = {
    generatedAt: new Date().toISOString(), verdict: result.stats.wholeRouteValidation.accepted ? 'PASS' : 'HOLD',
    source: { canonicalPointCount: canonical.length, canonicalLengthM: round(pathLength(canonical)), backupRouteHash: backup.source.route_hash },
    output: { pointCount: result.points.length, lengthM: round(pathLength(result.points)), fingerprint: result.stats.finalGeometryFingerprint },
    performance: {
      mapMatchingRequestCount: result.stats.mapMatchingRequestCount,
      directionsFallbackRequestCount: result.stats.directionsRequestCount,
      mapMatchingApiDurationMs: result.stats.mapMatchingApiDurationMs,
      directionsApiDurationMs: result.stats.directionsApiDurationMs,
      totalApiWallDurationMs: result.stats.totalApiWallDurationMs,
      totalApiDurationMs: result.stats.totalApiDurationMs,
      finalProcessingDurationMs: result.stats.durationMs,
    },
    stats: result.stats, rangeReport, scorecard,
  };
  writeFileSync(resolve(here, 'O50_REAL_REPLAY_RESULTS.json'), `${JSON.stringify(review, null, 2)}\n`);
  writeFileSync(resolve(here, 'O50_SNAP_PRIVACY_SAFE_GEOMETRY.json'), `${JSON.stringify({ layers, sections: result.stats.sections }, null, 2)}\n`);
  writeFileSync(resolve(here, 'O50_SNAP_PRODUCT_COMPARISON.html'), comparisonHtml(layers, scorecard, result.stats.sections));
  console.log(JSON.stringify(review, null, 2));
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
}
