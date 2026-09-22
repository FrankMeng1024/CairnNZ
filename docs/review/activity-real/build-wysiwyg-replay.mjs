#!/usr/bin/env node
/*
 * Read-only, privacy-safe replay evidence for Stationary V2.
 *
 * Production coordinates exist only in this process. The persisted artifact
 * contains counts, distances, ordinals, decisions and aggregate displacement
 * statistics—never latitude/longitude.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const APP = path.join(ROOT, 'app');
const OUTPUT = path.join(HERE, 'WYSIWYG_OFFLINE_REPLAY.json');
const SESSION_IDS = [2062, 2067, 2069, 2070, 2071, 2072];

const WINDOWS = {
  2071: [
    { key: 'opening_stationary', start: 1, end: 12 },
    { key: 'outbound_straight', start: 13, end: 31 },
    { key: 'turn_and_first_return', start: 31, end: 43 },
    { key: 'return_with_false_low_speed', start: 32, end: 77 },
    { key: 'ending_stationary_like', start: 65, end: 77 },
  ],
  2072: [
    { key: 'first_stationary', start: 9, end: 14 },
    { key: 'first_stop_to_start', start: 9, end: 24 },
    { key: 'straight_walk', start: 24, end: 118 },
    { key: 'u_turn', start: 119, end: 130 },
    { key: 'deliberate_z', start: 163, end: 188 },
    { key: 'repeated_internal_corridor', start: 188, end: 210 },
    { key: 'second_stationary', start: 224, end: 226 },
    { key: 'second_stop_to_start', start: 224, end: 236 },
  ],
};

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

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
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
    if (angleDelta(bearing(points[index - 1], points[index]), bearing(points[index], points[index + 1])) >= threshold) {
      count += 1;
    }
  }
  return count;
}

function readProductionEvidence() {
  const ids = SESSION_IDS.join(',');
  const remote = String.raw`
const db=require('/app/src/config/db');
(async()=>{
  const [rows]=await db.query('SELECT id,name,client_activity_id,start_time,end_time,distance_m,route_points,route_points_raw FROM sessions WHERE id IN (${ids}) ORDER BY id');
  process.stdout.write(JSON.stringify(rows));
  await db.end();
})().catch(e=>{console.error(e.stack);process.exit(1)});
`;
  return JSON.parse(execFileSync('ssh', [
    'ubuntu@122.51.174.118',
    'sudo -n docker exec -i cairn-backend node',
  ], { input: remote, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }));
}

function parsePoints(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || value.length === 0) return [];
  const parsed = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function normalizePoint(point, index, source) {
  return {
    lat: Number(point.lat),
    lng: Number(point.lng),
    t: Number(point.t),
    accuracy: point.acc == null ? null : Number(point.acc),
    verticalAccuracy: point.v_acc == null ? null : Number(point.v_acc),
    altitude: point.alt == null ? null : Number(point.alt),
    speed: point.speed_mps == null ? null : Number(point.speed_mps),
    course: point.course_deg == null ? null : Number(point.course_deg),
    source: 'foreground',
    observationId: `${source}-${index + 1}`,
    rawOrdinal: Number.isFinite(Number(point.raw_ordinal)) ? Number(point.raw_ordinal) : index + 1,
    segmentId: point.segment_id || `${source}-segment`,
  };
}

function loadMovementAuthority() {
  const babel = require(path.join(APP, 'node_modules/@babel/core'));
  const sourcePath = path.join(APP, 'src/features/activity/realGpsContinuity.ts');
  const transformed = babel.transformFileSync(sourcePath, {
    filename: sourcePath,
    presets: [[require.resolve('@babel/preset-typescript', { paths: [APP] }), { allowDeclareFields: true }]],
    plugins: [require.resolve('@babel/plugin-transform-modules-commonjs', { paths: [APP] })],
    sourceMaps: false,
    babelrc: false,
    configFile: false,
  });
  const module = { exports: {} };
  const localRequire = specifier => specifier === '../../utils/geo'
    ? { haversineM }
    : require(specifier);
  new Function('module', 'exports', 'require', transformed.code)(module, module.exports, localRequire);
  return module.exports;
}

function summarizeAdjustments(values) {
  return {
    medianM: rounded(percentile(values, 0.5)),
    p95M: rounded(percentile(values, 0.95)),
    maxM: rounded(values.length ? Math.max(...values) : null),
  };
}

function moveAtMostToward(from, target, maxOffsetM) {
  const offsetM = haversineM(from, target);
  if (offsetM <= maxOffsetM || offsetM === 0) return from;
  const ratio = (offsetM - maxOffsetM) / offsetM;
  return {
    lat: from.lat + (target.lat - from.lat) * ratio,
    lng: from.lng + (target.lng - from.lng) * ratio,
  };
}

function temporalOnlyPresentation(points) {
  let previous = null;
  let previousSegment = null;
  return points.map(point => {
    const segmentChanged = previousSegment != null && point.segmentId !== previousSegment;
    if (!previous || segmentChanged) {
      previous = { lat: point.lat, lng: point.lng };
      previousSegment = point.segmentId;
      return { ...point };
    }
    const weight = point.accuracy != null && point.accuracy > 15 ? 0.8 : 0.9;
    const blended = {
      lat: previous.lat + (point.lat - previous.lat) * weight,
      lng: previous.lng + (point.lng - previous.lng) * weight,
    };
    const maxOffsetM = Math.min(2, Math.max(1, (point.accuracy == null ? 25 : point.accuracy) * 0.12));
    previous = moveAtMostToward(blended, point, maxOffsetM);
    previousSegment = point.segmentId;
    return { ...point, ...previous };
  });
}

function replayV3(points, authority) {
  let state = authority.createRealGpsContinuityState();
  const canonical = [];
  const presentation = [];
  const decisions = [];
  const adjustmentM = [];
  let maxRecentRaw = 0;
  let maxCandidate = 0;
  for (const point of points) {
    const decision = authority.evaluateRealGpsObservation(state, point, 'hiking', point.t);
    state = decision.state;
    const accepted = decision.kind === 'ACCEPT'
      ? [...(decision.confirmedCandidates || (decision.confirmedCandidate ? [decision.confirmedCandidate] : [])), point]
      : [];
    for (const acceptedPoint of accepted) {
      const committed = authority.acceptRealGpsObservation(state, acceptedPoint, acceptedPoint.segmentId || 'segment');
      state = committed.state;
      canonical.push(acceptedPoint);
      presentation.push({ ...acceptedPoint, ...committed.liveCoordinate });
      adjustmentM.push(haversineM(acceptedPoint, committed.liveCoordinate));
    }
    decisions.push({
      rawOrdinal: point.rawOrdinal,
      kind: decision.kind,
      reason: decision.reason,
      candidateEvent: decision.candidateEvent?.type || null,
      candidateDelayMs: decision.candidateEvent?.delayMs ?? null,
      reportedSpeedMps: rounded(point.speed),
      horizontalAccuracyM: rounded(point.accuracy),
      dtFromTrustedMs: decision.diagnostics.dtFromTrustedMs,
      displacementFromTrustedM: rounded(decision.diagnostics.displacementFromTrustedM),
      impliedSpeedMps: rounded(decision.diagnostics.impliedSpeedMps),
      windowCount: decision.diagnostics.windowCount,
      cumulativeProgressM: rounded(decision.diagnostics.cumulativeProgressM),
      netProgressM: rounded(decision.diagnostics.netProgressM),
      progressRatio: rounded(decision.diagnostics.progressRatio),
      directionVariabilityDeg: rounded(decision.diagnostics.directionVariabilityDeg),
      motionStateBefore: decision.diagnostics.motionStateBefore,
      motionStateAfter: decision.diagnostics.motionStateAfter,
    });
    maxRecentRaw = Math.max(maxRecentRaw, state.recentEligibleRaw.length);
    maxCandidate = Math.max(maxCandidate, state.pending?.observations.length || 0);
  }
  return { canonical, presentation, decisions, adjustmentM, maxRecentRaw, maxCandidate, state };
}

function historicalCcReplay(points, k8) {
  const accepted = [];
  let anchor = null;
  let anchorTime = null;
  for (const point of points) {
    const distanceM = anchor ? haversineM(anchor, point) : 0;
    const dtMs = anchorTime == null ? null : point.t - anchorTime;
    const impliedSpeedMps = dtMs > 0 ? distanceM / (dtMs / 1_000) : 0;
    const accuracy = Number.isFinite(point.accuracy) ? point.accuracy : null;
    const speed = Number.isFinite(point.speed) && point.speed >= 0 ? point.speed : null;
    let suppress = false;
    if (accuracy != null && accuracy > 25) suppress = true;
    else if (anchor && distanceM > 30 && impliedSpeedMps > 10) suppress = true;
    else if (anchor && speed != null && speed < 0.5 && distanceM <= Math.max(8, accuracy || 0)) {
      suppress = true;
      anchorTime = point.t;
    } else if (k8 && anchor && (accuracy == null || accuracy > 12) && distanceM < 15 && dtMs != null && dtMs < 30_000) {
      suppress = true;
      anchorTime = point.t;
    }
    if (!suppress) {
      accepted.push(point);
      anchor = point;
      anchorTime = point.t;
    }
  }
  return accepted;
}

function geometrySummary(points) {
  return {
    pointCount: points.length,
    pathDistanceM: rounded(pathLengthM(points)),
    netDistanceM: rounded(points.length > 1 ? haversineM(points[0], points.at(-1)) : 0),
    reversalCount: reversalCount(points),
  };
}

function windowSummary(points, windows) {
  return Object.fromEntries((windows || []).map(window => {
    const selected = points.filter(point => point.rawOrdinal >= window.start && point.rawOrdinal <= window.end);
    return [window.key, {
      rawOrdinalRange: [window.start, window.end],
      ...geometrySummary(selected),
      acceptedOrdinals: selected.map(point => point.rawOrdinal),
    }];
  }));
}

function decisionWindows(decisions, windows) {
  return Object.fromEntries((windows || []).map(window => [
    window.key,
    decisions.filter(decision => decision.rawOrdinal >= window.start && decision.rawOrdinal <= window.end),
  ]));
}

function decisionSummary(decisions) {
  const byKind = {};
  const byReason = {};
  const candidateDelayMs = [];
  for (const decision of decisions) {
    byKind[decision.kind] = (byKind[decision.kind] || 0) + 1;
    byReason[decision.reason] = (byReason[decision.reason] || 0) + 1;
    if (decision.candidateEvent === 'candidate_confirmed' && decision.candidateDelayMs != null) {
      candidateDelayMs.push(decision.candidateDelayMs);
    }
  }
  return {
    byKind,
    byReason,
    candidateConfirmationDelayMs: {
      p50: rounded(percentile(candidateDelayMs, 0.5)),
      p95: rounded(percentile(candidateDelayMs, 0.95)),
      max: rounded(candidateDelayMs.length ? Math.max(...candidateDelayMs) : null),
    },
  };
}

function straightResidualSummary(points) {
  if (points.length < 3) return { pointCount: points.length, p50M: null, p95M: null, maxM: null };
  const start = points[0];
  const end = points.at(-1);
  const cosLat = Math.max(0.2, Math.cos(toRad(start.lat)));
  const ex = (end.lng - start.lng) * 111_320 * cosLat;
  const ey = (end.lat - start.lat) * 111_320;
  const len2 = ex * ex + ey * ey;
  const residuals = points.map(point => {
    const px = (point.lng - start.lng) * 111_320 * cosLat;
    const py = (point.lat - start.lat) * 111_320;
    const fraction = len2 > 0 ? Math.max(0, Math.min(1, (px * ex + py * ey) / len2)) : 0;
    return Math.hypot(px - ex * fraction, py - ey * fraction);
  });
  return {
    pointCount: points.length,
    p50M: rounded(percentile(residuals, 0.5)),
    p95M: rounded(percentile(residuals, 0.95)),
    maxM: rounded(Math.max(...residuals)),
  };
}

function pointToSegmentM(point, start, end) {
  const cosLat = Math.max(0.2, Math.cos(toRad(point.lat)));
  const ax = (start.lng - point.lng) * 111_320 * cosLat;
  const ay = (start.lat - point.lat) * 111_320;
  const bx = (end.lng - point.lng) * 111_320 * cosLat;
  const by = (end.lat - point.lat) * 111_320;
  const dx = bx - ax;
  const dy = by - ay;
  const length2 = dx * dx + dy * dy;
  const fraction = length2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0;
  return Math.hypot(ax + dx * fraction, ay + dy * fraction);
}

function localWobbleSummary(points) {
  const residuals = [];
  for (let index = 1; index < points.length - 1; index += 1) {
    residuals.push(pointToSegmentM(points[index], points[index - 1], points[index + 1]));
  }
  return {
    sampleCount: residuals.length,
    p50M: rounded(percentile(residuals, 0.5)),
    p95M: rounded(percentile(residuals, 0.95)),
    maxM: rounded(residuals.length ? Math.max(...residuals) : null),
  };
}

function syntheticPerformance(authority) {
  const start = Date.now();
  let state = authority.createRealGpsContinuityState();
  let acceptedCount = 0;
  let maxRecentRaw = 0;
  let maxCandidate = 0;
  for (let index = 0; index < 10_000; index += 1) {
    const point = {
      lat: (index % 17 === 0 ? 0.4 : 0) / 111_320,
      lng: (index * 1.05) / 111_320,
      t: 1_000 + index * 1_000,
      accuracy: 5,
      speed: index % 19 === 0 ? 0.09 : 1.05,
      source: 'foreground',
      observationId: `performance-${index}`,
      rawOrdinal: index + 1,
      segmentId: 'performance-segment',
    };
    const result = replayV3([point], {
      createRealGpsContinuityState: () => state,
      evaluateRealGpsObservation: authority.evaluateRealGpsObservation,
      acceptRealGpsObservation: authority.acceptRealGpsObservation,
    });
    state = result.state;
    acceptedCount += result.canonical.length;
    maxRecentRaw = Math.max(maxRecentRaw, result.maxRecentRaw);
    maxCandidate = Math.max(maxCandidate, result.maxCandidate);
  }
  return {
    inputCount: 10_000,
    acceptedCount,
    elapsedMs: Date.now() - start,
    maximumRecentRawWindow: maxRecentRaw,
    maximumCandidateWindow: maxCandidate,
  };
}

function main() {
  const authority = loadMovementAuthority();
  const rows = readProductionEvidence();
  const sessions = rows.map(row => {
    const saved = parsePoints(row.route_points).map((point, index) => normalizePoint(point, index, `saved-${row.id}`));
    const rawStored = parsePoints(row.route_points_raw);
    const inputKind = rawStored.length >= 2 ? 'exact_server_raw' : 'persisted_canonical_subset';
    const input = (rawStored.length >= 2 ? rawStored : parsePoints(row.route_points))
      .map((point, index) => normalizePoint(point, index, `input-${row.id}`));
    const v3 = replayV3(input, authority);
    const historicalD7 = historicalCcReplay(input, false);
    const historicalK8 = historicalCcReplay(input, true);
    const temporalOnly = temporalOnlyPresentation(v3.canonical);
    const windows = WINDOWS[row.id] || [];
    const straight = windows.find(window => window.key.includes('straight'));
    const straightInput = straight
      ? input.filter(point => point.rawOrdinal >= straight.start && point.rawOrdinal <= straight.end)
      : [];
    const straightPresentation = straight
      ? v3.presentation.filter(point => point.rawOrdinal >= straight.start && point.rawOrdinal <= straight.end)
      : [];
    const straightTemporalOnly = straight
      ? temporalOnly.filter(point => point.rawOrdinal >= straight.start && point.rawOrdinal <= straight.end)
      : [];
    return {
      serverId: row.id,
      name: row.id === 2072 ? 'almost done (immutable pending source)' : row.name,
      clientActivityId: row.client_activity_id,
      inputAuthority: inputKind,
      limitation: inputKind === 'persisted_canonical_subset'
        ? 'Raw-only rejected observations were never uploaded; replay preserves all available ordered timestamp/accuracy/speed evidence but is not an exact full-raw rerun.'
        : null,
      recorded: {
        savedDistanceM: rounded(Number(row.distance_m)),
        savedDisplay: geometrySummary(saved),
        rawPointCount: rawStored.length,
      },
      historicalCcD7: {
        ...geometrySummary(historicalD7),
        windows: windowSummary(historicalD7, windows),
      },
      historicalCcK8: {
        ...geometrySummary(historicalK8),
        windows: windowSummary(historicalK8, windows),
      },
      stationaryV2: {
        version: authority.REAL_GPS_CONTINUITY_VERSION,
        canonical: geometrySummary(v3.canonical),
        presentation: geometrySummary(v3.presentation),
        rawToPresentationAdjustment: summarizeAdjustments(v3.adjustmentM),
        maximumRecentRawWindow: v3.maxRecentRaw,
        maximumCandidateWindow: v3.maxCandidate,
        finalMotionState: v3.state.motionState,
        decisions: decisionSummary(v3.decisions),
        decisionWindows: decisionWindows(v3.decisions, windows),
        windows: windowSummary(v3.canonical, windows),
        straightCrossTrackResidual: {
          raw: straightResidualSummary(straightInput),
          presentation: straightResidualSummary(straightPresentation),
        },
        straightLocalWobble: {
          raw: localWobbleSummary(straightInput),
          temporalOnly: localWobbleSummary(straightTemporalOnly),
          presentation: localWobbleSummary(straightPresentation),
        },
      },
    };
  });
  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    privacy: 'No latitude/longitude or raw payload is persisted. Production access is SELECT-only.',
    method: {
      productionAuthority: 'Current realGpsContinuity.ts loaded and executed directly through Babel; no copied implementation.',
      recordedComparison: 'Saved display/session metrics are retained as historical current behavior; D7/K8 are faithful counterfactual scalar/deadband reconstructions already documented by the historical forensic.',
      warning: 'Session 2072 lacks uploaded route_points_raw after its immutable HTTP 400 pending state, so that row replays all 222 available canonical observations and is explicitly not represented as exact 239-point raw replay.',
    },
    sessions,
    performance: syntheticPerformance(authority),
  };
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output: OUTPUT, sessionCount: sessions.length, performance: output.performance }) + '\n');
}

main();
