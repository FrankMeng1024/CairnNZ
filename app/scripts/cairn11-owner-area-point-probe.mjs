#!/usr/bin/env node

/**
 * Read-only provider coverage probe for the exact #10 Activity 2139 Point
 * transaction. Private coordinates stay in memory; the receipt stores only
 * hashes, offsets, distances, and provider classifications.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_TOKEN is required');
const fixturePath = process.env.CAIRN11_PRIVATE_FIXTURE ?? '/tmp/cairn9_private_bad_route_hex.tsv';
const outputPath = path.resolve(process.env.CAIRN11_POINT_RECEIPT ?? '/tmp/cairn11-owner-area-point/receipt.json');
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashPoint = point => sha([Number(point.lat).toFixed(7), Number(point.lng).toFixed(7)]);
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const offsetPoint = (point, eastM, northM) => ({
  lat: point.lat + northM / 110_574,
  lng: point.lng + eastM / (111_320 * Math.cos(point.lat * Math.PI / 180)),
});
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

if (!fs.existsSync(fixturePath)) throw new Error('Protected Activity 2139 fixture unavailable');
const records = fs.readFileSync(fixturePath, 'utf8').trim().split(/\r?\n/);
if (records.length !== 2) throw new Error('Protected fixture identity mismatch');
const canonical = JSON.parse(Buffer.from(records[0], 'hex').toString('utf8'));
if (!Array.isArray(canonical) || canonical.length !== 728) throw new Error('Activity 2139 canonical point count mismatch');
const points = canonical.map(value => ({ lat: Number(value.lat), lng: Number(value.lng), segmentId: String(value.segment_id ?? value.segmentId ?? 'legacy') }));
const segments = [];
for (const point of points) {
  if (segments.at(-1)?.id !== point.segmentId) segments.push({ id: point.segmentId, points: [] });
  segments.at(-1).points.push(point);
}
if (segments.length !== 2 || segments[0].points.length !== 718 || segments[1].points.length !== 10) {
  throw new Error('Activity 2139 segment structure mismatch');
}

const start = points.at(-1);
const target = segments[0].points[690];
if (![start.lat, start.lng, target.lat, target.lng].every(Number.isFinite)
  || Math.abs(start.lat) > 90 || Math.abs(target.lat) > 90
  || Math.abs(start.lng) > 180 || Math.abs(target.lng) > 180) {
  throw new Error('Point request is not valid WGS84 longitude/latitude');
}

const productionSource = `
const pool=require('./src/config/db');
(async()=>{const [rows]=await pool.execute(
  \`SELECT s.id,s.user_id,s.client_activity_id,s.name,s.source_provenance,
          JSON_LENGTH(s.route_points_canonical) point_count,u.email
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=2139\`);
  process.stdout.write(JSON.stringify(rows));await pool.end();
})().catch(error=>{console.error(error.message);process.exit(1)});
`.trim();
const remote = `docker exec cairn-backend sh -lc ${quote(`cd /app && node -e ${quote(productionSource)}`)}`;
const productionRows = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', remote,
], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
if (productionRows.length !== 1 || Number(productionRows[0].id) !== 2139
  || productionRows[0].name !== 'bad' || Number(productionRows[0].point_count) !== 728) {
  throw new Error('Activity 2139 production provenance gate failed');
}

async function request(startPoint, targetPoint, label, startOffsetM, targetOffsetM) {
  const coordinates = `${startPoint.lng},${startPoint.lat};${targetPoint.lng},${targetPoint.lat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?alternatives=false&geometries=geojson&overview=full&steps=false&radiuses=25%3B25&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  const body = await response.json().catch(() => null);
  const route = body?.routes?.[0];
  const geometry = route?.geometry?.coordinates;
  const first = Array.isArray(geometry?.[0]) ? { lng: Number(geometry[0][0]), lat: Number(geometry[0][1]) } : null;
  const lastRaw = Array.isArray(geometry) ? geometry.at(-1) : null;
  const last = Array.isArray(lastRaw) ? { lng: Number(lastRaw[0]), lat: Number(lastRaw[1]) } : null;
  return {
    label,
    startOffsetM,
    targetOffsetM,
    requestIdentitySha256: sha({
      profile: 'walking', alternatives: false, geometries: 'geojson', overview: 'full',
      steps: false, radiuses: '25;25', start: hashPoint(startPoint), target: hashPoint(targetPoint),
    }),
    httpStatus: response.status,
    code: body?.code ?? null,
    routeCount: Array.isArray(body?.routes) ? body.routes.length : null,
    geometryPointCount: Array.isArray(geometry) ? geometry.length : 0,
    geometrySha256: Array.isArray(geometry) ? sha(geometry.map(value => [Number(value[0]).toFixed(7), Number(value[1]).toFixed(7)])) : null,
    snappedStartShiftM: first ? Number(distanceM(startPoint, first).toFixed(2)) : null,
    snappedTargetShiftM: last ? Number(distanceM(targetPoint, last).toFixed(2)) : null,
  };
}

const probes = [await request(start, target, 'exact-current-editor-request', [0, 0], [0, 0])];
const offsets = [
  [5, 0], [-5, 0], [0, 5], [0, -5],
  [10, 0], [-10, 0], [0, 10], [0, -10],
  [20, 0], [-20, 0], [0, 20], [0, -20],
  [25, 0], [30, 0], [35, 0],
];
for (const [east, north] of offsets) {
  probes.push(await request(offsetPoint(start, east, north), target, `start-offset-${east}-${north}`, [east, north], [0, 0]));
  probes.push(await request(start, offsetPoint(target, east, north), `target-offset-${east}-${north}`, [0, 0], [east, north]));
  probes.push(await request(offsetPoint(start, east, north), offsetPoint(target, east, north), `paired-offset-${east}-${north}`, [east, north], [east, north]));
}

const exact = probes[0];
const nearbySuccesses = probes.slice(1).filter(value => value.httpStatus === 200 && value.code === 'Ok' && value.routeCount > 0);
const receipt = {
  generatedAt: new Date().toISOString(),
  source: {
    activityId: 2139,
    clientActivityIdSha256: sha(productionRows[0].client_activity_id),
    ownerIdentitySha256: sha(`${productionRows[0].user_id}:${String(productionRows[0].email).toLowerCase()}`),
    sourceProvenance: productionRows[0].source_provenance,
    canonicalPointCount: points.length,
    segmentPointCounts: segments.map(segment => segment.points.length),
  },
  currentEditorRequest: {
    startRole: 'last canonical point of Activity-derived draft',
    targetRole: 'deterministic QA crosshair at first segment canonical index 690',
    exactHistoricalFingerTraceAvailable: false,
    coordinateSystem: 'WGS84 longitude,latitude',
    startSha256: hashPoint(start),
    targetSha256: hashPoint(target),
    straightDistanceM: Number(distanceM(start, target).toFixed(2)),
    profile: 'mapbox/walking',
    radiusesM: [25, 25],
  },
  exact,
  nearbyProbePolicy: {
    purpose: 'coverage diagnosis only; never committed or substituted in product',
    maximumOffsetM: 35,
    productSnappingRadiusChanged: false,
  },
  nearbyProbes: probes.slice(1),
  nearbySuccessCount: nearbySuccesses.length,
  nearestSuccessfulProbe: nearbySuccesses[0] ?? null,
  conclusion: exact.code === 'NoSegment'
    ? (nearbySuccesses.length ? 'EXACT_NO_SEGMENT_WITH_NEARBY_PROVIDER_SUPPORT' : 'NO_PROVIDER_SEGMENT_WITHIN_BOUNDED_NEARBY_PROBES')
    : exact.code === 'Ok' ? 'EXACT_SUPPORTED' : 'OTHER_PROVIDER_RESULT',
  productionWrites: 0,
  privateCoordinatesPersisted: false,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ outputPath, exact: { httpStatus: exact.httpStatus, code: exact.code, routeCount: exact.routeCount }, nearbySuccessCount: nearbySuccesses.length, conclusion: receipt.conclusion }, null, 2));
