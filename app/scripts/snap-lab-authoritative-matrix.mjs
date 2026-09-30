#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright';
import sharp from 'sharp';

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const has = name => process.argv.includes(name);
const fixturesRoot = path.resolve(arg('--fixtures') ?? '_review/snap-lab-fixtures');
const outputRoot = path.resolve(arg('--output') ?? '_review/snap-lab-matrix');
const baseUrl = arg('--url', 'http://127.0.0.1:8098');
const sourceHead = arg('--head', '0000000000000000000000000000000000000000');
const sourceStartTree = arg('--start-tree', 'dirty-development-worktree');
const sourceEndTree = arg('--end-tree', sourceStartTree);
const phaseName = arg('--phase', 'development');
const onlyCase = arg('--case');
const onlyMode = arg('--mode');
const onlyProfile = arg('--profile');
const limit = Number(arg('--limit', '0')) || Infinity;
const ownerUserId = arg('--owner', `snap-lab-${phaseName}-owner`);
const profileDir = path.join(outputRoot, '_browser-profile');
const runSummaryPath = path.join(outputRoot, 'RUN_RESULTS.json');
const manifest = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'FIXTURE_MANIFEST.json'), 'utf8'));

const sha256Bytes = value => crypto.createHash('sha256').update(value).digest('hex');
const sha256File = file => sha256Bytes(fs.readFileSync(file));
const stableStringify = value => JSON.stringify(value, Object.keys(value ?? {}).sort());
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const copyJson = (file, value) => writeJson(file, value);
const artifact = (runDir, file, kind) => ({
  path: path.relative(runDir, file).split(path.sep).join('/'),
  sha256: sha256File(file),
  kind,
});

function publicFixture(fixture) {
  const { truthPrivate: _truth, oraclePrivate: _oracle, ...publicValue } = fixture;
  return {
    ...publicValue,
    rawEvents: publicValue.rawEvents.map(event => {
      const { truth: _eventTruth, ...publicEvent } = event;
      return publicEvent;
    }),
  };
}

function geojson(points) {
  const segments = [];
  let current = [];
  let lastSegment = null;
  for (const point of points ?? []) {
    const segment = point.segmentId ?? 'legacy';
    if (lastSegment !== null && segment !== lastSegment) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push([point.lng, point.lat]);
    lastSegment = segment;
  }
  if (current.length > 0) segments.push(current);
  return {
    type: 'FeatureCollection',
    features: segments.map((coordinates, index) => ({
      type: 'Feature',
      properties: { segmentIndex: index },
      geometry: coordinates.length >= 2
        ? { type: 'LineString', coordinates }
        : { type: 'Point', coordinates: coordinates[0] },
    })),
  };
}

