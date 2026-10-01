#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const planPath = path.resolve(arg('--plan', path.join(repoRoot, 'docs/review/real-map-snap/ROUTE_PLAN.json')));
const outputRoot = path.resolve(arg(
  '--output',
  path.join(os.homedir(), 'Desktop', 'Cairn_RealMap_Snap_Final_Review', 'frozen-campaign'),
));
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const sha256 = value => crypto.createHash('sha256').update(
  typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const toRad = value => value * Math.PI / 180;
const hav = (a, b) => {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
const pathLength = coordinates => coordinates.slice(1).reduce(
  (sum, coordinate, index) => sum + hav(coordinates[index], coordinate),
  0,
);

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4_294_967_296;
  };
}

function routeSeed(base, routeId) {
  return Number.parseInt(sha256(`${base}:${routeId}`).slice(0, 8), 16) >>> 0;
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function cumulativeDistances(coordinates) {
  const cumulative = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    cumulative.push(cumulative[index - 1] + hav(coordinates[index - 1], coordinates[index]));
  }
  return cumulative;
}

function pointAtFraction(coordinates, cumulative, fraction) {
  const target = cumulative[cumulative.length - 1] * Math.max(0, Math.min(1, fraction));
  let index = 1;
  while (index < cumulative.length && cumulative[index] < target) index += 1;
  const right = Math.min(coordinates.length - 1, index);
  const left = Math.max(0, right - 1);
  const distance = cumulative[right] - cumulative[left];
  const ratio = distance > 0 ? (target - cumulative[left]) / distance : 0;
  return [
    coordinates[left][0] + (coordinates[right][0] - coordinates[left][0]) * ratio,
    coordinates[left][1] + (coordinates[right][1] - coordinates[left][1]) * ratio,
  ];
}

function offsetMeters(coordinate, eastM, northM) {
  return [
    coordinate[0] + eastM / (111_320 * Math.max(0.2, Math.cos(toRad(coordinate[1])))),
    coordinate[1] + northM / 111_320,
  ];
}

function noisyObservation(reference, before, after, state, random, degraded, progress) {
  const eastScale = 111_320 * Math.max(0.2, Math.cos(toRad(reference[1])));
  const dx = (after[0] - before[0]) * eastScale;
  const dy = (after[1] - before[1]) * 111_320;
  const magnitude = Math.max(0.01, Math.hypot(dx, dy));
  const perpendicular = [-dy / magnitude, dx / magnitude];
  state.wander = state.wander * 0.92 + gaussian(random) * (degraded ? 1.8 : 0.7);
  state.along = state.along * 0.78 + gaussian(random) * (degraded ? 1.1 : 0.45);
  const sustainedBias = degraded && progress >= 0.28 && progress <= 0.48
    ? 14 + 8 * Math.sin((progress - 0.28) / 0.2 * Math.PI)
    : degraded && progress >= 0.72 && progress <= 0.82 ? -11 : 2.2;
  let crossM = sustainedBias + state.wander;
  let alongM = state.along;
  if (degraded && (Math.abs(progress - 0.18) < 0.004 || Math.abs(progress - 0.66) < 0.004)) {
    crossM += random() > 0.5 ? 32 : -32;
    alongM += 14;
  }
  return offsetMeters(
    reference,
    perpendicular[0] * crossM + dx / magnitude * alongM,
    perpendicular[1] * crossM + dy / magnitude * alongM,
  );
}

async function fetchOsmReference(route) {
  const coordinates = route.waypoints.map(value => value.join(',')).join(';');
  const url = `https://routing.openstreetmap.de/routed-foot/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&annotations=nodes`;
  const startedAt = Date.now();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'CairnNZ-O70-RealMap-QA/1.0 reference-freeze' },
  });
  const body = await response.json();
  if (!response.ok || body.code !== 'Ok' || !body.routes?.[0]?.geometry?.coordinates?.length) {
    throw new Error(`Reference route ${route.id} failed: ${response.status} ${body.code ?? body.message ?? 'unknown'}`);
  }
  return {
    url,
    responseStatus: response.status,
    elapsedMs: Date.now() - startedAt,
    body,
    coordinates: body.routes[0].geometry.coordinates,
  };
}

