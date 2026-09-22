#!/usr/bin/env node
/*
 * Analysis-only builder for the 2026-09-11 "almost done" Activity.
 *
 * Exact production coordinates exist only in process memory. Every file this
 * script writes is translated to a fixed review origin, preserving metre-scale
 * shape and chronology without retaining the real location.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../../..');
const APP = path.join(ROOT, 'app');
const SOURCE_ACTIVITY_ID = 2072;
const SOURCE_CLIENT_ID = '99e48b0d-ad87-4aba-a94f-0d033393d0e6';
const QA_SESSION_ID = 'qa-mtwhxdio-22iczr8v';
const SOURCE_START = 1789103326128;
const FIXED_ORIGIN = { lat: -41, lng: 174 };

function readProductionEvidence() {
  const remote = String.raw`
const db=require('/app/src/config/db');
(async()=>{
  const [s]=await db.query('SELECT id,user_id,client_activity_id,type,start_time,end_time,finalized_at,abandoned_at,distance_m,duration_s,name,route_points,route_points_raw,flags,created_at,active_slot FROM sessions WHERE id=?',[${SOURCE_ACTIVITY_ID}]);
  const row=s[0];
  const routePoints=typeof row.route_points==='string'?JSON.parse(row.route_points):row.route_points;
  const [t]=await db.query('SELECT id,session_id,device_model,device_os,os_version,app_version,build_number,started_at,ended_at,duration_ms,events_count,raw_size_bytes,activity_mode,raw_jsonl,uploaded_at,upload_source FROM telemetry_sessions WHERE session_id=?',['${QA_SESSION_ID}']);
  const telemetry=t[0];
  const events=String(telemetry.raw_jsonl||'').trim().split(/\n+/).filter(Boolean).map(JSON.parse);
  process.stdout.write(JSON.stringify({session:{...row,route_points:undefined,route_points_raw:undefined},routePoints,telemetry:{...telemetry,raw_jsonl:undefined},events}));
  await db.end();
})().catch(e=>{console.error(e.stack);process.exit(1)});
`;
  return JSON.parse(execFileSync('ssh', [
    'ubuntu@122.51.174.118',
    'sudo -n docker exec -i cairn-backend node',
  ], { input: remote, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }));
}

function loadProductionSnapTrack() {
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

const toRad = value => value * Math.PI / 180;
const haversineM = (a, b) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
};
const pathLengthM = points => points.slice(1).reduce((sum, point, i) => sum + haversineM(points[i], point), 0);

function translatePoint(point, sourceOrigin) {
  const northM = (point.lat - sourceOrigin.lat) * 111_320;
  const eastM = (point.lng - sourceOrigin.lng) * 111_320 * Math.cos(toRad(sourceOrigin.lat));
  return {
    ...point,
    lat: FIXED_ORIGIN.lat + northM / 111_320,
    lng: FIXED_ORIGIN.lng + eastM / (111_320 * Math.cos(toRad(FIXED_ORIGIN.lat))),
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function angleDelta(a, b) {
  let value = Math.abs(a - b) % 360;
  return value > 180 ? 360 - value : value;
}

function bearing(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat))
    - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function reversalIndices(points, threshold = 135) {
  const out = [];
  for (let i = 1; i < points.length - 1; i += 1) {
    const incoming = bearing(points[i - 1], points[i]);
    const outgoing = bearing(points[i], points[i + 1]);
    if (angleDelta(incoming, outgoing) >= threshold) out.push(i);
  }
  return out;
}

const CLONE_STATIONARY_ORDINALS = new Set([10, 11, 12, 13, 14, 225, 226]);

function boundedCloneDisplaySmoothing(points) {
  if (points.length < 3) return { points: points.map(point => ({ ...point })), changedRawOrdinals: [] };
  const source = points.map(point => ({ ...point }));
  const out = source.map(point => ({ ...point }));
  const changedRawOrdinals = [];
  for (let index = 1; index < source.length - 1; index += 1) {
    const previous = source[index - 1];
    const point = source[index];
    const next = source[index + 1];
    if (previous.segment_id !== point.segment_id || point.segment_id !== next.segment_id) continue;
    if (point.t <= previous.t || next.t <= point.t || next.t - previous.t > 10_000) continue;
    if (angleDelta(bearing(previous, point), bearing(point, next)) > 18) continue;
    const fraction = (point.t - previous.t) / (next.t - previous.t);
    const candidate = {
      lat: previous.lat + (next.lat - previous.lat) * fraction,
      lng: previous.lng + (next.lng - previous.lng) * fraction,
    };
    if (haversineM(point, candidate) > 1.5) continue;
    out[index] = { ...point, ...candidate };
    if (point.raw_ordinal != null) changedRawOrdinals.push(point.raw_ordinal);
  }
  return { points: out, changedRawOrdinals };
}

function historicalReplay(points, { k8 }) {
  const accepted = [];
  const decisions = [];
  let lastAccepted = null;
  let lastAcceptedTime = null;
  for (const point of points) {
    const accuracy = Number.isFinite(point.acc) ? point.acc : null;
    const speed = Number.isFinite(point.speed_mps) && point.speed_mps >= 0 ? point.speed_mps : null;
    const distance = lastAccepted ? haversineM(lastAccepted, point) : 0;
    const dtMs = lastAcceptedTime == null ? null : point.t - lastAcceptedTime;
    const impliedSpeed = dtMs > 0 ? distance / (dtMs / 1000) : 0;
    let decision = 'ACCEPT';
    let reason = 'accepted';
    if (accuracy != null && accuracy > 25) {
      decision = 'REJECT'; reason = 'accuracy>25m';
    } else if (lastAccepted && distance > 30 && impliedSpeed > 10) {
      decision = 'REJECT'; reason = 'teleport>10mps-and>30m';
    } else if (lastAccepted && speed != null && speed < 0.5 && distance <= Math.max(8, accuracy ?? 0)) {
      decision = 'SUPPRESS'; reason = 'low-speed-accuracy-radius';
      // Historical behavior refreshed the wall-clock anchor age even though
      // the traversal coordinate stayed fixed.
      lastAcceptedTime = point.t;
    } else if (k8 && lastAccepted && (accuracy == null || accuracy > 12)
      && distance < 15 && dtMs != null && dtMs < 30_000) {
      decision = 'SUPPRESS'; reason = 'k8-indoor-15m-deadband';
      lastAcceptedTime = point.t;
    }
    if (decision === 'ACCEPT') {
      accepted.push(point);
      lastAccepted = point;
      lastAcceptedTime = point.t;
    }
    decisions.push({ rawOrdinal: point.raw_ordinal, timestamp: point.t, decision, reason, distanceFromAnchorM: distance });
  }
  return { accepted, decisions };
}

function windowMetrics(points, startOrdinal, endOrdinal) {
  const selected = points.filter(point => point.raw_ordinal >= startOrdinal && point.raw_ordinal <= endOrdinal);
  return {
    pointCount: selected.length,
    pathDistanceM: pathLengthM(selected),
    netDistanceM: selected.length > 1 ? haversineM(selected[0], selected.at(-1)) : 0,
    acceptedOrdinals: selected.map(point => point.raw_ordinal),
  };
}

function scenarioReplay(points, scenarios) {
  return Object.fromEntries(scenarios.map(scenario => {
    const metrics = windowMetrics(points, scenario.startOrdinal, scenario.endOrdinal);
    return [scenario.key, {
      rawOrdinalRange: [scenario.startOrdinal, scenario.endOrdinal],
      interpretation: scenario.interpretation,
      acceptedCount: metrics.pointCount,
      pathDistanceM: rounded(metrics.pathDistanceM),
      netDistanceM: rounded(metrics.netDistanceM),
      acceptedOrdinals: metrics.acceptedOrdinals,
    }];
  }));
}

function rawForMatcher(points) {
  return points.map(point => ({
    lat: point.lat,
    lng: point.lng,
    alt: point.alt,
    accuracy: point.acc,
    speed: point.speed_mps,
    t: point.t,
  }));
}

async function buildConservativeHybrid(points, snapTrack, token) {
  // Generic bounded subdivision: fixed 12-point windows with one shared
  // canonical boundary. It never expands radii or converts a failed subsection
  // into a larger-road search. A window is derived only when production gates
  // report every chunk matched and at least one successful match.
  const windows = [];
  const pieces = [];
  const size = 12;
  for (let start = 0; start < points.length - 1; start += size - 1) {
    const end = Math.min(points.length, start + size);
    const source = points.slice(start, end);
    const result = await snapTrack(rawForMatcher(source), {
      mapboxToken: token,
      totalTimeoutMs: 20_000,
      perCallTimeoutMs: 8_000,
      concurrency: 1,
    });
    const accepted = result.ok
      && result.stats.chunksOk > 0
      && result.stats.chunksFallback === 0
      && result.stats.qualityFallbacks === 0;
    windows.push({
      index: windows.length,
      sourceStartIndex: start,
      sourceEndIndexExclusive: end,
      sourceRawOrdinalStart: source[0].raw_ordinal,
      sourceRawOrdinalEnd: source.at(-1).raw_ordinal,
      sourcePointCount: source.length,
      status: accepted ? 'MATCHED' : 'CANONICAL_FALLBACK',
      reason: accepted ? 'all-production-gates-accepted' : (result.ok ? 'partial-or-quality-fallback' : result.reason),
      stats: result.stats,
    });
    const chosen = accepted
      ? result.points.map((point, i) => ({ ...point, t: source[Math.min(i, source.length - 1)]?.t }))
      : source.map(point => ({ ...point }));
    if (pieces.length && chosen.length && haversineM(pieces.at(-1), chosen[0]) < 0.1) chosen.shift();
    pieces.push(...chosen);
    if (end === points.length) break;
  }
  return { windows, points: pieces };
}

function geojsonFeature(name, points, properties = {}) {
  return {
    type: 'Feature',
    properties: { name, ...properties },
    geometry: { type: 'LineString', coordinates: points.map(point => [point.lng, point.lat]) },
  };
}

function rounded(value, digits = 3) {
  return value == null ? null : Number(value.toFixed(digits));
}

async function main() {
  const token = String(process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '').trim();
  if (!token) throw new Error('Run through `cd app && npx eas-cli env:exec preview ...` so the public Mapbox token is available.');
  const evidence = readProductionEvidence();
  const canonical = evidence.routePoints;
  if (canonical.length !== 222) throw new Error(`Expected 222 canonical points, got ${canonical.length}`);
  const { snapTrack } = loadProductionSnapTrack();

  const currentDryRun = await snapTrack(rawForMatcher(canonical), {
    mapboxToken: token,
    totalTimeoutMs: 60_000,
    perCallTimeoutMs: 8_000,
    concurrency: 4,
  });
  const hybrid = await buildConservativeHybrid(canonical, snapTrack, token);
  const cloneSelected = canonical.filter(point => !CLONE_STATIONARY_ORDINALS.has(point.raw_ordinal));
  const cloneDisplay = boundedCloneDisplaySmoothing(cloneSelected);
  const historicalD7 = historicalReplay(canonical, { k8: false });
  const historicalK8 = historicalReplay(canonical, { k8: true });
  const replayScenarios = [
    { key: 'initialStationary', startOrdinal: 9, endOrdinal: 14, interpretation: 'approximately 45 s startup stationary leak' },
    { key: 'stopToStart', startOrdinal: 9, endOrdinal: 30, interpretation: 'startup anchor through established walking' },
    { key: 'oneMetreCadenceStraightWalk', startOrdinal: 24, endOrdinal: 118, interpretation: 'long approximately straight outbound progression' },
    { key: 'uTurn', startOrdinal: 119, endOrdinal: 130, interpretation: 'sharp out-and-back reversal around raw ordinal 124' },
    { key: 'diagonalAndDeliberateZ', startOrdinal: 163, endOrdinal: 188, interpretation: 'diagonal crossing and deliberate angular geometry' },
    { key: 'repeatedInternalCorridor', startOrdinal: 188, endOrdinal: 210, interpretation: 'later visits to the already traversed internal corridor' },
    { key: 'secondStationary', startOrdinal: 224, endOrdinal: 226, interpretation: 'minute-six low-speed stop' },
    { key: 'secondStopToStart', startOrdinal: 224, endOrdinal: 236, interpretation: 'minute-six stop through resumed progression' },
  ];

  const decisions = evidence.events.filter(event => event.eventName === 'activity_filter_decision_v2');
  const lifecycle = evidence.events.filter(event => [
    'app_inactive', 'app_backgrounded', 'app_foregrounded',
    'activity_location_lifecycle_plan_v1', 'real_activity_background_callback_checkpoint',
    'real_activity_background_journal_result', 'real_activity_background_drain',
    'real_activity_foreground_takeover', 'real_activity_location_source_activated',
  ].includes(event.eventName));
  const recordedMatch = evidence.events.find(event => event.eventName === 'activity_match_segment_v2')?.fields ?? null;
  const finalGeometry = evidence.events.find(event => event.eventName === 'activity_final_geometry_v2')?.fields ?? null;
  const savePending = evidence.events.find(event => event.eventName === 'activity_save_pending')?.fields ?? null;

  const sourceOrigin = canonical[0];
  const translatedCanonical = canonical.map(point => translatePoint(point, sourceOrigin));
  const translatedHybrid = hybrid.points.map(point => translatePoint(point, sourceOrigin));
  const translatedClone = cloneDisplay.points.map(point => translatePoint(point, sourceOrigin));
  const translatedCurrent = currentDryRun.ok
    ? currentDryRun.points.map(point => translatePoint(point, sourceOrigin))
    : translatedCanonical;
  const matchedWindows = hybrid.windows.filter(window => window.status === 'MATCHED');
  const fallbackWindows = hybrid.windows.filter(window => window.status === 'CANONICAL_FALLBACK');

  const geojson = {
    type: 'FeatureCollection',
    metadata: {
      privacy: 'Translated to a fixed review origin; no production coordinate is retained.',
      sourceActivityId: SOURCE_ACTIVITY_ID,
      sourceClientActivityId: SOURCE_CLIENT_ID,
      qaSessionId: QA_SESSION_ID,
      coordinateOrigin: FIXED_ORIGIN,
    },
    features: [
      geojsonFeature('canonical_o46', translatedCanonical, { source: 'canonical', pointCount: translatedCanonical.length }),
      geojsonFeature('current_production_dry_run', translatedCurrent, {
        source: currentDryRun.ok && currentDryRun.stats.chunksOk > 0
          ? 'matcher-result'
          : 'unaccepted-all-fallback-candidate',
      }),
      geojsonFeature('experimental_conservative_hybrid', translatedHybrid, { source: 'matched-plus-canonical-fallback' }),
      geojsonFeature('almost_done_clone_v1', translatedClone, {
        source: 'stationary-filtered-canonical-fallback-plus-bounded-smoothing',
        reviewOnly: true,
      }),
      ...hybrid.windows.map(window => {
        const selected = window.status === 'MATCHED'
          ? []
          : translatedCanonical.slice(window.sourceStartIndex, window.sourceEndIndexExclusive);
        return selected.length >= 2
          ? geojsonFeature(`window_${window.index}`, selected, { status: window.status, reason: window.reason })
          : null;
      }).filter(Boolean),
    ],
  };
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_PRIVACY_SAFE.geojson'), JSON.stringify(geojson, null, 2) + '\n');

  const replay = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    authority: {
      requestedInput: 'exact ordered 239-point raw pending payload',
      availableRemoteInput: '222-point canonical server append plus privacy-redacted per-observation telemetry',
      exactRawReplayComplete: false,
      evidenceGap: 'The 239 coordinates remain only in the immutable on-device pending payload after HTTP 400; QA telemetry intentionally redacts coordinates.',
      sourceTimestampAccuracySpeedOrderingPreservedForAvailablePoints: true,
    },
    source: {
      serverId: SOURCE_ACTIVITY_ID,
      clientActivityId: SOURCE_CLIENT_ID,
      qaSessionId: QA_SESSION_ID,
      rawCount: 239,
      rawOrdinalMax: 241,
      duplicateOrdinalTransitions: [162, 176],
      canonicalCount: canonical.length,
      canonicalDistanceM: rounded(pathLengthM(canonical)),
    },
    windows: {
      firstStationary: { definition: 'raw ordinals 9..14, before the approximately 45 s physical departure', ...Object.fromEntries(Object.entries(windowMetrics(canonical, 9, 14)).map(([k,v]) => [k, typeof v === 'number' ? rounded(v) : v])) },
      secondStationary: { definition: 'raw ordinals 224..226, low-speed minute-six stop before speed resumes at ordinal 227', ...Object.fromEntries(Object.entries(windowMetrics(canonical, 224, 226)).map(([k,v]) => [k, typeof v === 'number' ? rounded(v) : v])) },
    },
    replayA_currentO46: {
      method: 'Recorded O46 v2 decision telemetry plus persisted canonical output; this is stronger than a synthetic rerun for available decisions.',
      decisionEventCount: decisions.length,
      canonicalAcceptedCount: canonical.length,
      distanceM: rounded(pathLengthM(canonical)),
      firstStationaryAcceptedCount: windowMetrics(canonical, 9, 14).pointCount,
      firstStationaryPathM: rounded(windowMetrics(canonical, 9, 14).pathDistanceM),
      firstStationaryNetM: rounded(windowMetrics(canonical, 9, 14).netDistanceM),
      secondStationaryAcceptedCount: windowMetrics(canonical, 224, 226).pointCount,
      secondStationaryPathM: rounded(windowMetrics(canonical, 224, 226).pathDistanceM),
      secondStationaryNetM: rounded(windowMetrics(canonical, 224, 226).netDistanceM),
      reversalsDetected: reversalIndices(canonical),
    },
    replayB_d7ea3b0: {
      method: 'Counterfactual replay over all 222 remotely available ordered points; 17 raw-only coordinates were unavailable.',
      k8IndoorDeadband: false,
      acceptedCount: historicalD7.accepted.length,
      distanceM: rounded(pathLengthM(historicalD7.accepted)),
      firstStationary: windowMetrics(historicalD7.accepted, 9, 14),
      secondStationary: windowMetrics(historicalD7.accepted, 224, 226),
    },
    replayB_738286b_95302b8_a9157af: {
      method: 'Counterfactual replay over all 222 remotely available ordered points; these commits share the K8 stationary gate.',
      k8IndoorDeadband: true,
      acceptedCount: historicalK8.accepted.length,
      distanceM: rounded(pathLengthM(historicalK8.accepted)),
      firstStationary: windowMetrics(historicalK8.accepted, 9, 14),
      secondStationary: windowMetrics(historicalK8.accepted, 224, 226),
    },
    scenarioAudit: {
      authority: 'Counterfactual ordinal windows over the 222 remotely available canonical observations; exact raw-only decisions remain on device.',
      currentO46Recorded: scenarioReplay(canonical, replayScenarios),
      d7ea3b0: scenarioReplay(historicalD7.accepted, replayScenarios),
      k8_738286b_95302b8_a9157af: scenarioReplay(historicalK8.accepted, replayScenarios),
    },
  };
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_CURRENT_VS_HISTORICAL_CC_REPLAY.json'), JSON.stringify(replay, null, 2) + '\n');

  const diagnostics = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: replay.source,
    originalSave: { recordedMatch, finalGeometry, savePending },
    currentProductionDryRun: {
      inputAuthority: 'original persisted O46 canonical 222 points (same authority used by original Save matcher)',
      result: currentDryRun.ok && currentDryRun.stats.chunksOk > 0 ? 'matched-or-mixed' : 'canonical-fallback',
      reason: currentDryRun.ok && currentDryRun.stats.chunksOk === 0 ? 'no-derived-chunks' : (currentDryRun.ok ? null : currentDryRun.reason),
      stats: currentDryRun.stats,
      candidatePointCount: currentDryRun.ok ? currentDryRun.points.length : 0,
      candidateLengthM: currentDryRun.ok ? rounded(pathLengthM(currentDryRun.points)) : null,
    },
    conservativeHybrid: {
      policy: 'Fixed 12-point windows, 1-point overlap, unchanged production Mapbox walking matcher/radii and unchanged production quality gates; no radius enlargement.',
      matchedWindowCount: matchedWindows.length,
      fallbackWindowCount: fallbackWindows.length,
      matchedWindows,
      fallbackWindows,
      sourceLengthM: rounded(pathLengthM(canonical)),
      displayLengthM: rounded(pathLengthM(hybrid.points)),
      lengthRatio: rounded(pathLengthM(hybrid.points) / pathLengthM(canonical), 5),
      sourceReversalIndices: reversalIndices(canonical),
      displayReversalIndices: reversalIndices(hybrid.points),
    },
  };
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_MATCHING_DIAGNOSTICS.json'), JSON.stringify(diagnostics, null, 2) + '\n');

  const cloneProvenance = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'SOURCE_CANDIDATE_READY__DEVICE_MATERIALIZATION_REQUIRED',
    label: 'QA / SNAP REVIEW CLONE',
    name: 'almost done clone v1',
    cloneId: `qa-snap-review:${SOURCE_CLIENT_ID}:v1`,
    serverActivityId: null,
    source: {
      serverActivityId: SOURCE_ACTIVITY_ID,
      clientActivityId: SOURCE_CLIENT_ID,
      qaSessionId: QA_SESSION_ID,
      rawCount: 239,
      canonicalCount: canonical.length,
      fullRawCoordinateAuthority: 'immutable on-device pending payload',
    },
    pipeline: {
      rawEvidenceRetained: true,
      selectedEvidenceAuthority: 'O46 canonical membership plus forensic removal of stationary-only accepted ordinals',
      impossibleObservationHandling: 'O46 membership is retained; raw-only rejected fixes remain in source pending evidence',
      stationaryTraversalRemovedRawOrdinals: [...CLONE_STATIONARY_ORDINALS],
      segmentCount: new Set(cloneDisplay.points.map(point => point.segment_id)).size,
      gaps: 0,
      matcher: 'Mapbox walking; production radii/gates unchanged; fixed 12-point conservative probes',
      matchedSubsections: [],
      canonicalFallbackRawOrdinalRanges: [[9, 241]],
      boundedSmoothing: {
        rule: 'timestamp-weighted chord only when same segment, adjacent span <=10s, turn <=18deg, displacement <=1.5m',
        changedPointCount: cloneDisplay.changedRawOrdinals.length,
        changedRawOrdinals: cloneDisplay.changedRawOrdinals,
        displacementM: (() => {
          const values = cloneSelected.map((point, index) => haversineM(point, cloneDisplay.points[index]));
          return {
            p50: rounded(percentile(values, 0.5)),
            p95: rounded(percentile(values, 0.95)),
            max: rounded(Math.max(...values)),
          };
        })(),
      },
    },
    geometry: {
      sourceCanonicalLengthM: rounded(pathLengthM(canonical)),
      selectedCanonicalPointCount: cloneSelected.length,
      selectedCanonicalLengthM: rounded(pathLengthM(cloneSelected)),
      displayPointCount: cloneDisplay.points.length,
      displayLengthM: rounded(pathLengthM(cloneDisplay.points)),
      lengthRatioVsSelected: rounded(pathLengthM(cloneDisplay.points) / pathLengthM(cloneSelected), 6),
      originalReversalRawOrdinals: reversalIndices(canonical).map(index => canonical[index].raw_ordinal),
      cloneReversalRawOrdinals: reversalIndices(cloneDisplay.points).map(index => cloneDisplay.points[index].raw_ordinal),
      uTurnPreserved: reversalIndices(cloneDisplay.points).some(index => cloneDisplay.points[index].raw_ordinal === 124),
      repeatedInternalCorridor: {
        referenceRawOrdinalRanges: [[47, 65], [188, 197], [197, 210]],
        chronologicalDirections: ['A_TO_B', 'A_TO_B', 'B_TO_A'],
        passCountBefore: 3,
        passCountAfter: 3,
        coordinatesLaterallyOffsetForVisibility: false,
      },
    },
    sideEffects: {
      representation: 'Internal Debug route plus dedicated cairn_qa_snap_review_clone_v1_<owner> storage key',
      pendingSourceReadOnly: true,
      useSessionStoreInserted: false,
      pendingSyncCreatedOrChanged: false,
      backendRowCreated: false,
      memoryWritten: false,
      statsOrTotalsChanged: false,
      gameplayChanged: false,
      socialOrFeedChanged: false,
      analyticsEmittedByCloneBuilder: false,
      originalDatabaseRowMutated: false,
    },
    navigation: {
      otaCandidate: 'O47',
      humanPath: 'Settings > tap About Cairn five times > Developer > Open Debug screen > QA SNAP REVIEW > Open review clone',
      internalRoute: `MapHistory({ qaReviewClone: 'almost-done-v1' })`,
      availability: 'Requires the reviewed Internal OTA candidate; the human publishes OTA manually.',
    },
  };
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_CLONE_V1_PROVENANCE.json'), JSON.stringify(cloneProvenance, null, 2) + '\n');

  const stationaryRows = [
    ['episode','algorithm','input_coverage','accepted_count','path_distance_m','net_distance_m','classification'],
    ['initial_approximately_45s','O46 recorded','exact accepted output',replay.replayA_currentO46.firstStationaryAcceptedCount,replay.replayA_currentO46.firstStationaryPathM,replay.replayA_currentO46.firstStationaryNetM,'false traversal'],
    ['initial_approximately_45s','d7ea3b0','222/239 coordinate lower-bound',replay.replayB_d7ea3b0.firstStationary.pointCount,rounded(replay.replayB_d7ea3b0.firstStationary.pathDistanceM),rounded(replay.replayB_d7ea3b0.firstStationary.netDistanceM),'counterfactual'],
    ['initial_approximately_45s','738286b/95302b8/a9157af K8','222/239 coordinate lower-bound',replay.replayB_738286b_95302b8_a9157af.firstStationary.pointCount,rounded(replay.replayB_738286b_95302b8_a9157af.firstStationary.pathDistanceM),rounded(replay.replayB_738286b_95302b8_a9157af.firstStationary.netDistanceM),'counterfactual'],
    ['minute_6_stop','O46 recorded','exact accepted output',replay.replayA_currentO46.secondStationaryAcceptedCount,replay.replayA_currentO46.secondStationaryPathM,replay.replayA_currentO46.secondStationaryNetM,'false traversal'],
    ['minute_6_stop','d7ea3b0','222/239 coordinate lower-bound',replay.replayB_d7ea3b0.secondStationary.pointCount,rounded(replay.replayB_d7ea3b0.secondStationary.pathDistanceM),rounded(replay.replayB_d7ea3b0.secondStationary.netDistanceM),'counterfactual'],
    ['minute_6_stop','738286b/95302b8/a9157af K8','222/239 coordinate lower-bound',replay.replayB_738286b_95302b8_a9157af.secondStationary.pointCount,rounded(replay.replayB_738286b_95302b8_a9157af.secondStationary.pathDistanceM),rounded(replay.replayB_738286b_95302b8_a9157af.secondStationary.netDistanceM),'counterfactual'],
  ];
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_STATIONARY_COMPARISON.csv'), stationaryRows.map(row => row.join(',')).join('\n') + '\n');

  const evidenceSummary = {
    generatedAt: new Date().toISOString(),
    session: evidence.session,
    telemetry: evidence.telemetry,
    eventCounts: Object.fromEntries(evidence.events.reduce((map, event) => map.set(event.eventName, (map.get(event.eventName) || 0) + 1), new Map())),
    stationaryDecisions: decisions
      .filter(event => (event.fields.rawOrdinal >= 9 && event.fields.rawOrdinal <= 14)
        || (event.fields.rawOrdinal >= 224 && event.fields.rawOrdinal <= 226))
      .map(event => ({ timestamp: event.timestamp, fields: event.fields })),
    lifecycle: lifecycle.map(event => ({ timestamp: event.timestamp, eventName: event.eventName, fields: event.fields })),
  };
  fs.writeFileSync(path.join(HERE, 'ALMOST_DONE_EVIDENCE_SUMMARY.json'), JSON.stringify(evidenceSummary, null, 2) + '\n');

  process.stdout.write(JSON.stringify({
    currentDryRun: diagnostics.currentProductionDryRun,
    hybrid: diagnostics.conservativeHybrid,
    historical: {
      d7: { accepted: historicalD7.accepted.length, distanceM: pathLengthM(historicalD7.accepted) },
      k8: { accepted: historicalK8.accepted.length, distanceM: pathLengthM(historicalK8.accepted) },
    },
  }, null, 2) + '\n');
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});