const EARTH = 111_320;
function local(point, origin) {
  return {
    x: (point.lng - origin.lng) * EARTH * Math.cos(origin.lat * Math.PI / 180),
    y: (point.lat - origin.lat) * EARTH,
  };
}
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
function pathLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += distance(points[index - 1], points[index]);
  return total;
}
function nearestSegmentDistance(point, route) {
  let best = Infinity;
  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const denom = dx * dx + dy * dy;
    const t = denom <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denom));
    best = Math.min(best, distance(point, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return Number.isFinite(best) ? best : 0;
}
function resample(points, spacing = 2) {
  if (points.length < 2) return points.slice();
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative.at(-1) + distance(points[index - 1], points[index]));
  const total = cumulative.at(-1);
  const result = [];
  for (let target = 0; target <= total; target += spacing) {
    let index = 1;
    while (index < cumulative.length && cumulative[index] < target) index += 1;
    if (index >= cumulative.length) index = cumulative.length - 1;
    const edge = cumulative[index] - cumulative[index - 1];
    const t = edge <= 0 ? 0 : (target - cumulative[index - 1]) / edge;
    result.push({
      x: points[index - 1].x + (points[index].x - points[index - 1].x) * t,
      y: points[index - 1].y + (points[index].y - points[index - 1].y) * t,
    });
  }
  if (distance(result.at(-1), points.at(-1)) > 0.01) result.push({ ...points.at(-1) });
  return result;
}
const percentile = (values, fraction) => {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
};
function headingChangeRms(points) {
  if (points.length < 3) return 0;
  const headings = [];
  for (let index = 1; index < points.length; index += 1) {
    headings.push(Math.atan2(points[index].y - points[index - 1].y, points[index].x - points[index - 1].x));
  }
  const changes = [];
  for (let index = 1; index < headings.length; index += 1) {
    let delta = (headings[index] - headings[index - 1]) * 180 / Math.PI;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    changes.push(delta);
  }
  return Math.sqrt(changes.reduce((sum, value) => sum + value * value, 0) / Math.max(1, changes.length));
}
function microTurnCount(points) {
  if (points.length < 3) return 0;
  let count = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const c = points[index + 1];
    const ab = distance(a, b);
    const bc = distance(b, c);
    if (ab > 18 || bc > 18 || ab < 0.5 || bc < 0.5) continue;
    const h1 = Math.atan2(b.y - a.y, b.x - a.x);
    const h2 = Math.atan2(c.y - b.y, c.x - b.x);
    let delta = Math.abs((h2 - h1) * 180 / Math.PI);
    if (delta > 180) delta = 360 - delta;
    if (delta >= 45) count += 1;
  }
  return count;
}
function routeMetrics(points, truthRoute, origin) {
  const converted = (points ?? []).map(point => local(point, origin));
  const samples = resample(converted, 2);
  const deviations = samples.map(point => nearestSegmentDistance(point, truthRoute));
  return {
    pointCount: converted.length,
    lengthM: pathLength(converted),
    lateralMeanM: deviations.length ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length : 0,
    lateralP95M: percentile(deviations, 0.95),
    lateralMaxM: deviations.length ? Math.max(...deviations) : 0,
    headingChangeRmsDeg: headingChangeRms(resample(converted, 10)),
    unsupportedMicroTurnCount: microTurnCount(converted),
    segmentCount: new Set((points ?? []).map(point => point.segmentId ?? 'legacy')).size,
  };
}
function scoreRun(fixture, run, networkViolations) {
  const truthRoute = fixture.truthPrivate.controlPoints.map(point => point.local);
  const origin = fixture.truthPrivate.origin;
  const canonical = routeMetrics(run.persisted.canonicalPoints, truthRoute, origin);
  const live = routeMetrics(run.persisted.liveBeforeFinish, truthRoute, origin);
  const localFinal = routeMetrics(run.persisted.localFinal, truthRoute, origin);
  const selected = routeMetrics(run.persisted.selectedFinal, truthRoute, origin);
  const failures = [];
  const require = (condition, code, details = {}) => {
    if (!condition) failures.push({ code, details });
  };
  require(run.persisted.realm === 'snap-lab', 'QA_REALM_MISMATCH');
  require(run.cleanupStatus?.status === 'cleared', 'QA_REALM_CLEANUP_FAILED', run.cleanupStatus ?? {});
  if (fixture.profile !== 'primary') {
    require(run.secondaryDetailCapture?.status === 'captured', 'ACTUAL_DETAIL_CAPTURE_MISSING', run.secondaryDetailCapture ?? {});
  }
  require(run.persisted.activityId === run.activityId, 'ACTIVITY_ID_MISMATCH');
  require(run.completedWalPointCount === run.persisted.canonicalPoints.length, 'WAL_CANONICAL_FRONTIER_MISMATCH', {
    wal: run.completedWalPointCount,
    canonical: run.persisted.canonicalPoints.length,
  });
  require(run.preFinish.qaMemoryPointCount > 0, 'QA_MEMORY_DID_NOT_GROW_BEFORE_FINISH');
  require(run.preFinish.personalMemoryPointCount === 0, 'PERSONAL_MEMORY_CONTAMINATION');
  require(networkViolations.length === 0, 'QA_PRODUCTION_NETWORK_WRITE', { networkViolations });
  require(run.persisted.session.finalGeometryFingerprint === run.coldReopened.session.finalGeometryFingerprint,
    'COLD_REOPEN_ARTIFACT_DRIFT');
  require(run.persisted.session.finalGeometryRevision === run.coldReopened.session.finalGeometryRevision,
    'COLD_REOPEN_REVISION_DRIFT');
  require(selected.lengthM >= canonical.lengthM * 0.67 && selected.lengthM <= canonical.lengthM * 1.5,
    'WHOLE_ROUTE_LENGTH_RATIO', { canonical: canonical.lengthM, selected: selected.lengthM });
  if (fixture.oraclePrivate.trueGapExpected) {
    require(canonical.segmentCount >= 2, 'TRUE_GAP_NOT_CLASSIFIED', { segments: canonical.segmentCount });
    require(selected.segmentCount === canonical.segmentCount, 'SELECTED_GAP_STRUCTURE_CHANGED', {
      canonical: canonical.segmentCount,
      selected: selected.segmentCount,
    });
  }
  if (fixture.caseId === 'SL06') require(canonical.segmentCount === 1, 'DELAYED_BATCH_FALSE_GAP');
  if (fixture.caseId === 'SL12') {
    require(run.persisted.selectedSource === 'local', 'NEGATIVE_CONTROL_NETWORK_SELECTED', {
      selectedSource: run.persisted.selectedSource,
    });
  }
  if (fixture.caseId === 'SL13') {
    require(run.persisted.selectedSource === 'hybrid', 'PROVENANCE_CONTROL_NOT_HYBRID', {
      selectedSource: run.persisted.selectedSource,
    });
    const acceptedM = run.persisted.segmentStats.reduce(
      (sum, stats) => sum + (stats.acceptedMatchedDistanceM ?? 0), 0,
    );
    const localM = run.persisted.segmentStats.reduce(
      (sum, stats) => sum + (stats.canonicalFallbackDistanceM ?? 0), 0,
    );
    require(acceptedM > 30 && localM > 30, 'PROVENANCE_POSITIVE_OR_NEGATIVE_CONTROL_MISSING', {
      acceptedM,
      localM,
    });
  }
  if (fixture.caseId === 'SL10') {
    const barrier = fixture.availableMap.barriers[0];
    const barrierStart = local(barrier.from, origin);
    const barrierEnd = local(barrier.to, origin);
    const lowX = Math.min(barrierStart.x, barrierEnd.x);
    const highX = Math.max(barrierStart.x, barrierEnd.x);
    const wallY = (barrierStart.y + barrierEnd.y) / 2;
    const poisonedSections = run.persisted.segmentStats
      .flatMap(stats => stats.sections ?? [])
      .filter(section => section.decision === 'refined')
      .filter(section => run.persisted.canonicalPoints
        .slice(section.sourceStart, section.sourceEnd + 1)
        .map(point => local(point, origin))
        .some(point => point.x > lowX + 1 && point.x < highX - 1 && point.y > wallY + 0.5));
    require(poisonedSections.length === 0, 'INACCESSIBLE_ARTERIAL_SECTION_SELECTED', {
      poisonedSections: poisonedSections.map(section => ({
        sourceStart: section.sourceStart,
        sourceEnd: section.sourceEnd,
        geometryMode: section.geometryMode,
      })),
    });
  }
  if (fixture.oraclePrivate.requiresPositiveRoadCoverage) {
    require(run.persisted.selectedSource !== 'local' || fixture.lifecycle.offlineAtFinish,
      'POSITIVE_CONTROL_NO_ROAD_REFINEMENT', { selectedSource: run.persisted.selectedSource });
  }
  if (fixture.caseId === 'SL02') {
    const lateralImprovement = localFinal.lateralMeanM <= 0
      ? 0
      : (localFinal.lateralMeanM - selected.lateralMeanM) / localFinal.lateralMeanM;
    const headingImprovement = localFinal.headingChangeRmsDeg <= 0
      ? 0
      : (localFinal.headingChangeRmsDeg - selected.headingChangeRmsDeg) / localFinal.headingChangeRmsDeg;
    require(Math.max(lateralImprovement, headingImprovement) >= 0.10,
      'STRAIGHT_REFINEMENT_NOT_MEANINGFUL', { lateralImprovement, headingImprovement });
  }
  if (fixture.oraclePrivate.preserveStructures) {
    require(selected.lengthM >= canonical.lengthM * 0.75, 'PROTECTED_STRUCTURE_SHORTENED');
  }
  if (fixture.lifecycle.offlineAtFinish) {
    require(run.offlineUpgrade !== null, 'OFFLINE_UPGRADE_NOT_EXERCISED');
    require(run.offlineUpgrade?.firstStatus === 'upgraded', 'OFFLINE_ONLINE_UPGRADE_NOT_APPLIED', run.offlineUpgrade ?? {});
    require(run.offlineUpgrade?.secondStatus === 'already-terminal', 'REPEATED_UPGRADE_NOT_BLOCKED', run.offlineUpgrade ?? {});
    require(run.offlineUpgrade?.snapshotFingerprintBefore === run.offlineUpgrade?.snapshotFingerprintAfter,
      'PRE_UPGRADE_ROUTE_SNAPSHOT_MUTATED');
  }
  if (fixture.lifecycle.walReadFaultOnce) {
    require(run.firstFinishResult?.status === 'recoverable-failure', 'WAL_FAULT_DID_NOT_FAIL_RECOVERABLY');
    require(['saved', 'saved-local'].includes(run.retryFinishResult?.status), 'WAL_RETRY_DID_NOT_SAVE');
  }
  const hostLimit = ['SL23', 'SL24'].includes(fixture.caseId) ? 250 : 100;
  const queueLimit = ['SL23', 'SL24'].includes(fixture.caseId) ? 500 : 250;
  require(run.hostPerformance.maxObservationWorkMs <= hostLimit, 'HOST_OBSERVATION_WORK_BUDGET', {
    actualMs: run.hostPerformance.maxObservationWorkMs,
    limitMs: hostLimit,
  });
  require(run.hostPerformance.queuedActionLatencyMs <= queueLimit, 'HOST_ACTION_LATENCY_BUDGET', {
    actualMs: run.hostPerformance.queuedActionLatencyMs,
    limitMs: queueLimit,
  });
  if (!fixture.lifecycle.walReadFaultOnce) {
    require(run.hostPerformance.finishDurationMs <= 5_000, 'HEALTHY_FINISH_WALL_BUDGET', {
      actualMs: run.hostPerformance.finishDurationMs,
    });
  }
  const requestResults = run.persisted.segmentStats.flatMap(stats => stats.requestResults ?? []);
  if (['SL23', 'SL24'].includes(fixture.caseId) && requestResults.length > 0) {
    // Request source indices are segment-local by contract. Comparing them to
    // whole-Activity point count falsely labels every later physical segment
    // as "early". Audit opportunity within each segment, then union buckets.
    const buckets = new Set(run.persisted.segmentStats.flatMap(stats => (
      (stats.requestResults ?? []).filter(request => request.invoked).flatMap(request => {
        // Fairness is opportunity *coverage*, not the bucket containing only
        // a technical window's first sample. A sparse 0-79 / 72-120 plan over
        // 121 samples covers early, middle and late even though neither start
        // index happens to fall inside the final third.
        const last = Math.max(0, stats.canonicalPointCount - 1);
        const boundaries = [
          { name: 'early', start: 0, end: last / 3 },
          { name: 'middle', start: last / 3, end: last * 2 / 3 },
          { name: 'late', start: last * 2 / 3, end: last },
        ];
        return boundaries
          .filter(bucket => request.sourceEnd >= bucket.start && request.sourceStart <= bucket.end)
          .map(bucket => bucket.name);
      })
    )));
    require(buckets.has('early') && buckets.has('middle') && buckets.has('late'),
      'LONG_ROUTE_REQUEST_OPPORTUNITY_UNFAIR', { buckets: [...buckets] });
  }
  return {
    failures,
    metrics: {
      canonical,
      live,
      localFinal,
      selected,
      localVsLive: {
        lateralMeanDeltaM: localFinal.lateralMeanM - live.lateralMeanM,
        headingRmsDeltaDeg: localFinal.headingChangeRmsDeg - live.headingChangeRmsDeg,
        microTurnDelta: localFinal.unsupportedMicroTurnCount - live.unsupportedMicroTurnCount,
      },
      selectedVsLocal: {
        lateralMeanDeltaM: selected.lateralMeanM - localFinal.lateralMeanM,
        headingRmsDeltaDeg: selected.headingChangeRmsDeg - localFinal.headingChangeRmsDeg,
        microTurnDelta: selected.unsupportedMicroTurnCount - localFinal.unsupportedMicroTurnCount,
      },
      logicalDurationSeconds: fixture.durationSeconds,
      hostPerformance: run.hostPerformance,
      matchedDistanceM: run.persisted.segmentStats.reduce((sum, stats) => sum + (stats.acceptedMatchedDistanceM ?? 0), 0),
      localDistanceM: run.persisted.segmentStats.reduce((sum, stats) => sum + (stats.canonicalFallbackDistanceM ?? 0), 0),
      requestCount: run.persisted.requestCount,
      directionsRequestCount: run.persisted.directionsRequestCount,
      acceptedIslandCount: run.persisted.acceptedIslandCount,
    },
  };
}