function profileFor(route, profile, mode) {
  const degraded = profile === 'degraded';
  const baseSeed = mode === 'run' ? 71039 : degraded ? 71023 : 71011;
  const durationS = mode === 'run'
    ? Math.max(360, Math.round(route.referenceLengthM / 2.55) + (route.stop?.[1] ?? 0))
    : route.logicalDurationS;
  const preferred = mode === 'run' ? Math.min(route.sampleIntervalS, 6) : route.sampleIntervalS;
  const intervalS = Math.max(preferred, durationS / 220);
  return { degraded, baseSeed, seed: routeSeed(baseSeed, route.id), durationS, intervalS };
}

function makeRawEvents(route, coordinates, profile, mode, routeIndex) {
  const settings = profileFor(route, profile, mode);
  const random = mulberry32(settings.seed);
  const cumulative = cumulativeDistances(coordinates);
  const count = Math.max(12, Math.ceil(settings.durationS / settings.intervalS) + 1);
  const observationStartMs = Date.UTC(2026, 8, 1 + routeIndex, 8, 0, 0);
  const state = { wander: 0, along: 0 };
  const events = [];
  let ordinal = 0;
  for (let index = 0; index < count; index += 1) {
    const elapsedS = Math.min(settings.durationS, index * settings.intervalS);
    const temporalProgress = elapsedS / settings.durationS;
    const [stopFraction, stopSeconds] = route.stop ?? [null, 0];
    let routeProgress = temporalProgress;
    if (stopFraction != null && stopSeconds > 0) {
      const stopStartS = stopFraction * settings.durationS;
      if (elapsedS >= stopStartS && elapsedS <= stopStartS + stopSeconds) routeProgress = stopFraction;
      else if (elapsedS > stopStartS + stopSeconds) {
        routeProgress = stopFraction + (elapsedS - stopStartS - stopSeconds)
          / Math.max(1, settings.durationS - stopStartS - stopSeconds) * (1 - stopFraction);
      }
    }
    const blackout = route.trueBlackout
      && temporalProgress >= route.trueBlackout[0]
      && temporalProgress <= route.trueBlackout[1];
    if (blackout) continue;
    const reference = pointAtFraction(coordinates, cumulative, routeProgress);
    const before = pointAtFraction(coordinates, cumulative, Math.max(0, routeProgress - 0.002));
    const after = pointAtFraction(coordinates, cumulative, Math.min(1, routeProgress + 0.002));
    const observed = noisyObservation(reference, before, after, state, random, settings.degraded, routeProgress);
    const observationTimeMs = Math.round(observationStartMs + elapsedS * 1_000);
    let deliveryTimeMs = observationTimeMs;
    let appState = 'active';
    if (route.lateBatch && temporalProgress >= route.lateBatch[0] && temporalProgress <= route.lateBatch[1]) {
      deliveryTimeMs = Math.round(observationStartMs
        + (route.lateBatch[1] * settings.durationS + route.lateBatch[2]) * 1_000);
      appState = 'background';
    }
    const stopped = stopFraction != null && Math.abs(routeProgress - stopFraction) < 1e-6;
    const reportedAccuracy = settings.degraded
      ? Math.max(7, Math.min(45, 16 + gaussian(random) * 6 + (temporalProgress > 0.28 && temporalProgress < 0.48 ? 9 : 0)))
      : Math.max(3, Math.min(16, 7 + gaussian(random) * 2.2));
    const missingAccuracy = settings.degraded && random() < 0.06;
    const expectedSpeed = stopped ? 0 : route.referenceLengthM / Math.max(1, settings.durationS - stopSeconds);
    const speedMps = stopped ? (random() < 0.8 ? 0 : null)
      : settings.degraded && random() < 0.18 ? null
        : settings.degraded && random() < 0.08 ? expectedSpeed * 2.8
          : Math.max(0, expectedSpeed + gaussian(random) * (mode === 'run' ? 0.5 : 0.28));
    events.push({
      ordinal: ordinal++,
      observationTimeMs,
      deliveryTimeMs,
      appState,
      coordinate: { lat: observed[1], lng: observed[0] },
      accuracyM: missingAccuracy ? null : Number(reportedAccuracy.toFixed(2)),
      speedMps: speedMps == null ? null : Number(speedMps.toFixed(3)),
      speedAccuracyMps: random() < 0.08 ? null : Number((mode === 'run' ? 0.7 : 0.45).toFixed(2)),
      source: 'simulator',
    });
  }
  return {
    settings,
    clock: {
      observationStartMs,
      observationEndMs: observationStartMs + Math.round(settings.durationS * 1_000),
      observationIntervalSeconds: Number(settings.intervalS.toFixed(3)),
      deliveryMode: route.lateBatch ? 'accelerated-with-late-batch' : 'accelerated-coherent-clock',
    },
    events,
  };
}

