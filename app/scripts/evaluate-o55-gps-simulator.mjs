#!/usr/bin/env node

/**
 * OTA55 read-only real-GPS calibration and simulated-sequence comparison.
 *
 * Exact production coordinates are held in memory only. Review output uses
 * local metre offsets, aggregate distributions, and explicit evidence labels.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, '..');
const outputDir = resolve(appRoot, '_review/o55-gps-sim');
const require = createRequire(import.meta.url);
const EARTH_R = 6_371_000;
const METRES_PER_DEGREE = 111_320;

function compileAuthorities() {
  const output = mkdtempSync(resolve(tmpdir(), 'cairn-o55-sim-'));
  const result = spawnSync(resolve(appRoot, 'node_modules/.bin/tsc'), [
    resolve(appRoot, 'src/features/activitySimulator/rawGpsObservationModel.ts'),
    resolve(appRoot, 'src/features/activity/realGpsContinuity.ts'),
    resolve(appRoot, 'src/features/activity/activityContracts.ts'),
    resolve(appRoot, 'src/features/activity/causalLiveRoute.ts'),
    resolve(appRoot, 'src/features/activity/livePace.ts'),
    resolve(appRoot, 'src/services/routing/pedestrianFinalRoute.ts'),
    '--target', 'ES2022', '--module', 'commonjs', '--moduleResolution', 'node',
    '--outDir', output, '--skipLibCheck', '--esModuleInterop', '--noCheck',
  ], { cwd: appRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return {
    output,
    rawGps: require(resolve(output, 'features/activitySimulator/rawGpsObservationModel.js')),
    continuity: require(resolve(output, 'features/activity/realGpsContinuity.js')),
    contracts: require(resolve(output, 'features/activity/activityContracts.js')),
    live: require(resolve(output, 'features/activity/causalLiveRoute.js')),
    pace: require(resolve(output, 'features/activity/livePace.js')),
    final: require(resolve(output, 'services/routing/pedestrianFinalRoute.js')),
  };
}

const evidenceAuthority = [
  { name: 'back', serverId: 46, classification: 'full raw point stream' },
  { name: 'snap', serverId: 2073, classification: 'full raw point stream' },
  { name: 'great hike', serverId: 2074, classification: 'full raw point stream' },
  { name: 'run issue', serverId: 2075, classification: 'full raw point stream' },
  { name: 'mstand', serverId: 2076, classification: 'full raw point stream' },
  { name: 'hike ka', serverId: 2077, classification: 'canonical only' },
  { name: 'lost run', serverId: 2078, classification: 'canonical only' },
  { name: 'wrong2', serverId: null, classification: 'retained forensic summary only' },
  { name: 'something run', serverId: 2080, classification: 'full raw point stream' },
  { name: 'bad run', serverId: 2081, classification: 'normalized/raw-like persisted evidence' },
];

function selectEvidence() {
  const ids = evidenceAuthority.flatMap(item => item.serverId == null ? [] : [item.serverId]);
  const source = String.raw`
const db=require('/app/src/config/db');
const parse=value=>typeof value==='string'?JSON.parse(value):value;
(async()=>{
  const [rows]=await db.query('SELECT id,name,type,start_time,end_time,distance_m,duration_s,route_points,route_points_raw FROM sessions WHERE id IN (${ids.join(',')}) ORDER BY id');
  process.stdout.write(JSON.stringify(rows.map(row=>({...row,route_points:parse(row.route_points),route_points_raw:parse(row.route_points_raw)}))));
  await db.end();
})().catch(async error=>{console.error(error.stack||error);try{await db.end()}catch{}process.exit(1)});
`;
  const result = spawnSync(
    'ssh',
    ['ubuntu@122.51.174.118', 'sudo', '-n', 'docker', 'exec', '-i', 'cairn-backend', 'node'],
    { input: source, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error(`production SELECT failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const rad = degrees => degrees * Math.PI / 180;
function hav(left, right) {
  const dLat = rad(right.lat - left.lat);
  const dLng = rad(right.lng - left.lng);
  const value = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(left.lat)) * Math.cos(rad(right.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(value)));
}

function normalise(point, fallbackIndex) {
  const rawTime = point.t ?? point.timestamp;
  const t = typeof rawTime === 'number' ? rawTime : Date.parse(rawTime);
  return {
    lat: Number(point.lat ?? point.latitude),
    lng: Number(point.lng ?? point.longitude),
    t: Number.isFinite(t) ? t : 0,
    accuracy: Number(point.acc ?? point.accuracy),
    speed: Number(point.speed_mps ?? point.speed),
    course: Number(point.course_deg ?? point.course),
    rawOrdinal: Number(point.raw_ordinal ?? fallbackIndex + 1),
  };
}

function deduplicate(points) {
  const seen = new Set();
  return points.filter(point => {
    const key = `${point.t}:${point.lat.toFixed(9)}:${point.lng.toFixed(9)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return Number.isFinite(point.lat) && Number.isFinite(point.lng) && point.t > 0;
  });
}

function quantile(values, fraction) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function round(value, digits = 3) {
  return value == null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    count: finite.length,
    min: round(quantile(finite, 0)),
    p50: round(quantile(finite, 0.5)),
    p75: round(quantile(finite, 0.75)),
    p95: round(quantile(finite, 0.95)),
    max: round(quantile(finite, 1)),
  };
}

function toLocal(points, origin = points[0]) {
  const cosLat = Math.cos(rad(origin.lat));
  return points.map(point => ({
    ...point,
    x: rad(point.lng - origin.lng) * EARTH_R * cosLat,
    y: rad(point.lat - origin.lat) * EARTH_R,
  }));
}

function correlation(left, right) {
  const pairs = left.map((value, index) => [value, right[index]])
    .filter(pair => pair.every(Number.isFinite));
  if (pairs.length < 3) return null;
  const meanLeft = pairs.reduce((sum, pair) => sum + pair[0], 0) / pairs.length;
  const meanRight = pairs.reduce((sum, pair) => sum + pair[1], 0) / pairs.length;
  let numerator = 0;
  let denominatorLeft = 0;
  let denominatorRight = 0;
  for (const [a, b] of pairs) {
    numerator += (a - meanLeft) * (b - meanRight);
    denominatorLeft += (a - meanLeft) ** 2;
    denominatorRight += (b - meanRight) ** 2;
  }
  const denominator = Math.sqrt(denominatorLeft * denominatorRight);
  return denominator > 0 ? numerator / denominator : null;
}

function lagOne(values) {
  return correlation(values.slice(0, -1), values.slice(1));
}

function cadenceMetrics(points) {
  const deltas = points.slice(1).map((point, index) => (point.t - points[index].t) / 1000)
    .filter(value => value >= 0 && value <= 180);
  const positive = deltas.filter(value => value > 0);
  const median = quantile(positive, 0.5) ?? 0;
  return {
    intervalSeconds: distribution(positive),
    medianAbsoluteJitterSeconds: round(quantile(positive.map(value => Math.abs(value - median)), 0.5)),
    duplicateOrBatchedCount: deltas.filter(value => value === 0).length,
    delayedOver3sPercent: round(positive.filter(value => value > 3).length / Math.max(1, positive.length) * 100),
    delayedOver10sPercent: round(positive.filter(value => value > 10).length / Math.max(1, positive.length) * 100),
  };
}

function inferredMovingMetrics(points) {
  const local = toLocal(points);
  const lateral = [];
  const longitudinal = [];
  const shortStepJitter = [];
  const hAcc = [];
  const displacements = [];
  const residuals = [];
  const rows = [];
  const radius = 4;
  for (let index = radius; index < local.length - radius; index += 1) {
    const point = local[index];
    const start = local[index - radius];
    const end = local[index + radius];
    const dt = (end.t - start.t) / 1000;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (dt <= 0 || dt > 45 || length < 12 || (Number.isFinite(point.speed) && point.speed < 0.45)) continue;
    const ux = dx / length;
    const uy = dy / length;
    const px = point.x - start.x;
    const py = point.y - start.y;
    const along = px * ux + py * uy;
    const timeFraction = (point.t - start.t) / Math.max(1, end.t - start.t);
    const lateralError = px * -uy + py * ux;
    const longitudinalError = along - length * timeFraction;
    lateral.push(lateralError);
    longitudinal.push(longitudinalError);
    residuals.push(Math.hypot(lateralError, longitudinalError));
    rows.push({ index, t: point.t, lateralError, longitudinalError });
  }
  for (let index = 1; index < points.length; index += 1) {
    const dt = (points[index].t - points[index - 1].t) / 1000;
    if (dt <= 0 || dt > 10) continue;
    const displacement = hav(points[index - 1], points[index]);
    const speed = Number.isFinite(points[index].speed) && points[index].speed >= 0 ? points[index].speed : null;
    displacements.push(displacement);
    if (speed != null) shortStepJitter.push(Math.abs(displacement - speed * dt));
    if (Number.isFinite(points[index].accuracy)) hAcc.push(points[index].accuracy);
  }
  const pairedRows = rows.slice(1).filter((row, offset) => row.index === rows[offset].index + 1);
  const priorRows = rows.slice(0, -1).filter((row, index) => rows[index + 1].index === row.index + 1);
  const outliers = residuals.filter(value => value >= 15);
  return {
    sampleCount: rows.length,
    lateralDeviationM: distribution(lateral.map(Math.abs)),
    longitudinalJitterM: distribution(longitudinal.map(Math.abs)),
    shortStepJitterM: distribution(shortStepJitter),
    shortTermLateralErrorCorrelation: round(correlation(priorRows.map(row => row.lateralError), pairedRows.map(row => row.lateralError))),
    shortTermLongitudinalErrorCorrelation: round(correlation(priorRows.map(row => row.longitudinalError), pairedRows.map(row => row.longitudinalError))),
    hAccDisplacementCorrelation: round(correlation(hAcc.slice(0, Math.min(hAcc.length, displacements.length)), displacements.slice(0, hAcc.length))),
    outlierFrequencyPercent: round(outliers.length / Math.max(1, residuals.length) * 100),
    outlierMagnitudeM: distribution(outliers),
  };
}

function stationaryMetrics(points, anchor) {
  const local = toLocal(points, anchor);
  const centre = {
    x: quantile(local.map(point => point.x), 0.5) ?? 0,
    y: quantile(local.map(point => point.y), 0.5) ?? 0,
  };
  const radii = local.map(point => Math.hypot(point.x - centre.x, point.y - centre.y));
  const falsePath = local.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.x - local[index].x, point.y - local[index].y)
  ), 0);
  const east = local.map(point => point.x - centre.x);
  const north = local.map(point => point.y - centre.y);
  const vectorPersistence = local.slice(1).map((point, index) => {
    const prior = local[index];
    const a = { x: prior.x - centre.x, y: prior.y - centre.y };
    const b = { x: point.x - centre.x, y: point.y - centre.y };
    const denominator = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    return denominator > 0.25 ? (a.x * b.x + a.y * b.y) / denominator : null;
  }).filter(Number.isFinite);
  const firstQuarter = local.slice(0, Math.max(1, Math.ceil(local.length / 4)));
  const lastQuarter = local.slice(-Math.max(1, Math.ceil(local.length / 4)));
  const mean = rows => ({
    x: rows.reduce((sum, point) => sum + point.x, 0) / rows.length,
    y: rows.reduce((sum, point) => sum + point.y, 0) / rows.length,
  });
  const early = mean(firstQuarter);
  const late = mean(lastQuarter);
  return {
    fixCount: points.length,
    durationSeconds: round((points.at(-1).t - points[0].t) / 1000),
    radiusM: distribution(radii),
    falsePathLengthM: round(falsePath),
    lagOneEastCorrelation: round(lagOne(east)),
    lagOneNorthCorrelation: round(lagOne(north)),
    meanVectorDirectionPersistence: round(quantile(vectorPersistence, 0.5)),
    clusterCentreDriftM: round(Math.hypot(late.x - early.x, late.y - early.y)),
    localMetreSequence: local.map(point => ({
      t: round((point.t - points[0].t) / 1000),
      x: round(point.x),
      y: round(point.y),
      hAcc: round(point.accuracy),
    })),
  };
}

function combinedMetrics(series) {
  const points = series.flatMap(item => item.points);
  const positiveCadenceSeconds = series.flatMap(item => item.points.slice(1)
    .map((point, index) => (point.t - item.points[index].t) / 1_000)
    .filter(value => value > 0 && value <= 180));
  const medianCadence = quantile(positiveCadenceSeconds, 0.5) ?? 0;
  return {
    sessionCount: series.length,
    pointCount: points.length,
    cadence: {
      intervalSeconds: distribution(positiveCadenceSeconds),
      medianAbsoluteJitterSeconds: round(quantile(positiveCadenceSeconds.map(value => Math.abs(value - medianCadence)), 0.5)),
      duplicateOrBatchedCount: series.reduce((sum, item) => sum + item.points.slice(1)
        .filter((point, index) => point.t === item.points[index].t).length, 0),
      delayedOver3sPercent: round(positiveCadenceSeconds.filter(value => value > 3).length / Math.max(1, positiveCadenceSeconds.length) * 100),
      delayedOver10sPercent: round(positiveCadenceSeconds.filter(value => value > 10).length / Math.max(1, positiveCadenceSeconds.length) * 100),
    },
    hAccM: distribution(points.map(point => point.accuracy)),
    perSession: Object.fromEntries(series.map(item => [item.name, {
      cadence: cadenceMetrics(item.points),
      hAccM: distribution(item.points.map(point => point.accuracy)),
      moving: inferredMovingMetrics(item.points),
    }])),
  };
}

function offsetPoint(origin, eastM, northM) {
  return {
    lat: origin.lat + northM / METRES_PER_DEGREE,
    lng: origin.lng + eastM / (METRES_PER_DEGREE * Math.cos(rad(origin.lat))),
  };
}

function pathLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum + hav(points[index], point), 0);
}

function truthPoint(origin, t, eastM, northM, speedMps, courseDegrees, phase, extras = {}) {
  return {
    ...offsetPoint(origin, eastM, northM),
    t,
    eastM,
    northM,
    trueSpeedMps: speedMps,
    trueCourseDegrees: courseDegrees,
    phase,
    signal: 'normal',
    observationAllowed: true,
    ...extras,
  };
}

function buildScenarios(origin, epochMs) {
  const timed = (durationS, builder) => Array.from({ length: durationS + 1 }, (_unused, second) => (
    builder(second, epochMs + second * 1_000)
  ));
  const moveStopMove = timed(240, (second, t) => {
    const eastM = second <= 60 ? second * 1.4 : second <= 180 ? 84 : 84 + (second - 180) * 1.4;
    return truthPoint(origin, t, eastM, 0, second <= 60 || second > 180 ? 1.4 : 0, 90, second <= 60 ? 'move-before-stop' : second <= 180 ? 'stationary' : 'move-after-stop');
  });
  const straight = timed(180, (second, t) => truthPoint(origin, t, second * 1.6, 0, 1.6, 90, 'moving'));
  const gentleBend = timed(180, (second, t) => {
    const fraction = second / 180;
    const angle = fraction * Math.PI / 3;
    return truthPoint(origin, t, Math.sin(angle) * 180, (1 - Math.cos(angle)) * 180, 1.05, 90 - angle * 180 / Math.PI, 'moving');
  });
  const corner90 = timed(180, (second, t) => second <= 90
    ? truthPoint(origin, t, second * 1.4, 0, 1.4, 90, 'moving')
    : truthPoint(origin, t, 126, (second - 90) * 1.4, 1.4, 0, 'moving'));
  const stationary = timed(180, (second, t) => truthPoint(origin, t, 0, 0, 0, -1, 'stationary'));
  const degradation = timed(180, (second, t) => truthPoint(
    origin,
    t,
    second * 1.4,
    0,
    1.4,
    90,
    second >= 70 && second <= 105 ? 'degraded' : 'moving',
    { signal: second >= 70 && second <= 105 ? 'poor' : 'normal' },
  ));
  const outlier = timed(150, (second, t) => truthPoint(
    origin,
    t,
    second * 1.4,
    0,
    1.4,
    90,
    second === 75 ? 'outlier' : 'moving',
    { forceOutlierMagnitudeM: second === 75 ? 120 : undefined },
  ));
  const sourceLoss = timed(300, (second, t) => truthPoint(
    origin,
    t,
    second * 2,
    0,
    2,
    90,
    second >= 80 && second <= 220 ? 'source-silence' : second > 220 ? 'recovered' : 'moving',
    { observationAllowed: !(second >= 80 && second <= 220) },
  ));
  const smallZ = timed(180, (second, t) => truthPoint(origin, t, second * 1.4, 0, 1.4, 90, 'moving'));
  const trueZLocal = [
    [0, 0], [35, 0], [10, 24], [48, 24],
  ];
  const trueZ = trueZLocal.map(([eastM, northM], index) => truthPoint(
    origin,
    epochMs + index * 25_000,
    eastM,
    northM,
    1.4,
    index === 0 ? 90 : 0,
    'clean-intended',
  ));
  const pace = timed(300, (second, t) => {
    const phases = [
      { end: 30, speed: 0, phase: 'stationary-start' },
      { end: 90, speed: 1.4, phase: 'walk' },
      { end: 150, speed: 2.6, phase: 'slow-run' },
      { end: 210, speed: 3.5, phase: 'fast-run' },
      { end: 245, speed: 2.0, phase: 'slowing' },
      { end: 270, speed: 0, phase: 'stop' },
      { end: 300, speed: 2.8, phase: 'resume' },
    ];
    let remaining = second;
    let eastM = 0;
    let start = 0;
    let selected = phases[0];
    for (const phase of phases) {
      const duration = phase.end - start;
      if (second <= phase.end) {
        eastM += Math.max(0, second - start) * phase.speed;
        selected = phase;
        break;
      }
      eastM += duration * phase.speed;
      remaining -= duration;
      start = phase.end;
    }
    return truthPoint(origin, t, eastM, 0, selected.speed, selected.speed > 0 ? 90 : -1, selected.phase, {
      segmentId: selected.phase === 'resume' ? 'sim-resume' : 'sim-pace',
    });
  });
  return { moveStopMove, straight, gentleBend, corner90, stationary, degradation, outlier, sourceLoss, smallZ, trueZ, pace };
}

function simulateRaw(truth, seed, rawGps) {
  let state = rawGps.createRawGpsModelState(seed, truth[0].t);
  const observations = [];
  for (const point of truth) {
    const stepped = rawGps.advanceRawGpsModel({
      state,
      groundTruth: { lat: point.lat, lng: point.lng },
      timestampMs: point.t,
      trueSpeedMps: point.trueSpeedMps,
      trueCourseDegrees: point.trueCourseDegrees,
      signal: point.signal,
      observationAllowed: point.observationAllowed,
      forceObservation: point.forceOutlierMagnitudeM != null,
      forceOutlierMagnitudeM: point.forceOutlierMagnitudeM,
    });
    state = stepped.state;
    if (!stepped.observation) continue;
    observations.push({
      lat: stepped.observation.coordinate.lat,
      lng: stepped.observation.coordinate.lng,
      t: point.t,
      accuracy: stepped.observation.accuracyM,
      speed: stepped.observation.speedMps,
      course: stepped.observation.courseDegrees,
      errorEastM: stepped.observation.errorEastM,
      errorNorthM: stepped.observation.errorNorthM,
      biasEastM: stepped.observation.biasEastM,
      biasNorthM: stepped.observation.biasNorthM,
      outlier: stepped.observation.outlier,
      cadenceMs: stepped.observation.cadenceMs,
      phase: point.phase,
      groundTruth: { lat: point.lat, lng: point.lng, eastM: point.eastM, northM: point.northM },
      segmentId: point.segmentId ?? (point.phase === 'recovered' ? 'sim-reacquired' : 'sim-main'),
    });
  }
  return observations;
}

function replayCanonical(raw, mode, continuity, contracts) {
  let state = continuity.createRealGpsContinuityState();
  const canonical = [];
  const decisions = { ACCEPT: 0, REJECT: 0, QUARANTINE: 0, REFINE: 0 };
  const decisionReasons = {};
  const postContinuitySuppressions = { stationary: 0, indoorDrift: 0 };
  for (const [index, point] of raw.entries()) {
    const observation = {
      lat: point.lat,
      lng: point.lng,
      t: point.t,
      accuracy: point.accuracy,
      altitude: 0,
      speed: point.speed,
      course: point.course,
      source: 'foreground',
      observationId: `sim-${index}`,
      rawOrdinal: index + 1,
    };
    const decision = continuity.evaluateRealGpsObservation(state, observation, mode, observation.t);
    decisions[decision.kind] += 1;
    decisionReasons[decision.reason] = (decisionReasons[decision.reason] ?? 0) + 1;
    state = decision.state;
    if (decision.kind !== 'ACCEPT') continue;
    let acceptedObservation = observation;
    const lastCanonical = canonical.at(-1) ?? null;
    if (lastCanonical) {
      const distanceFromAcceptedM = hav(lastCanonical, observation);
      const suppressRadiusM = Math.max(8, observation.accuracy ?? 0);
      const lowSpeedStationary = observation.speed != null
        && observation.speed >= 0
        && observation.speed < 0.5
        && distanceFromAcceptedM <= suppressRadiusM;
      if (lowSpeedStationary) {
        if (observation.t - lastCanonical.t < 30_000) {
          postContinuitySuppressions.stationary += 1;
          continue;
        }
        acceptedObservation = {
          ...observation,
          lat: lastCanonical.lat,
          lng: lastCanonical.lng,
          speed: 0,
        };
      } else {
        const withinIndoorDriftGate = (observation.accuracy == null || observation.accuracy > 12)
          && distanceFromAcceptedM < 15
          && observation.t - lastCanonical.t < 30_000;
        const credibleMotion = withinIndoorDriftGate && contracts.isCredibleMotionSample({
          mode,
          lastAccepted: lastCanonical,
          previousRaw: raw[index - 1] ?? null,
          current: observation,
        });
        if (withinIndoorDriftGate && !credibleMotion) {
          postContinuitySuppressions.indoorDrift += 1;
          continue;
        }
      }
    }
    const promoted = decision.confirmedCandidates
      ?? (decision.confirmedCandidate ? [decision.confirmedCandidate] : []);
    for (const candidate of promoted) {
      const source = raw[(candidate.rawOrdinal ?? 1) - 1] ?? point;
      const accepted = { ...candidate, alt: 0, accuracy: source.accuracy, segmentId: source.segmentId };
      state = continuity.acceptRealGpsObservation(state, candidate, accepted.segmentId).state;
      canonical.push(accepted);
    }
    const accepted = { ...acceptedObservation, alt: 0, accuracy: point.accuracy, segmentId: point.segmentId };
    state = continuity.acceptRealGpsObservation(state, acceptedObservation, accepted.segmentId).state;
    canonical.push(accepted);
  }
  return { canonical, decisions, decisionReasons, postContinuitySuppressions, terminalPending: Boolean(state.pending) };
}

function splitSegments(points) {
  const segments = [];
  for (const point of points) {
    if (segments.length === 0 || segments.at(-1)[0].segmentId !== point.segmentId) segments.push([point]);
    else segments.at(-1).push(point);
  }
  return segments;
}

function routeMetrics(points) {
  return {
    pointCount: points.length,
    segmentCount: splitSegments(points).length,
    pathLengthM: round(splitSegments(points).reduce((sum, segment) => sum + pathLength(segment), 0)),
  };
}

function processScenario(raw, mode, compiled) {
  const replay = replayCanonical(raw, mode, compiled.continuity, compiled.contracts);
  const live = compiled.live.buildCausalLiveRoute(replay.canonical);
  const final = splitSegments(replay.canonical).flatMap(segment => (
    compiled.final.buildBaseFinalGeometry(segment).points.map(point => ({
      ...point,
      segmentId: segment[0]?.segmentId,
    }))
  ));
  return {
    canonical: replay.canonical,
    live,
    final,
    decisions: replay.decisions,
    decisionReasons: replay.decisionReasons,
    postContinuitySuppressions: replay.postContinuitySuppressions,
    terminalPending: replay.terminalPending,
    metrics: {
      raw: routeMetrics(raw),
      canonical: routeMetrics(replay.canonical),
      live: routeMetrics(live),
      final: routeMetrics(final),
    },
  };
}

function processCleanScenario(points, compiled) {
  const canonical = points.slice();
  const live = points.slice();
  const final = splitSegments(canonical).flatMap(segment => (
    compiled.final.buildBaseFinalGeometry(segment).points.map(point => ({
      ...point,
      segmentId: segment[0]?.segmentId,
    }))
  ));
  return {
    canonical,
    live,
    final,
    metrics: {
      raw: routeMetrics(points),
      canonical: routeMetrics(canonical),
      live: routeMetrics(live),
      final: routeMetrics(final),
    },
  };
}

function simulatedCalibrationMetrics(moveStopMove, stationary) {
  const all = moveStopMove;
  const moving = all.filter(point => point.phase !== 'stationary');
  const stop = stationary;
  const errors = all.map(point => ({ east: point.errorEastM, north: point.errorNorthM }));
  const ordinaryOutliers = all.filter(point => point.outlier);
  return {
    fixCadence: cadenceMetrics(all),
    hAccM: distribution(all.map(point => point.accuracy)),
    movingLateralDeviationM: distribution(moving.map(point => Math.abs(point.errorNorthM))),
    movingShortStepJitterM: distribution(moving.slice(1).flatMap((point, index) => {
      const prior = moving[index];
      const dt = (point.t - prior.t) / 1_000;
      if (dt <= 0 || dt > 15 || prior.phase !== point.phase) return [];
      return [Math.abs(hav(prior, point) - hav(prior.groundTruth, point.groundTruth))];
    })),
    stationary: stationaryMetrics(stop, stop[0].groundTruth),
    lagOneEastErrorCorrelation: round(lagOne(errors.map(item => item.east))),
    lagOneNorthErrorCorrelation: round(lagOne(errors.map(item => item.north))),
    outlierFrequencyPercent: round(ordinaryOutliers.length / Math.max(1, all.length) * 100),
    outlierMagnitudeM: distribution(ordinaryOutliers.map(point => Math.hypot(point.errorEastM, point.errorNorthM))),
  };
}

function localSequence(points, origin) {
  return toLocal(points, origin).map((point, index) => ({
    t: round((point.t - points[0].t) / 1_000),
    x: round(point.x),
    y: round(point.y),
    hAcc: round(point.accuracy),
    phase: point.phase,
    outlier: point.outlier ?? false,
    truthX: round(point.groundTruth?.eastM),
    truthY: round(point.groundTruth?.northM),
    sequence: index + 1,
  }));
}

function localLine(points, origin) {
  return splitSegments(points).flatMap((segment, segmentIndex) => (
    toLocal(segment, origin).map((point, pointIndex) => ({
      x: round(point.x, 2),
      y: round(point.y, 2),
      ...(segmentIndex > 0 && pointIndex === 0 ? { break: true } : {}),
    }))
  ));
}

function comparisonHtml(panels) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OTA55 GPS Simulator QA</title><style>*{box-sizing:border-box}body{margin:0;background:#eef1e9;color:#18372d;font:13px system-ui}header{padding:18px}.grid{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:12px;padding:0 14px 18px}.panel{background:#fbf8ef;border:1px solid #d2d8ce;border-radius:16px;overflow:hidden}.title{padding:12px 14px;font-weight:760}.canvas{height:310px}.note{padding:10px 14px;border-top:1px solid #dfe3da;line-height:1.45}canvas{width:100%;height:100%}@media(max-width:950px){.grid{grid-template-columns:1fr}}</style><header><h1>OTA55 · Calibrated dual-mode GPS Simulator</h1><div>blue ground truth · orange Raw GPS · gold Canonical · green Live · navy Base Final</div></header><main class="grid">${panels.map((panel, index) => `<section class="panel"><div class="title">${panel.title}</div><div class="canvas"><canvas data-index="${index}"></canvas></div><div class="note">${panel.note}</div></section>`).join('')}</main><script>const panels=${JSON.stringify(panels)};for(const canvas of document.querySelectorAll('canvas')){const panel=panels[+canvas.dataset.index],ctx=canvas.getContext('2d');function render(){const d=devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);const all=panel.lines.flatMap(line=>line.points),xs=all.map(p=>p.x),ys=all.map(p=>p.y),pad=22,s=Math.min((w-pad*2)/(Math.max(...xs)-Math.min(...xs)||1),(h-pad*2)/(Math.max(...ys)-Math.min(...ys)||1)),x=v=>pad+(v-Math.min(...xs))*s,y=v=>h-pad-(v-Math.min(...ys))*s;for(const line of panel.lines){if(line.points.length===0)continue;ctx.beginPath();line.points.forEach((p,i)=>(i&&!p.break)?ctx.lineTo(x(p.x),y(p.y)):ctx.moveTo(x(p.x),y(p.y)));ctx.strokeStyle=line.color;ctx.globalAlpha=line.opacity;ctx.lineWidth=line.width;ctx.lineJoin='round';ctx.lineCap='round';ctx.setLineDash(line.dash||[]);ctx.stroke()}ctx.globalAlpha=1;ctx.setLineDash([])}render();addEventListener('resize',render)}</script>`;
}

const compiled = compileAuthorities();
try {
  const rows = selectEvidence();
  const byId = new Map(rows.map(row => [row.id, row]));
  const evidence = evidenceAuthority.map(item => {
    const row = item.serverId == null ? null : byId.get(item.serverId);
    const points = row?.route_points_raw
      ? deduplicate(row.route_points_raw.map(normalise))
      : [];
    return {
      ...item,
      serverName: row?.name ?? null,
      pointCount: points.length,
      points,
    };
  });

  const rawSeries = evidence.filter(item => item.classification === 'full raw point stream' && item.points.length > 0);
  const snap = evidence.find(item => item.name === 'snap');
  if (!snap || snap.points.length < 252) throw new Error('snap raw Stop-V authority is unavailable');
  const stopAnchor = snap.points.find(point => point.rawOrdinal === 246) ?? snap.points[245];
  const stationary = snap.points.filter(point => point.t >= stopAnchor.t && point.t <= stopAnchor.t + 120_000);
  const ordinaryStationary = stationary.filter(point => (
    point.t <= stopAnchor.t + 105_000 && hav(stopAnchor, point) < 50
  ));
  const moveStopMove = snap.points.filter(point => (
    point.rawOrdinal >= 230 && point.t <= stopAnchor.t + 165_000
  ));
  const catastrophicStationary = stationary.map(point => ({ point, radiusM: hav(stopAnchor, point) }))
    .filter(item => item.radiusM >= 50);
  const realRecovery = (() => {
    if (catastrophicStationary.length === 0) return null;
    const peak = catastrophicStationary.reduce((best, item) => item.radiusM > best.radiusM ? item : best);
    const recovered = snap.points.find(point => point.t > peak.point.t && hav(stopAnchor, point) < 20);
    return {
      peakMagnitudeM: round(peak.radiusM),
      recoveryTo20mSeconds: recovered ? round((recovered.t - peak.point.t) / 1_000) : null,
      correlatedTailFixCount: snap.points.filter(point => point.t >= peak.point.t && recovered && point.t <= recovered.t).length,
    };
  })();

  const realArtifact = {
    schema: 'cairnnz.o55.real-gps-calibration.v2',
    generatedAt: new Date().toISOString(),
    privacy: 'Exact production coordinates used read-only in memory; only local metre offsets and aggregate metrics are written.',
    evidence: evidence.map(({ points, ...item }) => item),
    rawCorpus: combinedMetrics(rawSeries),
    stationaryAuthority: {
      activity: 'snap',
      evidenceClass: 'full raw point stream + documented physical stop',
      limitation: 'Raw 246 is the retained traversal anchor; exact surveyed ground truth is unavailable.',
      complete120SecondsIncludingRareOutlier: stationaryMetrics(stationary, stopAnchor),
      ordinaryPreOutlierCloud: stationaryMetrics(ordinaryStationary, stopAnchor),
      catastrophicOutlierRecovery: realRecovery,
    },
    moveStopMoveAuthority: {
      activity: 'snap',
      stopAtSeconds: round((stopAnchor.t - moveStopMove[0].t) / 1_000),
      physicalMoveResumesAfterStopSeconds: 126,
      rawFixCount: moveStopMove.length,
      localMetreSequence: toLocal(moveStopMove, stopAnchor).map(point => ({
        t: round((point.t - moveStopMove[0].t) / 1_000),
        phase: point.t < stopAnchor.t ? 'move' : point.t <= stopAnchor.t + 120_000 ? 'stop' : 'move',
        x: round(point.x),
        y: round(point.y),
        hAcc: round(point.accuracy),
        speed: round(point.speed),
      })),
    },
  };

  const seed = 550055;
  const origin = { lat: -45.0312, lng: 168.6626 };
  const scenarios = buildScenarios(origin, 1_800_000_000_000);
  const simulated = Object.fromEntries(Object.entries(scenarios)
    .filter(([name]) => name !== 'trueZ')
    .map(([name, truth]) => {
      const scenarioSeed = name === 'smallZ'
        ? seed + Object.keys(scenarios).indexOf('straight')
        : seed + Object.keys(scenarios).indexOf(name);
      return [name, simulateRaw(truth, scenarioSeed, compiled.rawGps)];
    }));
  const processed = Object.fromEntries(Object.entries(simulated).map(([name, raw]) => [
    name,
    processScenario(raw, name === 'pace' ? 'running' : 'hiking', compiled),
  ]));
  const cleanTrueZ = scenarios.trueZ.map((point, index) => ({
    ...point,
    accuracy: 5,
    speed: point.trueSpeedMps,
    course: point.trueCourseDegrees,
    groundTruth: { lat: point.lat, lng: point.lng, eastM: point.eastM, northM: point.northM },
    segmentId: 'clean-true-z',
    outlier: false,
    rawOrdinal: index + 1,
  }));
  const trueZProcessed = processCleanScenario(cleanTrueZ, compiled);

  const stationarySim = simulated.stationary;
  const moveStopMoveSim = simulated.moveStopMove;
  const simMetrics = simulatedCalibrationMetrics(moveStopMoveSim, stationarySim);
  const perSessionMoving = Object.values(realArtifact.rawCorpus.perSession).map(item => item.moving);
  const realMovingLateralP50 = quantile(perSessionMoving.map(item => item.lateralDeviationM.p50), 0.5);
  const realMovingStepP50 = quantile(perSessionMoving.map(item => item.shortStepJitterM.p50), 0.5);
  const realTemporalCorrelation = quantile(perSessionMoving.map(item => item.shortTermLateralErrorCorrelation), 0.5);
  const realMovingSampleCount = perSessionMoving.reduce((sum, item) => sum + item.sampleCount, 0);
  const realMovingOutlierFrequency = perSessionMoving.reduce((sum, item) => (
    sum + item.sampleCount * item.outlierFrequencyPercent / 100
  ), 0) / Math.max(1, realMovingSampleCount) * 100;
  const simulatedMovingForOutliers = moveStopMoveSim.filter(point => point.phase !== 'stationary');
  const simulatedMovingOutlierFrequency = simulatedMovingForOutliers.filter(point => (
    Math.hypot(point.errorEastM, point.errorNorthM) >= 15
  )).length / Math.max(1, simulatedMovingForOutliers.length) * 100;
  const realOutlierRadii = catastrophicStationary.map(item => item.radiusM);
  const simForcedOutlier = simulated.outlier.filter(point => point.outlier);
  const realVsSimTable = [
    { metric: 'Fix cadence p50 (s)', real: realArtifact.rawCorpus.cadence.intervalSeconds.p50, simulated: simMetrics.fixCadence.intervalSeconds.p50 },
    { metric: 'Fix cadence p95 (s)', real: realArtifact.rawCorpus.cadence.intervalSeconds.p95, simulated: simMetrics.fixCadence.intervalSeconds.p95 },
    { metric: 'hAcc median (m)', real: realArtifact.rawCorpus.hAccM.p50, simulated: simMetrics.hAccM.p50 },
    { metric: 'hAcc p95 (m)', real: realArtifact.rawCorpus.hAccM.p95, simulated: simMetrics.hAccM.p95 },
    { metric: 'Moving lateral deviation p50 (m)', real: round(realMovingLateralP50), simulated: simMetrics.movingLateralDeviationM.p50 },
    { metric: 'Moving short-step jitter p50 (m)', real: round(realMovingStepP50), simulated: simMetrics.movingShortStepJitterM.p50 },
    { metric: 'Stationary radius p50 (m)', real: realArtifact.stationaryAuthority.ordinaryPreOutlierCloud.radiusM.p50, simulated: simMetrics.stationary.radiusM.p50 },
    { metric: 'Stationary radius p95 (m)', real: realArtifact.stationaryAuthority.ordinaryPreOutlierCloud.radiusM.p95, simulated: simMetrics.stationary.radiusM.p95 },
    { metric: 'Stationary false path length / minute (m)', real: round(realArtifact.stationaryAuthority.ordinaryPreOutlierCloud.falsePathLengthM / Math.max(1, realArtifact.stationaryAuthority.ordinaryPreOutlierCloud.durationSeconds / 60)), simulated: round(simMetrics.stationary.falsePathLengthM / Math.max(1, simMetrics.stationary.durationSeconds / 60)) },
    { metric: 'Short-term lateral/error correlation', real: round(realTemporalCorrelation), simulated: simMetrics.lagOneNorthErrorCorrelation },
    { metric: 'Inferred moving residual >=15m (% fixes)', real: round(realMovingOutlierFrequency), simulated: round(simulatedMovingOutlierFrequency) },
    { metric: 'Severe episode recovery-tail share (% fixes, conditional)', real: round(realOutlierRadii.length / Math.max(1, stationary.length) * 100), simulated: round(simForcedOutlier.length / Math.max(1, simulated.outlier.length) * 100) },
    { metric: 'Severe outlier peak (m)', real: realRecovery?.peakMagnitudeM ?? null, simulated: round(Math.max(...simForcedOutlier.map(point => Math.hypot(point.errorEastM, point.errorNorthM)))) },
    { metric: 'Recovery to <20m (s)', real: realRecovery?.recoveryTo20mSeconds ?? null, simulated: (() => { const first = simulated.outlier.findIndex(point => point.outlier); const recovered = simulated.outlier.slice(first + 1).find(point => Math.hypot(point.errorEastM, point.errorNorthM) < 20); return first >= 0 && recovered ? round((recovered.t - simulated.outlier[first].t) / 1_000) : null; })() },
  ];

  const paceCheckpoints = [30, 80, 140, 200, 245, 265, 300].map(second => {
    const at = scenarios.pace[0].t + second * 1_000;
    const points = processed.pace.canonical.filter(point => point.t <= at);
    const truth = scenarios.pace[second];
    const value = compiled.pace.deriveLivePace({ points, nowMs: at, recording: true });
    return {
      second,
      phase: truth.phase,
      trueSpeedMps: truth.trueSpeedMps,
      trueSecondsPerKm: truth.trueSpeedMps > 0 ? round(1_000 / truth.trueSpeedMps) : null,
      livePaceSecondsPerKm: round(value.secondsPerKm),
      reason: value.reason,
      evidenceDistanceM: round(value.evidenceDistanceM),
      evidenceDurationSeconds: round(value.evidenceDurationMs / 1_000),
    };
  });

  const comparisonArtifact = {
    schema: 'cairnnz.o55.real-vs-sim.v1',
    generatedAt: new Date().toISOString(),
    defaultProfile: compiled.rawGps.REALISTIC_GPS_PROFILE,
    seed,
    calibrationClaim: 'Behaviorally calibrated QA model; not physical or statistical equivalence to Core Location/GNSS.',
    realVsSimTable,
    simulatedMetrics: {
      ...simMetrics,
      stationary: { ...simMetrics.stationary, localMetreSequence: '[see O55_STATIONARY_SEQUENCE.json]' },
    },
    processing: Object.fromEntries(Object.entries(processed).map(([name, value]) => [name, {
      decisions: value.decisions,
      decisionReasons: value.decisionReasons,
      postContinuitySuppressions: value.postContinuitySuppressions,
      terminalPending: value.terminalPending,
      metrics: value.metrics,
    }])),
    trueZCleanPath: trueZProcessed.metrics,
    paceCheckpoints,
    sourceLoss: {
      silentGroundTruthSeconds: 141,
      fixesDuringSilence: simulated.sourceLoss.filter(point => point.phase === 'source-silence').length,
      beforeSegment: simulated.sourceLoss.find(point => point.phase === 'moving')?.segmentId ?? null,
      recoveredSegment: simulated.sourceLoss.find(point => point.phase === 'recovered')?.segmentId ?? null,
      note: 'Ground truth continues while observations stop; recovered evidence uses a new segment so no connector is invented.',
    },
  };

  const panels = ['moveStopMove', 'straight', 'gentleBend', 'corner90', 'smallZ', 'stationary', 'degradation', 'outlier', 'sourceLoss'].map(name => {
    const truth = scenarios[name];
    const raw = simulated[name];
    const result = processed[name];
    return {
      title: name.replace(/([A-Z])/g, ' $1').replace(/^./, value => value.toUpperCase()),
      note: `raw ${raw.length} · canonical ${result.canonical.length} · Live ${result.live.length} · Final ${result.final.length}`,
      lines: [
        { color: '#2e6cc5', opacity: 0.9, width: 2, dash: [5, 4], points: truth.map(point => ({ x: point.eastM, y: point.northM })) },
        { color: '#f26522', opacity: 0.4, width: 1.4, points: localLine(raw, truth[0]) },
        { color: '#f0c419', opacity: 0.58, width: 2, points: localLine(result.canonical, truth[0]) },
        { color: '#5d7c46', opacity: 0.9, width: 3, points: localLine(result.live, truth[0]) },
        { color: '#18372d', opacity: 0.95, width: 3.5, points: localLine(result.final, truth[0]) },
      ],
    };
  });
  panels.push({
    title: 'True Z · Clean Path',
    note: `exact input ${cleanTrueZ.length} · Final ${trueZProcessed.final.length}; intentional structure remains`,
    lines: [
      { color: '#2e6cc5', opacity: 0.9, width: 3, points: scenarios.trueZ.map(point => ({ x: point.eastM, y: point.northM })) },
      { color: '#18372d', opacity: 0.95, width: 3, points: localLine(trueZProcessed.final, scenarios.trueZ[0]) },
    ],
  });

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(resolve(outputDir, 'O55_REAL_FIELD_METRICS.json'), `${JSON.stringify(realArtifact, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(resolve(outputDir, 'O55_REAL_VS_SIM_METRICS.json'), `${JSON.stringify(comparisonArtifact, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'O55_STATIONARY_SEQUENCE.json'), `${JSON.stringify({ seed: seed + Object.keys(scenarios).indexOf('stationary'), sequence: localSequence(stationarySim, stationarySim[0].groundTruth) }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'O55_MOVE_STOP_MOVE_SEQUENCE.json'), `${JSON.stringify({ seed, sequence: localSequence(moveStopMoveSim, scenarios.moveStopMove[0]) }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'O55_STRAIGHT_PATH_GEOMETRY.json'), `${JSON.stringify({ truth: panels[1].lines[0].points, raw: panels[1].lines[1].points, live: panels[1].lines[3].points, final: panels[1].lines[4].points }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'O55_SMALL_Z_NOISE_COMPARISON.json'), `${JSON.stringify({ truth: panels[4].lines[0].points, raw: panels[4].lines[1].points, live: panels[4].lines[3].points, final: panels[4].lines[4].points }, null, 2)}\n`);
  writeFileSync(resolve(outputDir, 'O55_LIVE_VS_FINAL_COMPARISON.json'), `${JSON.stringify(Object.fromEntries(panels.map(panel => [panel.title, { note: panel.note, live: panel.lines.at(-2)?.points ?? [], final: panel.lines.at(-1)?.points ?? [] }])), null, 2)}\n`);
  const pagePath = resolve(outputDir, 'O55_GPS_SIMULATOR_BOARD.html');
  writeFileSync(pagePath, comparisonHtml(panels));
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1320 }, deviceScaleFactor: 1 });
  await page.goto(`file://${pagePath}`);
  await page.screenshot({ path: resolve(outputDir, 'O55_GPS_SIMULATOR_BOARD.png'), fullPage: true });
  await browser.close();

  process.stdout.write(`${JSON.stringify({
    outputs: [
      'O55_REAL_FIELD_METRICS.json',
      'O55_REAL_VS_SIM_METRICS.json',
      'O55_STATIONARY_SEQUENCE.json',
      'O55_MOVE_STOP_MOVE_SEQUENCE.json',
      'O55_STRAIGHT_PATH_GEOMETRY.json',
      'O55_SMALL_Z_NOISE_COMPARISON.json',
      'O55_LIVE_VS_FINAL_COMPARISON.json',
      'O55_GPS_SIMULATOR_BOARD.png',
    ].map(name => `app/_review/o55-gps-sim/${name}`),
    realVsSimTable,
    processing: comparisonArtifact.processing,
    paceCheckpoints,
    sourceLoss: comparisonArtifact.sourceLoss,
  }, null, 2)}\n`);
} finally {
  rmSync(compiled.output, { recursive: true, force: true });
}