function comparisonSvg(fixture, run, metrics) {
  const origin = fixture.truthPrivate.origin;
  const layers = [
    ['Truth', fixture.truthPrivate.controlPoints.map(point => point.local), '#68776b'],
    ['Raw', fixture.rawEvents.map(event => event.observedLocal), '#b8833b'],
    ['Canonical', run.persisted.canonicalPoints.map(point => local(point, origin)), '#327086'],
    ['Live', run.persisted.liveBeforeFinish.map(point => local(point, origin)), '#7b68a6'],
    ['Local Final', run.persisted.localFinal.map(point => local(point, origin)), '#315d3a'],
    ['Selected Final', run.persisted.selectedFinal.map(point => local(point, origin)), '#dc4c35'],
  ];
  const mapPaths = fixture.availableMap.paths.map(item => item.localPoints);
  const all = [...layers.flatMap(item => item[1]), ...mapPaths.flat()];
  const minX = Math.min(...all.map(point => point.x));
  const maxX = Math.max(...all.map(point => point.x));
  const minY = Math.min(...all.map(point => point.y));
  const maxY = Math.max(...all.map(point => point.y));
  const width = 1200;
  const height = 720;
  const pad = 70;
  const scale = Math.min((width - pad * 2) / Math.max(1, maxX - minX), (height - pad * 2) / Math.max(1, maxY - minY));
  const xy = point => `${(pad + (point.x - minX) * scale).toFixed(1)},${(height - pad - (point.y - minY) * scale).toFixed(1)}`;
  const lines = [];
  for (const map of mapPaths) lines.push(`<polyline points="${map.map(xy).join(' ')}" fill="none" stroke="#d4d0c4" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const [label, points, color] of layers) {
    if (points.length < 2) continue;
    const dashed = label === 'Raw' ? ' stroke-dasharray="2 5"' : '';
    const widthValue = label === 'Selected Final' ? 4.5 : label === 'Truth' ? 5 : 2.2;
    lines.push(`<polyline points="${points.map(xy).join(' ')}" fill="none" stroke="${color}" stroke-width="${widthValue}" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"${dashed}/>`);
  }
  const legend = layers.map(([label, _points, color], index) => `<g transform="translate(${25 + index * 185},28)"><line x1="0" y1="0" x2="28" y2="0" stroke="${color}" stroke-width="5"/><text x="36" y="5" font-size="16" fill="#26342b">${label}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#faf8f0"/><text x="25" y="700" font-size="14" fill="#536158">${fixture.caseId} ${fixture.mode} ${fixture.profile} · selected ${run.persisted.selectedSource} · p95 ${metrics.selected.lateralP95M.toFixed(1)}m</text>${legend}${lines.join('')}</svg>`;
}

async function writeEvidence(fixture, run, browserWrites, sourceError = null) {
  const runId = `${fixture.caseId}/${fixture.mode}/${fixture.profile}`;
  const runDir = path.join(outputRoot, 'cases', fixture.caseId, fixture.mode, fixture.profile);
  fs.mkdirSync(path.join(runDir, 'screenshots'), { recursive: true });
  const truthFile = path.join(runDir, 'TRUTH_PRIVATE.json');
  const mapFile = path.join(runDir, 'MAP_FIXTURE.json');
  const rawFile = path.join(runDir, 'INPUT_RAW.jsonl');
  const clocksFile = path.join(runDir, 'EVENTS_AND_CLOCKS.json');
  copyJson(truthFile, fixture.truthPrivate);
  copyJson(mapFile, fixture.availableMap);
  writeText(rawFile, `${fixture.rawEvents.map(event => JSON.stringify(publicFixture({ rawEvents: [event] }).rawEvents[0])).join('\n')}\n`);
  copyJson(clocksFile, { clock: fixture.clock, lifecycle: fixture.lifecycle, events: fixture.rawEvents.map(event => ({ ordinal: event.ordinal, observationTimeMs: event.observationTimeMs, deliveryTimeMs: event.deliveryTimeMs, appState: event.appState })) });
  if (!run) {
    const result = {
      runId,
      caseId: fixture.caseId,
      mode: fixture.mode,
      profile: fixture.profile,
      status: 'USER_BLOCKER',
      source: { head: sourceHead, inputHash: fixture.fixtureSha256, startTree: sourceStartTree, endTree: sourceEndTree },
      execution: { platform: 'EXPO_WEB_ACTUAL_APP', transport: fixture.lifecycle.offlineAtFinish ? 'OFFLINE' : 'SYNTHETIC_HTTP_FIXTURE', clockMode: 'separate-observation-delivery-logical-processing-plus-host-performance', primaryUiExecuted: false },
      activity: { realm: 'qa', clientActivityId: null, saved: false, selectedRevision: null, selectedFingerprint: null },
      artifacts: {
        truth: artifact(runDir, truthFile, 'OTHER'),
        raw: artifact(runDir, rawFile, 'RAW_INPUT'),
        map: artifact(runDir, mapFile, 'OTHER'),
        clocks: artifact(runDir, clocksFile, 'OTHER'),
      },
      failures: [{ code: 'EXECUTION_EXCEPTION', details: sourceError }],
      review: { status: 'NOT_REVIEWED', reviewer: null, artifactRefs: [], notes: 'Development/final logical runner failure retained.' },
    };
    writeJson(path.join(runDir, 'RESULT.json'), result);
    return result;
  }
  const scoring = scoreRun(fixture, run, browserWrites);
  const qaFile = path.join(runDir, 'QA_ACTIVITY_SNAPSHOT.json');
  const canonicalFile = path.join(runDir, 'CANONICAL.geojson');
  const liveFile = path.join(runDir, 'LIVE_BEFORE_FINISH.geojson');
  const localFile = path.join(runDir, 'LOCAL_FINAL.geojson');
  const selectedFile = path.join(runDir, 'SELECTED_FINAL.geojson');
  const ledgerFile = path.join(runDir, 'STAGE_LEDGER.json');
  const requestFile = path.join(runDir, 'REQUEST_PLAN.json');
  const receiptFile = path.join(runDir, 'REQUEST_RESPONSE_RECEIPTS.json');
  const sectionFile = path.join(runDir, 'SECTION_DECISIONS.json');
  const metricsFile = path.join(runDir, 'METRICS.json');
  const storageDir = path.join(runDir, 'QA_STORAGE_SNAPSHOT');
  const storageFile = path.join(storageDir, 'SUMMARY.json');
  const simulatorDiagnosticsFile = path.join(runDir, 'SIMULATOR_DIAGNOSTICS.jsonl');
  copyJson(qaFile, run.persisted);
  copyJson(canonicalFile, geojson(run.persisted.canonicalPoints));
  copyJson(liveFile, geojson(run.persisted.liveBeforeFinish));
  copyJson(localFile, geojson(run.persisted.localFinal));
  copyJson(selectedFile, geojson(run.persisted.selectedFinal));
  copyJson(ledgerFile, run.persisted.stageLedger);
  copyJson(requestFile, run.persisted.segmentStats.flatMap(stats => stats.requestResults ?? []));
  copyJson(receiptFile, run.persisted.transportReceipts);
  copyJson(sectionFile, run.persisted.segmentStats.flatMap(stats => stats.sectionDecisions ?? []));
  copyJson(metricsFile, scoring.metrics);
  copyJson(storageFile, {
    activityId: run.activityId,
    completedWalPointCount: run.completedWalPointCount,
    selectedFingerprint: run.persisted.session.finalGeometryFingerprint,
    selectedRevision: run.persisted.session.finalGeometryRevision,
    coldReopenFingerprint: run.coldReopened.session.finalGeometryFingerprint,
    routeSnapshots: run.persisted.routeSnapshots,
  });
  writeText(simulatorDiagnosticsFile, run.simulatorDiagnostics
    ? `${run.simulatorDiagnostics.trimEnd()}\n`
    : '');
  const svg = comparisonSvg(fixture, run, scoring.metrics);
  const comparisonFile = path.join(runDir, 'comparison.png');
  await sharp(Buffer.from(svg)).png().toFile(comparisonFile);
  writeText(path.join(runDir, 'REVIEW_NOTES.md'), `# ${runId}\n\nAutomated oracle status: ${scoring.failures.length === 0 ? 'PASS_IN_DECLARED_SCOPE' : 'USER_BLOCKER'}\n\nSelected source: ${run.persisted.selectedSource}\n\nFailures: ${scoring.failures.length === 0 ? 'none' : scoring.failures.map(item => item.code).join(', ')}\n`);
  const artifacts = {
    truth: artifact(runDir, truthFile, 'OTHER'),
    map: artifact(runDir, mapFile, 'OTHER'),
    raw: artifact(runDir, rawFile, 'RAW_INPUT'),
    clocks: artifact(runDir, clocksFile, 'OTHER'),
    activity: artifact(runDir, qaFile, 'ACTUAL_QA_SNAPSHOT'),
    canonical: artifact(runDir, canonicalFile, 'OTHER'),
    live: artifact(runDir, liveFile, 'OTHER'),
    localFinal: artifact(runDir, localFile, 'OTHER'),
    selectedFinal: artifact(runDir, selectedFile, 'ACTUAL_SELECTED_GEOMETRY'),
    ledger: artifact(runDir, ledgerFile, 'STAGE_LEDGER'),
    requestPlan: artifact(runDir, requestFile, 'OTHER'),
    receipts: artifact(runDir, receiptFile, 'REQUEST_RECEIPT'),
    sectionDecisions: artifact(runDir, sectionFile, 'SECTION_DECISIONS'),
    metrics: artifact(runDir, metricsFile, 'STRUCTURED_METRICS'),
    storage: artifact(runDir, storageFile, 'OTHER'),
    simulatorDiagnostics: artifact(runDir, simulatorDiagnosticsFile, 'STAGE_LEDGER'),
    comparison: artifact(runDir, comparisonFile, 'DIAGNOSTIC_COMPARISON'),
  };
  const detailFile = path.join(runDir, 'screenshots', '04-detail.png');
  if (fs.existsSync(detailFile)) artifacts.detail = artifact(runDir, detailFile, 'ACTUAL_APP_SCREENSHOT');
  const result = {
    runId,
    caseId: fixture.caseId,
    mode: fixture.mode,
    profile: fixture.profile,
    status: scoring.failures.length === 0 ? 'PASS_IN_DECLARED_SCOPE' : 'USER_BLOCKER',
    source: { head: sourceHead, inputHash: fixture.fixtureSha256, startTree: sourceStartTree, endTree: sourceEndTree },
    execution: {
      platform: 'EXPO_WEB_ACTUAL_APP',
      transport: fixture.lifecycle.offlineAtFinish ? 'OFFLINE' : 'SYNTHETIC_HTTP_FIXTURE',
      clockMode: 'separate-observation-delivery-logical-processing-plus-host-performance',
      primaryUiExecuted: false,
    },
    activity: {
      realm: 'qa',
      clientActivityId: run.activityId,
      saved: true,
      selectedRevision: run.persisted.session.finalGeometryRevision ?? null,
      selectedFingerprint: run.persisted.session.finalGeometryFingerprint ?? null,
    },
    artifacts,
    failures: scoring.failures,
    review: { status: 'NOT_REVIEWED', reviewer: null, artifactRefs: ['comparison', 'metrics', 'sectionDecisions'], notes: `${phaseName} logical acceptance; independent review follows final candidate.` },
    selectedSource: run.persisted.selectedSource,
    hostPerformance: run.hostPerformance,
    callbackAccounting: {
      delivered: run.rawEventCount,
      accepted: run.acceptedCallbackCount,
      rejected: run.rejectedCallbackCount,
      reasons: run.acceptanceReasons,
    },
  };
  writeJson(path.join(runDir, 'RUN_IDENTITY.json'), {
    runId,
    fixtureSha256: fixture.fixtureSha256,
    matrixSha256: manifest.matrixSha256,
    sourceHead,
    sourceStartTree,
    sourceEndTree,
    phaseName,
  });
  writeJson(path.join(runDir, 'RESULT.json'), result);
  return result;
}

let entries = manifest.entries.filter(entry => (
  (!onlyCase || entry.runId.split('/')[0] === onlyCase)
  && (!onlyMode || entry.runId.split('/')[1] === onlyMode)
  && (!onlyProfile || entry.runId.split('/')[2] === onlyProfile)
)).slice(0, limit);
if (has('--reverse')) entries = entries.reverse();
if (entries.length === 0) throw new Error('snap_lab_no_fixture_entries_selected');
fs.mkdirSync(outputRoot, { recursive: true });

const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const context = await chromium.launchPersistentContext(profileDir, {
  headless: true,
  executablePath: chromePath,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -43.5321, longitude: 172.6362, accuracy: 8 },
  permissions: ['geolocation'],
  args: ['--disable-web-security'],
});
let page = context.pages()[0] ?? await context.newPage();
let activeRunId = null;
const browserWrites = new Map();
const browserErrors = [];