const activitySpecs = [];
for (const route of plan.routes) activitySpecs.push({ route, mode: 'hike', profile: 'normal' });
for (const id of ['U02', 'U03', 'M02', 'M03', 'X02', 'X04']) {
  const route = plan.routes.find(value => value.id === id);
  activitySpecs.push({ route, mode: 'hike', profile: 'degraded' });
  activitySpecs.push({ route, mode: 'run', profile: 'degraded' });
}

fs.mkdirSync(outputRoot, { recursive: true });
const references = new Map();
for (const [index, route] of plan.routes.entries()) {
  let coordinates;
  let provider = null;
  if (route.sourceType === 'osm-foot') {
    const fetched = await fetchOsmReference(route);
    provider = {
      schema: 'cairn.real-map-snap.public-reference-response.v1',
      routeId: route.id,
      capturedAt: new Date().toISOString(),
      requestUrl: fetched.url,
      status: fetched.responseStatus,
      elapsedMs: fetched.elapsedMs,
      body: fetched.body,
    };
    coordinates = fetched.coordinates;
    writeJson(path.join(outputRoot, 'reference-responses', `${route.id}.json`), provider);
    await sleep(350);
  } else {
    coordinates = route.referenceCoordinates;
  }
  const reference = {
    schema: 'cairn.real-map-snap.intended-reference.v1',
    routeId: route.id,
    title: route.title,
    category: route.category,
    crs: plan.crs,
    coordinateOrder: plan.coordinateOrder,
    sourceType: route.sourceType,
    referenceConfidence: route.referenceConfidence,
    generatedFromCandidate: false,
    surveyedGroundTruth: false,
    sources: route.sources,
    providerRequestSha256: provider ? sha256(provider.requestUrl) : null,
    providerResponseSha256: provider ? sha256(provider.body) : null,
    osmNodeIds: provider ? [...new Set(provider.body.routes[0].legs.flatMap(leg => leg.annotation?.nodes ?? []))] : [],
    geometry: { type: 'LineString', coordinates },
    lengthM: Number(pathLength(coordinates).toFixed(3)),
  };
  reference.sha256 = sha256(reference);
  references.set(route.id, reference);
  writeJson(path.join(outputRoot, 'references', `${route.id}.geojson`), {
    type: 'Feature',
    properties: Object.fromEntries(Object.entries(reference).filter(([key]) => key !== 'geometry')),
    geometry: reference.geometry,
  });
  plan.routes[index].referenceLengthM = reference.lengthM;
}

