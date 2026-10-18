#!/usr/bin/env node

/**
 * Builds a private, read-only Point-animation fixture from the Owner's saved
 * Routes and live Mapbox Walking responses. Precise coordinates stay in the
 * private fixture file; the shareable receipt contains hashes and distances.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const token = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();
if (!token.startsWith('pk.') || token.length < 40) throw new Error('Mapbox public token unavailable');
const outputDir = path.resolve(process.env.CAIRN_REAL_POINT_FIXTURE_DIR || '/tmp/cairn-o86-real-point-fixtures');
fs.mkdirSync(outputDir, { recursive: true });

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const queryProgram = `
const pool=require('./src/config/db');
(async()=>{
  const [routes]=await pool.execute(
    'SELECT id,name,points,ordered_draft FROM routes WHERE id IN (92,93,94,95,96,97) ORDER BY id'
  );
  process.stdout.write(JSON.stringify({routes}));
  await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();
const remoteCommand = `docker exec cairn-backend sh -lc ${shellQuote(`cd /app && node -e ${shellQuote(queryProgram)}`)}`;
const production = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', remoteCommand,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value;
const routes = new Map(production.routes.map(value => [Number(value.id), {
  id: Number(value.id), name: String(value.name), points: parseJson(value.points) ?? [],
  draft: parseJson(value.ordered_draft),
}]));
for (const id of [92, 93, 94, 95, 96, 97]) {
  if ((routes.get(id)?.points.length ?? 0) < 2) throw new Error(`Route ${id} geometry unavailable`);
}

const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pointHash = points => hash(points.map(point => [
  Number(Number(point.lng).toFixed(7)), Number(Number(point.lat).toFixed(7)),
]));
const radians = value => value * Math.PI / 180;
function distanceM(a, b) {
  const dLat = radians(Number(b.lat) - Number(a.lat));
  const dLng = radians(Number(b.lng) - Number(a.lng));
  const lat1 = radians(Number(a.lat));
  const lat2 = radians(Number(b.lat));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
const lineLengthM = points => points.slice(1).reduce((sum, point, index) => sum + distanceM(points[index], point), 0);
const rounded = value => Number(Number(value).toFixed(2));

async function walkingResponse(start, target) {
  const query = new URLSearchParams({
    alternatives: 'false', geometries: 'geojson', overview: 'full', steps: 'false',
    radiuses: '25;25', access_token: token,
  });
  const coordinates = `${Number(start.lng).toFixed(7)},${Number(start.lat).toFixed(7)};${Number(target.lng).toFixed(7)},${Number(target.lat).toFixed(7)}`;
  const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/walking/${coordinates}?${query}`);
  const body = await response.json();
  if (!response.ok || body.code !== 'Ok' || !Array.isArray(body.routes?.[0]?.geometry?.coordinates)
    || body.routes[0].geometry.coordinates.length < 2) {
    throw new Error(`Mapbox walking failed: HTTP ${response.status} ${String(body.code || body.message)}`);
  }
  const provider = body.routes[0].geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
  return { body, provider };
}

async function matchedCandidates(route) {
  const count = Math.min(100, route.points.length);
  const entries = Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round(index * (route.points.length - 1) / Math.max(1, count - 1));
    return { sourceIndex, raw: route.points[sourceIndex] };
  });
  const coordinates = entries.map(entry => `${Number(entry.raw.lng).toFixed(6)},${Number(entry.raw.lat).toFixed(6)}`).join(';');
  const query = new URLSearchParams({
    geometries: 'geojson', overview: 'full', tidy: 'true',
    radiuses: entries.map(() => '25').join(';'), access_token: token,
  });
  const response = await fetch(`https://api.mapbox.com/matching/v5/mapbox/walking/${coordinates}?${query}`);
  const body = await response.json();
  if (!response.ok || body.code !== 'Ok' || !Array.isArray(body.tracepoints)) {
    throw new Error(`Mapbox matching failed for Route ${route.id}: HTTP ${response.status} ${String(body.code || body.message)}`);
  }
  return entries.flatMap((entry, index) => {
    const tracepoint = body.tracepoints[index];
    return Array.isArray(tracepoint?.location)
      ? [{ ...entry, snapped: { lng: tracepoint.location[0], lat: tracepoint.location[1] } }]
      : [];
  });
}

const candidates = new Map();
for (const id of [92, 93, 94, 97]) candidates.set(id, await matchedCandidates(routes.get(id)));
const atFraction = (id, fraction) => {
  const values = candidates.get(id);
  if (!values?.length) throw new Error(`No network-matched candidate for Route ${id}`);
  return values[Math.round((values.length - 1) * fraction)];
};
const range = (id, startFraction, endFraction) => {
  const first = atFraction(id, startFraction);
  const last = atFraction(id, endFraction);
  const from = Math.min(first.sourceIndex, last.sourceIndex);
  const to = Math.max(first.sourceIndex, last.sourceIndex);
  return { route: routes.get(id).points.slice(from, to + 1), first, last };
};
const test1Leg = range(92, 0.12, 0.88);
const test2Leg = range(93, 0.08, 0.94);
const test3Leg = range(94, 0.05, 0.95);
const test4Leg = range(97, 0.08, 0.92);
const endingAt = (id, candidate) => routes.get(id).points.slice(
  Math.max(0, candidate.sourceIndex - 3),
  candidate.sourceIndex + 1,
);

const definitions = [
  {
    id: 'real-test1-winding-network',
    sourceRouteId: 92,
    targetRouteId: 92,
    route: endingAt(92, test1Leg.first),
    target: test1Leg.last.raw,
    expectedUse: 'Live walking provider follows the mapped multi-turn Test1 environment between two network-matched saved points.',
  },
  {
    id: 'real-test2-long-connected-network',
    sourceRouteId: 93,
    targetRouteId: 93,
    route: endingAt(93, test2Leg.first),
    target: test2Leg.last.raw,
    expectedUse: 'Live walking provider supplies the longer connected Test2 path with genuine turns.',
  },
  {
    id: 'real-test4-river-network',
    sourceRouteId: 97,
    targetRouteId: 97,
    route: endingAt(97, test4Leg.first),
    target: test4Leg.last.raw,
    expectedUse: 'Live walking provider, not map-pixel inference, chooses the supported network around the river-adjacent Test4 context.',
  },
  {
    id: 'real-test3-provider-return',
    sourceRouteId: 94,
    targetRouteId: 94,
    route: test3Leg.route,
    target: test3Leg.first.raw,
    expectedUse: 'Live walking provider returns from the saved Test3 endpoint toward an earlier real-network point. This is a legitimate provider-backed return, not proof that the exact historical retrace corridor was reused.',
  },
];

// Route 95 contains four historically saved Point legs. Replay each leg's
// actual start/target pair against today's walking network and retain a case
// only when the live provider still demonstrates the bounded-detour rejection
// rule. No historical provider payload or gesture is invented.
const route95Parts = routes.get(95).draft?.parts ?? [];
let route95Negative = null;
for (let partIndex = route95Parts.length - 1; partIndex >= 0; partIndex -= 1) {
  const part = route95Parts[partIndex];
  if (part?.resolution !== 'point' || !Array.isArray(part.points) || part.points.length < 2) continue;
  const prefixParts = route95Parts.slice(0, partIndex);
  const route = prefixParts.flatMap((value, index) => index === 0 ? value.points : value.points.slice(1));
  const start = route.at(-1);
  const target = part.points.at(-1);
  if (!start || !target) continue;
  const { body, provider } = await walkingResponse(start, target);
  const directM = distanceM(start, target);
  const routedM = lineLengthM(provider);
  const absurd = directM <= 250 && routedM > Math.max(400, directM * 5);
  if (!absurd) continue;
  route95Negative = {
    definition: {
      id: `real-testa1-live-detour-rejection-part-${partIndex + 1}`,
      sourceRouteId: 95,
      targetRouteId: 95,
      route,
      target,
      expectedUse: `Current live Mapbox walking replay of Route 95 Point part ${partIndex + 1}; the provider detour is geographically real but exceeds the established nearby-target bound and must leave the draft unchanged.`,
      expectedResult: 'rejected-detour',
      providerDelayMs: 700,
    },
    body,
    provider,
    directM,
    routedM,
  };
  break;
}

const scenarios = [];
const receipts = [];
for (const definition of definitions) {
  const start = definition.route.at(-1);
  const { body, provider } = await walkingResponse(start, definition.target);
  const snappedStart = body.waypoints?.[0]?.location
    ? { lng: body.waypoints[0].location[0], lat: body.waypoints[0].location[1] } : start;
  const snappedTarget = body.waypoints?.[1]?.location
    ? { lng: body.waypoints[1].location[0], lat: body.waypoints[1].location[1] } : definition.target;
  const directM = distanceM(start, definition.target);
  const routedM = lineLengthM(provider);
  scenarios.push({
    id: definition.id,
    route: definition.route,
    target: definition.target,
    provider,
    providerResponse: body,
    interrupt: false,
    expectedResult: 'accepted',
    provenance: `RECORDED_LIVE_MAPBOX_WALKING_RESPONSE_REPLAYED_THROUGH_ACTUAL_EDITOR: ${definition.expectedUse}`,
  });
  receipts.push({
    id: definition.id,
    sourceRouteId: definition.sourceRouteId,
    targetRouteId: definition.targetRouteId,
    request: {
      profile: 'mapbox/walking', alternatives: false, geometries: 'geojson', overview: 'full',
      steps: false, radiusesM: [25, 25], endpointHash: pointHash([start, definition.target]),
    },
    response: {
      httpStatus: 200, code: body.code, providerVertexCount: provider.length,
      providerGeometryHash: pointHash(provider), directDistanceM: rounded(directM),
      routedDistanceM: rounded(routedM), detourRatio: rounded(routedM / Math.max(1, directM)),
      snappedStartShiftM: rounded(distanceM(start, snappedStart)),
      snappedTargetShiftM: rounded(distanceM(definition.target, snappedTarget)),
    },
    expectedUse: definition.expectedUse,
  });
}

// A real-provider interruption case exercises immediate user takeover without
// sacrificing the uninterrupted winding scenario's motion evidence.
const winding = scenarios.find(value => value.id === 'real-test1-winding-network');
if (winding) scenarios.push({
  ...winding,
  id: 'real-test1-winding-network-interrupted',
  interrupt: true,
  provenance: `${winding.provenance} This duplicate replay is interrupted by a real browser drag during the accepted follow.`,
});

if (route95Negative) {
  const { definition, body, provider, directM, routedM } = route95Negative;
  const start = definition.route.at(-1);
  scenarios.push({
    id: definition.id,
    route: definition.route,
    target: definition.target,
    provider,
    providerResponse: body,
    interrupt: false,
    expectedResult: definition.expectedResult,
    providerDelayMs: definition.providerDelayMs,
    provenance: `LIVE_MAPBOX_WALKING_NEGATIVE_RECORDED_THEN_REPLAYED_THROUGH_ACTUAL_EDITOR: ${definition.expectedUse}`,
  });
  receipts.push({
    id: definition.id,
    sourceRouteId: definition.sourceRouteId,
    targetRouteId: definition.targetRouteId,
    request: {
      profile: 'mapbox/walking', alternatives: false, geometries: 'geojson', overview: 'full',
      steps: false, radiusesM: [25, 25], endpointHash: pointHash([start, definition.target]),
    },
    response: {
      httpStatus: 200, code: body.code, providerVertexCount: provider.length,
      providerGeometryHash: pointHash(provider), directDistanceM: rounded(directM),
      routedDistanceM: rounded(routedM), detourRatio: rounded(routedM / Math.max(1, directM)),
    },
    expectedUse: definition.expectedUse,
    expectedResult: definition.expectedResult,
  });
}
if (!route95Negative) {
  throw new Error('No current Route 95 Point endpoint produced the required live nearby-target detour rejection');
}

const generatedAt = new Date().toISOString();
const receiptDocument = {
  generatedAt,
  source: 'read-only production Routes 92/93/94/95/96/97; no Route or Activity writes',
  privacy: 'No token, owner identity, or coordinate payload is present.',
  scenarios: receipts,
};
const receiptText = `${JSON.stringify(receiptDocument, null, 2)}\n`;
const receiptSha256 = crypto.createHash('sha256').update(receiptText).digest('hex');
fs.writeFileSync(path.join(outputDir, 'SANITIZED_PROVIDER_RECEIPT.json'), receiptText);
const privateFixture = path.join(outputDir, 'PRIVATE_REAL_POINT_FIXTURES.json');
fs.writeFileSync(privateFixture, `${JSON.stringify({
  evidenceClass: 'RECORDED_LIVE_MAPBOX_WALKING_RESPONSES_REPLAYED_THROUGH_ACTUAL_EDITOR_WITH_OWNER_SAVED_ROUTE_CONTEXT',
  providerReceipt: { generatedAt, sha256: receiptSha256 },
  scenarios,
}, null, 2)}\n`, { mode: 0o600 });
process.stdout.write(JSON.stringify({ outputDir, privateFixture, scenarioCount: scenarios.length }));