async function configurePage(target) {
  target.on('pageerror', error => browserErrors.push({ runId: activeRunId, kind: 'pageerror', message: error.message }));
  target.on('console', message => {
    const text = message.text();
    if (message.type() === 'error' && !text.includes('Failed to load resource') && !text.includes('Mapbox')) {
      browserErrors.push({ runId: activeRunId, kind: 'console', message: text.slice(0, 500) });
    }
  });
  target.on('dialog', dialog => dialog.dismiss());
  await target.route('**/api/**', route => {
    const request = route.request();
    const url = new URL(request.url());
    const record = { method: request.method(), pathname: url.pathname, runId: activeRunId };
    if (activeRunId && request.method() !== 'GET') {
      const list = browserWrites.get(activeRunId) ?? [];
      list.push(record);
      browserWrites.set(activeRunId, list);
    }
    const fulfill = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return fulfill({ user: { id: ownerUserId, name: 'Snap Lab Matrix Owner', email: 'snap-lab@example.invalid' } });
    if (url.pathname === '/api/sessions/unfinished') return fulfill({ session: null });
    if (url.pathname === '/api/routes') return fulfill([]);
    if (url.pathname === '/api/sessions') return fulfill({ sessions: [] });
    if (url.pathname === '/api/memory/points' || url.pathname === '/api/memory/sync') return fulfill({ points: [], presence_witnesses: [] });
    return fulfill({ ok: true, data: [], routes: [], sessions: [], markers: [], count: 0 });
  });
  await target.route('**/matching/v5/**', route => route.abort('blockedbyclient'));
  await target.route('**/directions/v5/**', route => route.abort('blockedbyclient'));
}

