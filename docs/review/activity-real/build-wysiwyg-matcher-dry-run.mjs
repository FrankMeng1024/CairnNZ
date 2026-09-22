#!/usr/bin/env node
/* Current production matcher dry-run. SELECT-only; no coordinates persisted. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const APP = path.join(ROOT, 'app');
const OUTPUT = path.join(HERE, 'WYSIWYG_MATCHER_DRY_RUN.json');
const SESSION_IDS = [2062, 2067, 2069, 2070, 2071, 2072];

const toRad = value => value * Math.PI / 180;
function haversineM(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}
function pathLengthM(points) {
  return points.slice(1).reduce((sum, point, index) => sum + haversineM(points[index], point), 0);
}
function rounded(value, digits = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}
function angleDelta(a, b) {
  const delta = Math.abs(a - b) % 360;
  return delta > 180 ? 360 - delta : delta;
}
function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
    - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function reversalCount(points, threshold = 120) {
  let count = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    if (angleDelta(bearing(points[index - 1], points[index]), bearing(points[index], points[index + 1])) >= threshold) count += 1;
  }
  return count;
}
function parsePoints(value) {
  if (Array.isArray(value)) return value;
  const parsed = typeof value === 'string' && value.length > 0 ? JSON.parse(value) : [];
  return Array.isArray(parsed) ? parsed : [];
}
// Kept explicit instead of sharing review code so the matcher input mapping is
// visible and auditable beside the output artifact.
function matcherPoint(point) {
  return {
    lat: Number(point.lat),
    lng: Number(point.lng),
    alt: point.alt == null ? null : Number(point.alt),
    accuracy: point.acc == null ? null : Number(point.acc),
    speed: point.speed_mps == null ? null : Number(point.speed_mps),
    t: Number(point.t),
    rawOrdinal: point.raw_ordinal == null ? null : Number(point.raw_ordinal),
    segmentId: point.segment_id || 'legacy-segment',
  };
}

function readProductionEvidence() {
  const remote = String.raw`
const db=require('/app/src/config/db');
(async()=>{
  const [rows]=await db.query('SELECT id,name,client_activity_id,route_points FROM sessions WHERE id IN (${SESSION_IDS.join(',')}) ORDER BY id');
  process.stdout.write(JSON.stringify(rows));
  await db.end();
})().catch(e=>{console.error(e.stack);process.exit(1)});
`;
  return JSON.parse(execFileSync('ssh', [
    'ubuntu@122.51.174.118',
    'sudo -n docker exec -i cairn-backend node',
  ], { input: remote, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }));
}

function loadSnapTrack() {
  const babel = require(path.join(APP, 'node_modules/@babel/core'));
  const sourcePath = path.join(APP, 'src/services/routing/snapTrack.ts');
  const transformed = babel.transformFileSync(sourcePath, {
    filename: sourcePath,
    presets: [[require.resolve('@babel/preset-typescript', { paths: [APP] }), { allowDeclareFields: true }]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [APP] })],
    sourceMaps: false,
    babelrc: false,
    configFile: false,
  });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', transformed.code)(module, module.exports, require);
  return module.exports;
}

function splitSegments(points) {
  const segments = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || current[0].segmentId !== point.segmentId) segments.push([point]);
    else current.push(point);
  }
  return segments;
}

async function main() {
  const token = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_TOKEN is required; use the existing EAS preview environment wrapper.');
  const { snapTrack, evaluateMatchedGeometryQuality } = loadSnapTrack();
  const rows = readProductionEvidence();
  const sessions = [];
  for (const row of rows) {
    const points = parsePoints(row.route_points).map(matcherPoint);
    const segments = splitSegments(points);
    const segmentResults = [];
    for (const [segmentIndex, segment] of segments.entries()) {
      if (segment.length < 2) {
        segmentResults.push({ segmentIndex, inputPointCount: segment.length, decision: 'canonical-fallback', reason: 'too-short' });
        continue;
      }
      const startedAt = Date.now();
      const result = await snapTrack(segment, {
        mapboxToken: token,
        totalTimeoutMs: 4_000,
        perCallTimeoutMs: 1_600,
        concurrency: 4,
      });
      const output = result.ok ? result.points : segment;
      const quality = result.ok ? evaluateMatchedGeometryQuality(segment, output) : null;
      segmentResults.push({
        segmentIndex,
        inputPointCount: segment.length,
        inputLengthM: rounded(pathLengthM(segment)),
        inputReversalCount: reversalCount(segment),
        outputPointCount: output.length,
        outputLengthM: rounded(pathLengthM(output)),
        outputReversalCount: reversalCount(output),
        lengthRatio: rounded(pathLengthM(output) / Math.max(1, pathLengthM(segment)), 5),
        decision: result.ok && result.stats.chunksOk > 0
          ? (result.stats.chunksFallback > 0 || result.stats.lostRuns > 0 ? 'hybrid' : 'matched')
          : 'canonical-fallback',
        reason: result.ok
          ? (result.stats.chunksOk > 0 ? 'production-gates-accepted-at-least-one-subsection' : 'no-derived-chunks')
          : result.reason,
        quality,
        stats: result.stats,
        durationMs: Date.now() - startedAt,
      });
    }
    const almostDone = row.id === 2072;
    const chronologyWindows = almostDone
      ? [
          { key: 'u_turn', start: 119, end: 130 },
          { key: 'deliberate_z', start: 163, end: 188 },
          { key: 'repeated_corridor', start: 188, end: 210 },
        ].map(window => {
          const selected = points.filter(point => point.rawOrdinal >= window.start && point.rawOrdinal <= window.end);
          return { key: window.key, rawOrdinalRange: [window.start, window.end], pointCount: selected.length, lengthM: rounded(pathLengthM(selected)), reversalCount: reversalCount(selected) };
        })
      : [];
    sessions.push({
      serverId: row.id,
      name: almostDone ? 'almost done (immutable pending source)' : row.name,
      clientActivityId: row.client_activity_id,
      inputAuthority: 'persisted canonical segments used by current Save matcher',
      segmentResults,
      chronologyWindows,
    });
  }
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'No coordinates or Mapbox token are persisted; production access is SELECT-only.',
    productionConfiguration: {
      matcher: 'snapTrack.ts v7 hybrid, loaded directly',
      profile: 'mapbox/walking',
      tidy: true,
      perCallTimeoutMs: 1_600,
      perSegmentTotalTimeoutMs: 4_000,
      chunkSize: 80,
      chunkOverlap: 1,
      qualityGates: 'unchanged current code',
    },
    sessions,
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output: OUTPUT, sessions: sessions.map(session => ({ id: session.serverId, decisions: session.segmentResults.map(segment => segment.decision) })) }) + '\n');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
