#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const planPath = path.resolve(argument(
  '--plan',
  path.join(repoRoot, 'docs/review/hike-run-experience-lab/PHYSICAL_ROUTE_PLAN.json'),
));
const outputRoot = path.resolve(argument(
  '--output',
  '/Users/mzm/Downloads/Cairn_Hike_Run_Experience_Lab_Work/frozen-corpus',
));
const providerCacheRootArgument = argument('--provider-cache');
const providerCacheRoot = providerCacheRootArgument ? path.resolve(providerCacheRootArgument) : null;
const token = (process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? '').trim();

if (!token.startsWith('pk.') || token.length < 40) {
  throw new Error('mapbox_public_token_required_for_physical_corpus_freeze');
}
if (fs.existsSync(outputRoot)) throw new Error(`freeze_output_already_exists:${outputRoot}`);

const planBytes = fs.readFileSync(planPath);
const plan = JSON.parse(planBytes.toString('utf8'));
const campaign = String(plan.campaign ?? 'overnight-experience-lab-20261020');
const sha256 = value => crypto.createHash('sha256').update(
  Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value),
).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
};
const toRad = degrees => degrees * Math.PI / 180;
const haversineM = (left, right) => {
  const dLat = toRad(right[1] - left[1]);
  const dLng = toRad(right[0] - left[0]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(left[1])) * Math.cos(toRad(right[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
const polylineLengthM = coordinates => coordinates.slice(1).reduce(
  (sum, coordinate, index) => sum + haversineM(coordinates[index], coordinate),
  0,
);
const cumulativeDistances = coordinates => {
  const result = [0];
  for (let index = 1; index < coordinates.length; index += 1) {
    result.push(result[index - 1] + haversineM(coordinates[index - 1], coordinates[index]));
  }
  return result;
};
const pointAtDistance = (coordinates, cumulative, requestedDistanceM) => {
  const distanceM = Math.max(0, Math.min(cumulative[cumulative.length - 1], requestedDistanceM));
  let right = 1;
  while (right < cumulative.length && cumulative[right] < distanceM) right += 1;
  right = Math.min(coordinates.length - 1, right);
  const left = Math.max(0, right - 1);
  const edgeM = cumulative[right] - cumulative[left];
  const ratio = edgeM > 0 ? (distanceM - cumulative[left]) / edgeM : 0;
  return [
    coordinates[left][0] + (coordinates[right][0] - coordinates[left][0]) * ratio,
    coordinates[left][1] + (coordinates[right][1] - coordinates[left][1]) * ratio,
  ];
};
const offsetMeters = (coordinate, eastM, northM) => [
  coordinate[0] + eastM / (111_320 * Math.max(0.2, Math.cos(toRad(coordinate[1])))),
  coordinate[1] + northM / 111_320,
];
const moveToward = (value, target, maximumDelta) => (
  value < target ? Math.min(target, value + maximumDelta) : Math.max(target, value - maximumDelta)
);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function gaussian(random) {
  const left = Math.max(Number.EPSILON, random());
  const right = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

async function fetchWalkingRoute(route) {
  const coordinateString = route.waypoints.map(coordinate => coordinate.join(',')).join(';');
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/walking/${coordinateString}`);
  for (const [name, value] of Object.entries({
    alternatives: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'true',
    access_token: token,
  })) url.searchParams.set(name, value);
  const sanitized = new URL(url);
  sanitized.searchParams.set('access_token', '<redacted>');
  const expectedRequestFingerprint = sha256(`GET ${sanitized}`);
  const cachedPath = providerCacheRoot
    ? path.join(providerCacheRoot, 'provider-responses', `${route.id}.json`)
    : null;
  if (cachedPath && fs.existsSync(cachedPath)) {
    const cached = JSON.parse(fs.readFileSync(cachedPath, 'utf8'));
    if (cached.requestFingerprint === expectedRequestFingerprint) {
      return {
        status: cached.status,
        elapsedMs: cached.elapsedMs,
        sanitizedUrl: cached.sanitizedUrl,
        requestFingerprint: cached.requestFingerprint,
        payload: cached.payload,
        provenance: 'CAPTURED_LIVE_RESPONSE_REPLAY',
        originalCapturedAt: cached.capturedAt,
      };
    }
  }
  const startedAt = Date.now();
  const response = await fetch(url);
  const payload = await response.json();
  return {
    status: response.status,
    elapsedMs: Date.now() - startedAt,
    sanitizedUrl: sanitized.toString(),
    requestFingerprint: expectedRequestFingerprint,
    payload,
    provenance: 'LIVE_MAPBOX_REQUEST',
    originalCapturedAt: null,
  };
}

function validatePhysicalRoute(route, response) {
  const providerRoute = response.payload?.routes?.[0];
  const coordinates = providerRoute?.geometry?.coordinates;
  const steps = providerRoute?.legs?.flatMap(leg => leg.steps ?? []) ?? [];
  const stepNames = steps.map(step => String(step.name ?? '')).filter(Boolean);
  const stepModes = [...new Set(steps.map(step => String(step.mode ?? '').toLowerCase()).filter(Boolean))];
  const bannedTransport = stepNames.filter(name => /ferry|shuttle|gondola|cableway|funicular|boat/i.test(name));
  const waypointChordM = route.waypoints.slice(1).reduce(
    (sum, coordinate, index) => sum + haversineM(route.waypoints[index], coordinate),
    0,
  );
  const routeDistanceM = Number(providerRoute?.distance);
  const geometryDistanceM = Array.isArray(coordinates) ? polylineLengthM(coordinates) : NaN;
  const checks = {
    http200: response.status === 200,
    mapboxCodeOk: response.payload?.code === 'Ok',
    geometryPresent: Array.isArray(coordinates) && coordinates.length >= 2,
    distanceBounded: Number.isFinite(routeDistanceM) && routeDistanceM >= 100 && routeDistanceM <= 9_000,
    geometryDistanceConsistent: Number.isFinite(geometryDistanceM)
      && Math.abs(geometryDistanceM - routeDistanceM) <= Math.max(30, routeDistanceM * 0.08),
    detourBounded: Number.isFinite(routeDistanceM)
      && routeDistanceM <= Math.max(500, waypointChordM * 4),
    everyStepWalking: steps.length > 0 && steps.every(step => step.mode === 'walking'),
    noBannedTransport: bannedTransport.length === 0,
    endpointsSupported: Array.isArray(coordinates)
      && haversineM(route.waypoints[0], coordinates[0]) <= 80
      && haversineM(route.waypoints[route.waypoints.length - 1], coordinates[coordinates.length - 1]) <= 80,
  };
  const accepted = Object.values(checks).every(Boolean);
  return {
    accepted,
    checks,
    routeDistanceM,
    geometryDistanceM,
    waypointChordM,
    detourRatio: routeDistanceM / Math.max(1, waypointChordM),
    geometryPointCount: coordinates?.length ?? 0,
    stepCount: steps.length,
    stepModes,
    stepNames,
    legSummaries: providerRoute?.legs?.map(leg => leg.summary ?? '') ?? [],
    bannedTransport,
  };
}

function buildTravellerDiary(route, variant, geometry) {
  const cumulative = cumulativeDistances(geometry);
  const lengthM = cumulative[cumulative.length - 1];
  const trail = /trail|forest|switchback|alpine/i.test(route.category);
  const baseSpeedMps = variant.mode === 'run' ? 2.75 : trail ? 1.08 : 1.30;
  const accelerationMps2 = variant.mode === 'run' ? 0.50 : 0.32;
  const stopDistanceM = route.stop ? route.stop.fraction * lengthM : null;
  let stopRemainingS = 0;
  let stopStarted = false;
  let stopCompleted = false;
  let restartAtS = null;
  let distanceM = 0;
  let speedMps = 0;
  let elapsedS = 0;
  const positions = [];
  while (distanceM < lengthM - 0.01 && elapsedS < 10_000) {
    if (!stopStarted && stopDistanceM != null && distanceM >= stopDistanceM) {
      stopStarted = true;
      stopRemainingS = route.stop.durationS;
      speedMps = 0;
    }
    let phase = 'moving';
    if (stopRemainingS > 0) {
      speedMps = 0;
      stopRemainingS -= 1;
      phase = 'stopped';
      if (stopRemainingS === 0) {
        stopCompleted = true;
        restartAtS = elapsedS + 1;
      }
    } else {
      const modulation = 0.94 + 0.04 * Math.sin(elapsedS / 29) + 0.02 * Math.sin(elapsedS / 73);
      const remainingM = Math.max(0, lengthM - distanceM);
      const brakingSpeed = Math.sqrt(2 * accelerationMps2 * remainingM);
      const desiredSpeed = Math.min(baseSpeedMps * modulation, brakingSpeed);
      speedMps = moveToward(speedMps, desiredSpeed, accelerationMps2);
      distanceM = Math.min(lengthM, distanceM + speedMps);
      if (restartAtS != null && elapsedS - restartAtS < 12) phase = 'restarting';
    }
    const coordinate = pointAtDistance(geometry, cumulative, distanceM);
    positions.push({
      elapsedS,
      timestampMs: null,
      coordinate: { lng: coordinate[0], lat: coordinate[1] },
      distanceM: Number(distanceM.toFixed(3)),
      progress: Number((distanceM / lengthM).toFixed(8)),
      speedMps: Number(speedMps.toFixed(3)),
      phase,
    });
    elapsedS += 1;
  }
  if (positions.length === 0 || positions[positions.length - 1].distanceM < lengthM - 0.01) {
    throw new Error(`traveller_diary_did_not_complete:${variant.id}`);
  }
  return {
    baseSpeedMps,
    accelerationMps2,
    lengthM,
    durationS: positions[positions.length - 1].elapsedS,
    stopCompleted,
    positions,
  };
}

function cleanDirection(diary, index, fallback) {
  const left = diary.positions[Math.max(0, index - 2)]?.coordinate;
  const right = diary.positions[Math.min(diary.positions.length - 1, index + 2)]?.coordinate;
  if (!left || !right) return fallback;
  const eastM = (right.lng - left.lng) * 111_320 * Math.max(0.2, Math.cos(toRad((right.lat + left.lat) / 2)));
  const northM = (right.lat - left.lat) * 111_320;
  const magnitude = Math.hypot(eastM, northM);
  return magnitude > 0.05 ? { east: eastM / magnitude, north: northM / magnitude } : fallback;
}

function buildRawEvents(route, variant, diary, observationStartMs) {
  const random = mulberry32(variant.seed);
  const intervalS = variant.sampleIntervalS;
  const profile = variant.profile;
  const profileConfig = {
    normal: { driftSigmaM: 0.55, baseBiasM: 1.5, accuracyMeanM: 6.5, speedNoiseMps: 0.18 },
    biased: { driftSigmaM: 1.05, baseBiasM: 5.5, accuracyMeanM: 11, speedNoiseMps: 0.30 },
    degraded: { driftSigmaM: 2.10, baseBiasM: 4.0, accuracyMeanM: 17, speedNoiseMps: 0.48 },
  }[profile];
  if (!profileConfig) throw new Error(`unknown_noise_profile:${profile}`);
  let driftEastM = 0;
  let driftNorthM = 0;
  let direction = { east: 1, north: 0 };
  const observations = [];
  for (let diaryIndex = 0; diaryIndex < diary.positions.length; diaryIndex += intervalS) {
    const truth = diary.positions[diaryIndex];
    const progress = truth.progress;
    if (route.gpsBlackout
      && progress >= route.gpsBlackout.startFraction
      && progress <= route.gpsBlackout.endFraction) continue;
    if (route.backgroundWindow
      && progress >= route.backgroundWindow.startFraction
      && progress <= route.backgroundWindow.endFraction
      && Math.floor(diaryIndex / intervalS) % 2 === 1) continue;
    direction = cleanDirection(diary, diaryIndex, direction);
    driftEastM = driftEastM * 0.92 + gaussian(random) * profileConfig.driftSigmaM;
    driftNorthM = driftNorthM * 0.92 + gaussian(random) * profileConfig.driftSigmaM;
    const perpendicular = { east: -direction.north, north: direction.east };
    const clusterBiasM = profile === 'degraded' && progress >= 0.27 && progress <= 0.50
      ? 10 + 7 * Math.sin((progress - 0.27) / 0.23 * Math.PI)
      : profile === 'biased' && progress >= 0.22 && progress <= 0.64 ? 6 : 0;
    let crossM = profileConfig.baseBiasM + clusterBiasM;
    let alongM = 0;
    const abruptOutlier = profile !== 'normal'
      && (Math.abs(progress - 0.18) < intervalS / Math.max(60, diary.durationS)
        || Math.abs(progress - 0.67) < intervalS / Math.max(60, diary.durationS));
    if (abruptOutlier) {
      crossM += random() > 0.5 ? 28 : -28;
      alongM += 12;
    }
    const observed = offsetMeters(
      [truth.coordinate.lng, truth.coordinate.lat],
      driftEastM + perpendicular.east * crossM + direction.east * alongM,
      driftNorthM + perpendicular.north * crossM + direction.north * alongM,
    );
    const observationTimeMs = observationStartMs + truth.elapsedS * 1_000;
    let deliveryTimeMs = observationTimeMs + Math.max(0, Math.round(gaussian(random) * 140));
    if (route.lateBatch
      && progress >= route.lateBatch.startFraction
      && progress <= route.lateBatch.endFraction) {
      const batchTruth = diary.positions.find(point => point.progress >= route.lateBatch.endFraction)
        ?? diary.positions[diary.positions.length - 1];
      deliveryTimeMs = observationStartMs + (batchTruth.elapsedS + route.lateBatch.deliveryDelayS) * 1_000;
    }
    const inBackground = route.backgroundWindow
      && progress >= route.backgroundWindow.startFraction
      && progress <= route.backgroundWindow.endFraction;
    let accuracyM = Math.max(3, profileConfig.accuracyMeanM + gaussian(random) * (profile === 'degraded' ? 6 : 2.2));
    if (profile === 'degraded' && progress >= 0.31 && progress <= 0.42) accuracyM = 6;
    const speedMissing = profile === 'degraded' && random() < 0.24;
    const speedMps = speedMissing ? null : Math.max(0, truth.speedMps + gaussian(random) * profileConfig.speedNoiseMps);
    observations.push({
      providerOrdinal: observations.length,
      observationTimeMs,
      deliveryTimeMs,
      appState: inBackground ? 'background' : 'active',
      coordinate: { lat: observed[1], lng: observed[0] },
      accuracyM: Number(accuracyM.toFixed(2)),
      speedMps: speedMps == null ? null : Number(speedMps.toFixed(3)),
      speedAccuracyMps: random() < 0.10 ? null : Number((variant.mode === 'run' ? 0.65 : 0.38).toFixed(2)),
      source: 'simulator',
    });
  }
  if (profile !== 'normal' && observations.length > 12) {
    const original = observations[Math.floor(observations.length * 0.63)];
    observations.push({
      ...original,
      providerOrdinal: original.providerOrdinal,
      deliveryTimeMs: original.deliveryTimeMs + 2_000,
      duplicateOfProviderOrdinal: original.providerOrdinal,
    });
  }
  return observations
    .sort((left, right) => left.deliveryTimeMs - right.deliveryTimeMs
      || left.observationTimeMs - right.observationTimeMs
      || left.providerOrdinal - right.providerOrdinal)
    .map((event, ordinal) => ({ ordinal, arrivalOrder: ordinal, ...event }));
}

function eventSchedule(route, variant, diary, observationStartMs) {
  const timeAtFraction = fraction => {
    const point = diary.positions.find(item => item.progress >= fraction) ?? diary.positions[diary.positions.length - 1];
    return observationStartMs + point.elapsedS * 1_000;
  };
  const events = [{ kind: 'activity-start', atMs: observationStartMs, value: variant.mode }];
  if (route.backgroundWindow) {
    events.push(
      { kind: 'app-state', atMs: timeAtFraction(route.backgroundWindow.startFraction), value: 'background' },
      { kind: 'app-state', atMs: timeAtFraction(route.backgroundWindow.endFraction), value: 'active' },
    );
  }
  if (route.gpsBlackout) {
    events.push(
      { kind: 'gps-provider', atMs: timeAtFraction(route.gpsBlackout.startFraction), value: 'lost' },
      { kind: 'gps-provider', atMs: timeAtFraction(route.gpsBlackout.endFraction), value: 'recovered' },
    );
  }
  if (variant.offlineAtFinish) {
    events.push(
      { kind: 'network', atMs: observationStartMs + diary.durationS * 1_000 - 5_000, value: 'offline' },
      { kind: 'network', atMs: observationStartMs + diary.durationS * 1_000 + 120_000, value: 'online-after-relaunch' },
    );
  }
  events.push({ kind: 'activity-finish', atMs: observationStartMs + diary.durationS * 1_000, value: 'user-action' });
  return events.sort((left, right) => left.atMs - right.atMs);
}

fs.mkdirSync(outputRoot, { recursive: true });
const references = new Map();
const routeReports = [];
for (const route of plan.routes) {
  const response = await fetchWalkingRoute(route);
  const validation = validatePhysicalRoute(route, response);
  const receipt = {
    schema: 'cairn.hike-run.mapbox-walking-reference-receipt.v1',
    routeId: route.id,
    capturedAt: new Date().toISOString(),
    status: response.status,
    elapsedMs: response.elapsedMs,
    sanitizedUrl: response.sanitizedUrl,
    requestFingerprint: response.requestFingerprint,
    responseSha256: sha256(response.payload),
    provenance: response.provenance,
    originalCapturedAt: response.originalCapturedAt,
    payload: response.payload,
  };
  writeJson(path.join(outputRoot, 'provider-responses', `${route.id}.json`), receipt);
  const feasibility = {
    schema: 'cairn.hike-run.route-feasibility.v1',
    routeId: route.id,
    title: route.title,
    region: route.region,
    category: route.category,
    accepted: validation.accepted,
    status: validation.accepted ? 'FROZEN_MAPBOX_WALKING_ROUTE_RENDER_REVIEW_PENDING' : 'REJECTED',
    groundTruthProvenance: route.routeFeasibility.groundTruthProvenance,
    corroboration: route.routeFeasibility.corroboration,
    expectedNamedContext: route.expectedNamedContext,
    mustPreserve: route.routeFeasibility.mustPreserve,
    validation,
    mapboxRequestFingerprint: response.requestFingerprint,
    mapboxResponseSha256: receipt.responseSha256,
    cleanTruthFrozenBeforeNoise: true,
  };
  writeJson(path.join(outputRoot, 'feasibility', `${route.id}.json`), feasibility);
  routeReports.push(feasibility);
  if (!validation.accepted) throw new Error(`physical_route_rejected:${route.id}:${JSON.stringify(validation)}`);
  const geometry = response.payload.routes[0].geometry.coordinates;
  const reference = {
    type: 'Feature',
    properties: {
      schema: 'cairn.hike-run.clean-reference.v1',
      routeId: route.id,
      title: route.title,
      region: route.region,
      category: route.category,
      source: 'MAPBOX_DIRECTIONS_WALKING_LIVE_AT_FREEZE',
      requestFingerprint: response.requestFingerprint,
      responseSha256: receipt.responseSha256,
      routeFeasibilityStatus: feasibility.status,
      cleanTruthNotForApp: true,
    },
    geometry: { type: 'LineString', coordinates: geometry },
  };
  reference.properties.sha256 = sha256(reference);
  references.set(route.id, reference);
  writeJson(path.join(outputRoot, 'references-private', `${route.id}.geojson`), reference);
}

const entries = [];
for (const [routeIndex, route] of plan.routes.entries()) {
  const reference = references.get(route.id);
  for (const variant of route.variants) {
    const observationStartMs = Date.UTC(2026, 9, 20 + routeIndex, variant.mode === 'run' ? 3 : 1, 0, 0);
    const diary = buildTravellerDiary(route, variant, reference.geometry.coordinates);
    diary.positions.forEach(point => { point.timestampMs = observationStartMs + point.elapsedS * 1_000; });
    const rawEvents = buildRawEvents(route, variant, diary, observationStartMs);
    const schedule = eventSchedule(route, variant, diary, observationStartMs);
    const holdout = Boolean(variant.holdout || plan.holdoutRouteIds.includes(route.id));
    const privateDiary = {
      schema: 'cairn.hike-run.traveller-diary.v1',
      runId: variant.id,
      routeId: route.id,
      mode: variant.mode,
      hiddenFromApp: true,
      cleanReferenceSha256: reference.properties.sha256,
      routeFeasibilityPath: `feasibility/${route.id}.json`,
      intent: route.question,
      mustPreserve: route.routeFeasibility.mustPreserve,
      speedModel: {
        baseSpeedMps: diary.baseSpeedMps,
        accelerationMps2: diary.accelerationMps2,
        stop: route.stop ?? null,
        realisticAcceleration: true,
      },
      distanceM: Number(diary.lengthM.toFixed(3)),
      durationS: diary.durationS,
      positions: diary.positions,
    };
    const diarySha256 = sha256(privateDiary);
    const scheduleRecord = {
      schema: 'cairn.hike-run.event-schedule.v1',
      runId: variant.id,
      routeId: route.id,
      seed: variant.seed,
      gpsIndependentFromNetwork: true,
      events: schedule,
    };
    const scheduleSha256 = sha256(scheduleRecord);
    const publicFixtureBase = {
      schema: 'cairn.hike-run.public-provider-fixture.v1',
      campaign,
      caseId: route.id,
      runId: variant.id,
      mode: variant.mode,
      profile: variant.profile,
      seed: variant.seed,
      category: route.category,
      contractIntent: {
        scenario: route.question,
        transportFixture: 'LIVE_MAPBOX through isolated allowlisted QA boundary',
        oracleRequirements: 'clean reference and traveller diary remain outside the product boundary',
      },
      physicalRoute: {
        feasibilityStatus: 'FROZEN_MAPBOX_WALKING_ROUTE_RENDER_REVIEW_PENDING',
        feasibilityReceiptSha256: sha256(routeReports.find(item => item.routeId === route.id)),
        providerRequestFingerprint: reference.properties.requestFingerprint,
        cleanGeometryIncluded: false,
      },
      durationSeconds: diary.durationS,
      clock: {
        observationStartMs,
        observationEndMs: observationStartMs + diary.durationS * 1_000,
        observationIntervalSeconds: variant.sampleIntervalS,
        deliveryMode: route.lateBatch ? 'arrival-ordered-with-late-batch' : 'arrival-ordered',
      },
      rawEvents,
      eventSchedule: {
        sha256: scheduleSha256,
        events: schedule,
      },
      lifecycle: {
        trueBlackout: Boolean(route.gpsBlackout),
        offlineAtFinish: Boolean(variant.offlineAtFinish),
        restoreOnlineAfterColdOpen: Boolean(variant.offlineAtFinish),
        slowDiagnosticWriteMs: Number(variant.slowDiagnosticWriteMs ?? 0),
        walReadFaultOnce: false,
        yieldedFinish: variant.id === 'X05-hike-offline-holdout',
      },
      transportScenario: variant.offlineAtFinish ? 'offline-then-live-mapbox' : 'live-mapbox',
      transportConfig: { mode: 'live-mapbox' },
    };
    const fixtureSha256 = sha256(publicFixtureBase);
    const publicFixture = { ...publicFixtureBase, fixtureSha256 };
    writeJson(path.join(outputRoot, 'diaries-private', `${variant.id}.json`), privateDiary);
    writeJson(path.join(outputRoot, 'schedules', `${variant.id}.json`), scheduleRecord);
    writeJson(path.join(outputRoot, 'inputs-public', `${variant.id}.json`), publicFixture);
    entries.push({
      runId: variant.id,
      routeId: route.id,
      mode: variant.mode,
      profile: variant.profile,
      category: route.category,
      region: route.region,
      holdout,
      publicInputPath: `inputs-public/${variant.id}.json`,
      privateDiaryPath: `diaries-private/${variant.id}.json`,
      schedulePath: `schedules/${variant.id}.json`,
      fixtureSha256,
      diarySha256,
      scheduleSha256,
      referenceSha256: reference.properties.sha256,
      routeFeasibilityStatus: 'FROZEN_MAPBOX_WALKING_ROUTE_RENDER_REVIEW_PENDING',
      rawEventCount: rawEvents.length,
      cleanDurationS: diary.durationS,
      cleanDistanceM: Number(diary.lengthM.toFixed(3)),
    });
  }
}

const manifestBase = {
  schema: 'cairn.hike-run.frozen-physical-corpus.v1',
  frozenAt: new Date().toISOString(),
  planPath: path.relative(repoRoot, planPath),
  planSha256: sha256(planBytes),
  cleanTruthBoundary: plan.cleanTruthBoundary,
  routeCount: plan.routes.length,
  activityCount: entries.length,
  holdoutRouteIds: plan.holdoutRouteIds,
  holdoutRunIds: entries.filter(entry => entry.holdout).map(entry => entry.runId),
  providerBudget: plan.providerBudget,
  routeFeasibilityMandatory: true,
  everyRouteAccepted: routeReports.every(report => report.accepted),
  entries,
};
const manifest = { ...manifestBase, corpusSha256: sha256(manifestBase) };
writeJson(path.join(outputRoot, 'FROZEN_CORPUS_MANIFEST.json'), manifest);
writeJson(path.join(outputRoot, 'ROUTE_FEASIBILITY_INDEX.json'), {
  schema: 'cairn.hike-run.route-feasibility-index.v1',
  routes: routeReports,
});
fs.writeFileSync(path.join(outputRoot, 'FROZEN'), `${manifest.corpusSha256}\n`);
process.stdout.write(`${JSON.stringify({
  outputRoot,
  routeCount: manifest.routeCount,
  activityCount: manifest.activityCount,
  holdoutRunIds: manifest.holdoutRunIds,
  everyRouteAccepted: manifest.everyRouteAccepted,
  corpusSha256: manifest.corpusSha256,
}, null, 2)}\n`);