async function boot() {
  await configurePage(page);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => {
    const stores = globalThis.__cairnStores;
    return Boolean(stores?.snapLabLogicalRunner && stores?.snapLabActivityStore
      && stores?.useTrackingStore && stores?.useActivitySimulatorStore
      && stores?.useSettingsStore && stores?.useAppStore && stores?.useSessionStore
      && stores?.navigationRef && stores?.getCurrentRoute);
  }, null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(ownerId => {
    localStorage.setItem('cairn_jwt', 'snap-lab-local-browser-authority');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({
      user: { id: ownerId, name: 'Snap Lab Matrix Owner', email: 'snap-lab@example.invalid' },
      isLoggedIn: true,
      hydrated: true,
      sessionExpired: false,
    });
    stores.useSessionStore.setState({ currentUserId: ownerId, sessions: [] });
    stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: true, mapLayer: 'outdoors' });
  }, ownerUserId);
  // Let the auth-gated navigator consume the injected local owner first.
  // Resetting during that render can be overwritten by its Auth -> Home
  // transition, leaving logical replays subscribed to Home's animated map.
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
  await page.evaluate(() => {
    const stores = globalThis.__cairnStores;
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Debug' }] });
  });
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Debug', null, { timeout: 30_000 });
}

await boot();
if (has('--clear-qa-first')) {
  await page.evaluate(ownerId => globalThis.__cairnStores.snapLabActivityStore.clearSnapLabRealmForOwner(ownerId), ownerUserId);
}

