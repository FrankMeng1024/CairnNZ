#!/usr/bin/env node

/**
 * O49 production matcher replay for real `snap`, real `almost done`, and the
 * historical `back` control. Exact coordinates live only in process memory.
 * Persisted review geometry is translated into a local metre frame.
 *
 * Safety: production access is SELECT-only. This script has no mutation SQL.
 */

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const app = resolve(root, 'app');
const require = createRequire(import.meta.url);
const EARTH_R = 6_371_000;

function compileMatcher() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-o49-matcher-'));
  const compiler = resolve(app, 'node_modules/.bin/tsc');
  const result = spawnSync(compiler, [
    resolve(app, 'src/services/routing/snapTrack.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop',
  ], { cwd: app, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`matcher compile failed: ${result.stderr || result.stdout}`);
  return { output, matcher: require(resolve(output, 'snapTrack.js')) };
}

function loadPrivateEvidence() {
  const source = String.raw`
const db=require('./src/config/db');
const parse=v=>typeof v==='string'?JSON.parse(v):v;
(async()=>{const [rows]=await db.query('SELECT id,user_id,client_activity_id,type,start_time,end_time,finalized_at,distance_m,duration_s,name,route_points,route_points_raw,flags,created_at FROM sessions WHERE id IN (?,?,?) ORDER BY id',[2073,2072,46]);console.log(JSON.stringify(rows.map(row=>({...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)}))));await db.end()})().catch(async e=>{console.error(e.stack||e);try{await db.end()}catch{}process.exit(1)});
`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', 'sudo', '-n', 'docker', 'exec', '-i', 'cairn-backend', 'node'],
    { input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production SELECT failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function loadMapboxToken() {
  if (process.env.EXPO_PUBLIC_MAPBOX_TOKEN?.startsWith('pk.')) return process.env.EXPO_PUBLIC_MAPBOX_TOKEN.trim();
  const fixture = readFileSync(resolve(app, '_spike/v346-fog-https/test.html'), 'utf8');
  const token = fixture.match(/mapboxgl\.accessToken\s*=\s*['"](pk\.[^'"]+)['"]/i)?.[1];
  if (!token) throw new Error('Mapbox public token unavailable');
  return token;
}

function normalise(point) {
  const tValue = point.t ?? point.timestamp;
  const parsedT = typeof tValue === 'number' ? tValue : Date.parse(tValue);
  return {
    lat: Number(point.lat ?? point.latitude),
    lng: Number(point.lng ?? point.longitude),
    alt: point.alt ?? point.altitude ?? null,
    accuracy: point.acc ?? point.accuracy ?? null,
    speed: point.speed_mps ?? point.speed ?? null,
    ...(Number.isFinite(parsedT) ? { t: parsedT } : {}),
  };
}

function hav(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
}

function pointToSegment(point, start, end) {
  const metresPerDegree = 111_320;
  const cosLat = Math.cos(point.lat * Math.PI / 180);
  const ax = (start.lng - point.lng) * metresPerDegree * cosLat;
  const ay = (start.lat - point.lat) * metresPerDegree;
  const bx = (end.lng - point.lng) * metresPerDegree * cosLat;
  const by = (end.lat - point.lat) * metresPerDegree;
  const dx = bx - ax; const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared <= 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + ratio * dx, ay + ratio * dy);
}

function pointToPath(point, path) {
  let best = Infinity;
  for (let index = 1; index < path.length; index += 1) {
    best = Math.min(best, pointToSegment(point, path[index - 1], path[index]));
  }
  return best;
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

function ranges(stats) {
  return stats.requestResults.flatMap(request => request.islandResults)
    .filter(island => island.decision === 'matched')
    .map(island => ({
      sourceStart: island.sourceStart,
      sourceEnd: island.sourceEnd,
      confidence: round(island.confidence, 6),
      reason: island.reason,
      qualityReason: island.qualityReason,
      topologyReason: island.topologyReason,
      seamReason: island.seamReason,
      seamTrimmedHeadPoints: island.seamTrimmedHeadPoints,
      seamTrimmedTailPoints: island.seamTrimmedTailPoints,
    }));
}

function summary(session, canonical, result) {
  const points = result.ok ? result.points : canonical;
  const deviations = canonical.map(point => pointToPath(point, points));
  const acceptedRanges = result.ok ? ranges(result.stats) : [];
  const overlaps = (start, end) => acceptedRanges.filter(range => (
    range.sourceStart != null && range.sourceEnd != null && range.sourceStart <= end && range.sourceEnd >= start
  ));
  return {
    identity: session.id === 46
      ? 'historical-back-control'
      : session.id === 2072 ? 'almost-done-control' : 'snap',
    serverId: session.id,
    sourcePointCount: canonical.length,
    outputPointCount: points.length,
    sourceDistanceM: round(pathLength(canonical)),
    outputDistanceM: round(pathLength(points)),
    result: result.ok ? 'ok' : result.reason,
    stats: result.stats,
    acceptedRanges,
    routeClasses: session.id === 2073 ? {
      initialHead: { range: [0, 61], acceptedRanges: overlaps(0, 61) },
      crossingAndTransition: { range: [62, 104], acceptedRanges: overlaps(62, 104) },
      internalAndRepeated: { range: [105, 327], acceptedRanges: overlaps(105, 327) },
      finalPublicCorridor: { range: [328, 391], acceptedRanges: overlaps(328, 391) },
    } : undefined,
    canonicalToFinalDisplacementM: {
      p50: round(percentile(deviations, 0.5)),
      p95: round(percentile(deviations, 0.95)),
      max: round(Math.max(...deviations)),
    },
  };
}

function localise(points, origin) {
  const cosLat = Math.cos(origin.lat * Math.PI / 180);
  return points.map(point => ({
    x: round((point.lng - origin.lng) * 111_320 * cosLat, 2),
    y: round((point.lat - origin.lat) * 111_320, 2),
  }));
}

function preview(canonical, final) {
  const origin = canonical[0];
  const layers = { canonical: localise(canonical, origin), final: localise(final, origin) };
  return `<!doctype html><meta charset="utf-8"><title>O49 snap replay</title><style>body{margin:0;background:#f4f0e7;color:#16352c;font:14px system-ui}header{padding:12px 18px}canvas{display:block;width:100vw;height:calc(100vh - 52px)}label{margin-right:16px}</style><header><strong>O49 full-route replay · local metres</strong> <label><input id="canonical" type="checkbox" checked> O48 canonical</label><label><input id="final" type="checkbox" checked> O49 Final</label></header><canvas></canvas><script>const data=${JSON.stringify(layers)};const c=document.querySelector('canvas'),x=c.getContext('2d');function draw(){c.width=c.clientWidth*devicePixelRatio;c.height=c.clientHeight*devicePixelRatio;x.scale(devicePixelRatio,devicePixelRatio);x.clearRect(0,0,c.clientWidth,c.clientHeight);const all=[...data.canonical,...data.final],xs=all.map(p=>p.x),ys=all.map(p=>p.y),pad=35,s=Math.min((c.clientWidth-pad*2)/(Math.max(...xs)-Math.min(...xs)||1),(c.clientHeight-pad*2)/(Math.max(...ys)-Math.min(...ys)||1)),tx=v=>pad+(v-Math.min(...xs))*s,ty=v=>c.clientHeight-pad-(v-Math.min(...ys))*s;for(const [id,color,width] of [['canonical','#b65b48',3],['final','#173f35',5]]){if(!document.getElementById(id).checked)continue;x.beginPath();data[id].forEach((p,i)=>i?x.lineTo(tx(p.x),ty(p.y)):x.moveTo(tx(p.x),ty(p.y)));x.strokeStyle=color;x.lineWidth=width;x.lineJoin='round';x.lineCap='round';x.stroke()}}addEventListener('resize',draw);document.querySelectorAll('input').forEach(i=>i.onchange=draw);draw()</script>`;
}

const compiled = compileMatcher();
try {
  const sessions = loadPrivateEvidence();
  // After the explicitly authorized QA display mutation, production
  // `route_points` is O49 Final rather than the original canonical input.
  // Keep this replay reproducible from the exact pre-write local backup.
  const backupPath = resolve(here, 'SNAP_BEFORE_O49_DB_BACKUP.json');
  if (existsSync(backupPath)) {
    const originalSnap = JSON.parse(readFileSync(backupPath, 'utf8')).source;
    const index = sessions.findIndex(session => session.id === 2073);
    if (index >= 0) sessions[index] = originalSnap;
    else sessions.push(originalSnap);
  }
  const token = loadMapboxToken();
  const results = [];
  let snapPrivate = null;
  for (const session of sessions) {
    const canonical = (session.route_points ?? []).map(normalise);
    if (canonical.length < 2) continue;
    const result = await compiled.matcher.snapTrack(canonical, {
      mapboxToken: token,
      totalTimeoutMs: 60_000,
      perCallTimeoutMs: 8_000,
      concurrency: 4,
    });
    results.push(summary(session, canonical, result));
    if (session.id === 2073 && result.ok) snapPrivate = { canonical, final: result.points };
  }
  writeFileSync(resolve(here, 'O49_REAL_REPLAY_RESULTS.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  if (snapPrivate) writeFileSync(resolve(here, 'O49_SNAP_FULL_ROUTE_PREVIEW.html'), preview(snapPrivate.canonical, snapPrivate.final));
  console.log(JSON.stringify({ output: 'O49_REAL_REPLAY_RESULTS.json', results }, null, 2));
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
}