const inputEntries = [];
for (const { route, mode, profile } of activitySpecs) {
  const routeIndex = plan.routes.findIndex(value => value.id === route.id);
  const reference = references.get(route.id);
  const raw = makeRawEvents(route, reference.geometry.coordinates, profile, mode, routeIndex);
  const runId = `${route.id}-${mode}-${profile}`;
  const publicFixtureBase = {
    schema: 'cairn.real-map-snap.public-fixture.v1',
    campaign: 'O70-real-map-snap',
    caseId: route.id,
    runId,
    mode,
    profile,
    seed: raw.settings.seed,
    baseSeed: raw.settings.baseSeed,
    category: route.category,
    contractIntent: {
      scenario: route.question,
      transportFixture: 'LIVE_MAPBOX through isolated allowlisted QA boundary',
      oracleRequirements: 'reference/oracle are stored separately and never enter the product boundary',
    },
    durationSeconds: raw.settings.durationS,
    clock: raw.clock,
    rawEvents: raw.events,
    lifecycle: {
      trueBlackout: Boolean(route.trueBlackout),
      offlineAtFinish: Boolean(route.offlineAtFinish),
      restoreOnlineAfterColdOpen: Boolean(route.offlineAtFinish),
      slowDiagnosticWriteMs: 0,
      walReadFaultOnce: false,
      yieldedFinish: route.id === 'X06',
    },
    transportScenario: 'live-mapbox',
    transportConfig: { mode: 'live-mapbox' },
  };
  const fixtureSha256 = sha256(publicFixtureBase);
  const publicFixture = { ...publicFixtureBase, fixtureSha256 };
  const inputPath = path.join(outputRoot, 'inputs', `${runId}.json`);
  writeJson(inputPath, publicFixture);
  const oracle = {
    schema: 'cairn.real-map-snap.evaluation-oracle.v1',
    routeId: route.id,
    runId,
    referenceSha256: reference.sha256,
    expectedClass: route.expectedClass,
    eligibleFractions: route.eligibleFractions,
    toleranceM: route.toleranceM,
    protectedTopology: route.protectedTopology,
    context: route.context,
    holdout: plan.holdouts.includes(route.id),
    providerAvailabilityAtFreeze: route.sourceType === 'manual-authority' ? 'UNKNOWN' : 'SHARED_OSM_LINEAGE_ONLY',
  };
  oracle.sha256 = sha256(oracle);
  writeJson(path.join(outputRoot, 'oracle', `${runId}.json`), oracle);
  inputEntries.push({
    runId,
    routeId: route.id,
    category: route.category,
    mode,
    profile,
    inputPath: path.relative(outputRoot, inputPath),
    fixtureSha256,
    referenceSha256: reference.sha256,
    oracleSha256: oracle.sha256,
    rawEventCount: raw.events.length,
    logicalDurationS: raw.settings.durationS,
    holdout: oracle.holdout,
  });
}

const manifestBase = {
  schema: 'cairn.real-map-snap.frozen-campaign.v1',
  frozenAt: new Date().toISOString(),
  planSha256: sha256(plan),
  routeCount: plan.routes.length,
  activityCount: inputEntries.length,
  categoryCounts: Object.fromEntries(['urban', 'mountain', 'mixed'].map(category => [
    category,
    inputEntries.filter(entry => entry.category === category).length,
  ])),
  modeCounts: Object.fromEntries(['hike', 'run'].map(mode => [
    mode,
    inputEntries.filter(entry => entry.mode === mode).length,
  ])),
  seeds: { normalHike: 71011, degradedHike: 71023, degradedRun: 71039 },
  holdouts: plan.holdouts,
  entries: inputEntries,
};
const manifest = { ...manifestBase, campaignSha256: sha256(manifestBase) };
writeJson(path.join(outputRoot, 'FROZEN_CAMPAIGN_MANIFEST.json'), manifest);
fs.writeFileSync(path.join(outputRoot, 'FROZEN'), `${manifest.campaignSha256}\n`);
process.stdout.write(`${JSON.stringify({
  outputRoot,
  routeCount: manifest.routeCount,
  activityCount: manifest.activityCount,
  categoryCounts: manifest.categoryCounts,
  modeCounts: manifest.modeCounts,
  campaignSha256: manifest.campaignSha256,
}, null, 2)}\n`);