const results = [];
for (const [index, entry] of entries.entries()) {
  const fixturePath = path.join(fixturesRoot, entry.relativePath);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const runId = entry.runId;
  activeRunId = runId;
  process.stderr.write(`[matrix ${index + 1}/${entries.length}] ${runId}\n`);
  const activityId = `qa-snap-${phaseName}-${fixture.caseId.toLowerCase()}-${fixture.mode}-${fixture.profile}-${fixture.fixtureSha256.slice(0, 10)}`;
  let run = null;
  let errorEvidence = null;
  try {
    run = await page.evaluate(async ({ fixture: publicInput, options }) => (
      globalThis.__cairnStores.snapLabLogicalRunner.runSnapLabLogicalJourney(publicInput, options)
    ), {
      fixture: publicFixture(fixture),
      options: {
        ownerUserId,
        activityId,
        activityName: `Snap Lab ${fixture.caseId} ${fixture.mode} ${fixture.profile}`,
        matrixSha256: manifest.matrixSha256,
        retainQaRealmForDetailCapture: fixture.profile !== 'primary',
      },
    });
    if (fixture.profile !== 'primary') {
      const runDir = path.join(outputRoot, 'cases', fixture.caseId, fixture.mode, fixture.profile);
      const screenshotDir = path.join(runDir, 'screenshots');
      fs.mkdirSync(screenshotDir, { recursive: true });
      try {
        await page.evaluate(({ id }) => {
          globalThis.__cairnStores.navigationRef.reset({
            index: 2,
            routes: [
              { name: 'Home' },
              { name: 'Routes', params: { initialTab: 'activities' } },
              { name: 'MapHistory', params: { sessionId: id } },
            ],
          });
        }, { id: activityId });
        await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 30_000 });
        await page.getByText(`Snap Lab ${fixture.caseId} ${fixture.mode} ${fixture.profile}`, { exact: true })
          .waitFor({ state: 'visible', timeout: 30_000 });
        await page.getByTestId('qa-snap-lab-activity-label').waitFor({ state: 'visible', timeout: 30_000 });
        await page.screenshot({ path: path.join(screenshotDir, '04-detail.png'), fullPage: false, timeout: 30_000 });
        run.secondaryDetailCapture = { status: 'captured', platform: 'EXPO_WEB_ACTUAL_APP' };
      } catch (error) {
        run.secondaryDetailCapture = {
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        };
      } finally {
        try {
          await page.evaluate(ownerId => globalThis.__cairnStores.snapLabActivityStore.clearSnapLabRealmForOwner(ownerId), ownerUserId);
          run.cleanupStatus = { status: 'cleared', reason: null };
          await page.evaluate(() => {
            globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Debug' }] });
          });
          await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Debug', null, { timeout: 30_000 });
        } catch (error) {
          run.cleanupStatus = { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
        }
      }
    }
  } catch (error) {
    let browserState = null;
    try {
      browserState = await page.evaluate(() => {
        const state = globalThis.__cairnStores?.useTrackingStore?.getState?.();
        return state ? {
          status: state.status,
          isFinishing: state.isFinishing,
          sessionId: state.sessionId,
          startError: state.startError,
          lastStopReason: state.lastStopReason,
          rawPointCount: state.trackPointsRaw.length,
          canonicalPointCount: state.trackPoints.length,
          distanceM: state.distanceM,
          breadcrumbs: (globalThis.__cairnBreadcrumbs ?? []).slice(-24),
        } : null;
      });
    } catch { /* page may have terminated */ }
    errorEvidence = {
      message: error instanceof Error ? error.message : String(error),
      browserState,
      recentBrowserErrors: browserErrors.filter(item => item.runId === runId).slice(-10),
    };
  }
  const result = await writeEvidence(fixture, run, browserWrites.get(runId) ?? [], errorEvidence);
  results.push(result);
  writeJson(runSummaryPath, {
    schema: 'cairn.snaplab.matrix-results.v1',
    phase: phaseName,
    sourceHead,
    matrixSha256: manifest.matrixSha256,
    plannedInInvocation: entries.length,
    executed: results.length,
    pass: results.filter(item => item.status === 'PASS_IN_DECLARED_SCOPE').length,
    fail: results.filter(item => ['USER_BLOCKER', 'DATA_PRIVACY_BLOCKER'].includes(item.status)).length,
    notRun: results.filter(item => item.status === 'NOT_RUN').length,
    results,
  });
  if (!run) {
    // A failed QA recording may remain paused for inspection. Its external
    // evidence is already durable, so reload only the disposable app runtime
    // before proceeding; do not delete prior QA records.
    try { await page.close(); } catch {}
    page = await context.newPage();
    await boot();
  }
}
activeRunId = null;
await context.close();

const summary = JSON.parse(fs.readFileSync(runSummaryPath, 'utf8'));
process.stdout.write(`${JSON.stringify({ outputRoot, runSummaryPath, executed: summary.executed, pass: summary.pass, fail: summary.fail, notRun: summary.notRun }, null, 2)}\n`);
