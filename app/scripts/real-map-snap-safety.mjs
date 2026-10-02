#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { evaluateRouteSafety } from './real-map-snap-safety-lib.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const campaignRoot = path.resolve(argument(
  '--campaign',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/frozen-campaign'),
));
const activityRoot = path.resolve(argument(
  '--activities',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/actual-app-campaign/activities'),
));
const contextPath = path.resolve(argument(
  '--context',
  path.join(process.cwd(), '../docs/review/real-map-snap/CLOSURE_SAFETY_CONTEXT.json'),
));
const outputRoot = path.resolve(argument(
  '--output',
  path.join(process.env.HOME, 'Desktop/Cairn_O71_Targeted_RealMap_Closure/safety-check'),
));

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const referenceFor = routeId => {
  const feature = JSON.parse(fs.readFileSync(
    path.join(campaignRoot, 'references', `${routeId}.geojson`),
    'utf8',
  ));
  return feature.geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
};
const oracleFor = runId => JSON.parse(fs.readFileSync(
  path.join(campaignRoot, 'oracle', `${runId}.json`),
  'utf8',
));
const nearestPointDistanceM = (point, points) => {
  const toRad = value => value * Math.PI / 180;
  return Math.min(...points.map(candidate => {
    const dLat = toRad(candidate.lat - point.lat);
    const dLng = toRad(candidate.lng - point.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(point.lat)) * Math.cos(toRad(candidate.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
  }));
};
const outcome = result => {
  if ([result.obstacleOrBarrier, result.movementGap, result.corridorIdentity, result.orderedReferenceTopology]
    .some(item => item.status === 'FINDING')) return 'FINDING';
  if ([result.obstacleOrBarrier, result.corridorIdentity, result.orderedReferenceTopology]
    .some(item => item.status === 'NOT_VERIFIED' || item.status === 'PARTIAL_REFERENCE_PASS')) return 'UNKNOWN';
  return 'PASS';
};

const context = JSON.parse(fs.readFileSync(contextPath, 'utf8'));
const cases = [];
for (const runId of fs.readdirSync(activityRoot).sort()) {
  const activityPath = path.join(activityRoot, runId, 'QA_ACTIVITY.json');
  if (!fs.existsSync(activityPath)) continue;
  const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
  const routeId = activity.context.caseId;
  const reference = referenceFor(routeId);
  const oracle = oracleFor(runId);
  const knownPassages = context.knownPassages.filter(item => item.routeId === routeId).map(item => ({
    ...item,
    selectedNearestM: nearestPointDistanceM(item.waypoint, activity.selectedFinal),
    localNearestM: nearestPointDistanceM(item.waypoint, activity.localFinal),
    status: 'REFERENCE_AUTHORITY_PRESENT_LAYER_GEOMETRY_NOT_VERIFIED',
  }));
  const result = evaluateRouteSafety({
    selected: activity.selectedFinal,
    localFinal: activity.localFinal,
    reference,
    context: {
      topologyToleranceM: 30,
      topologyCoverageThreshold: 0.95,
      topologyReferenceFractions: oracle.eligibleFractions.length > 0
        ? oracle.eligibleFractions
        : [[0, 1]],
      obstacles: [],
      permittedCorridors: [],
      competingCorridors: [],
      validPassages: [],
    },
    respectSegmentIds: true,
  });
  cases.push({
    runId,
    routeId,
    criticalCase: context.criticalCases.includes(runId),
    outcome: outcome(result),
    wholeSelectedVersusIndependentContext: result,
    introducedVersusLocal: {
      status: 'NOT_VERIFIED_WITHOUT_OBSTACLE_OR_COMPETING_CORRIDOR_GEOMETRY',
      note: 'The checker supports introduced-versus-Local classification when vector context exists; no such vectors were frozen for these real cases.',
    },
    knownPassages,
    provenance: {
      reference: `frozen-campaign/references/${routeId}.geojson`,
      atlas: `real-map-atlas/maps/${runId}.jpg`,
      activity: `actual-app-campaign/activities/${runId}/QA_ACTIVITY.json`,
      context: path.relative(process.cwd(), contextPath),
    },
  });
}

const negativeControls = {
  wrongCorridor: evaluateRouteSafety({
    selected: [{ lng: 0, lat: 20 / 111_320 }, { lng: 100 / 111_320, lat: 20 / 111_320 }],
    localFinal: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }],
    reference: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }],
    context: {
      permittedCorridors: [{ line: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }], radiusM: 8 }],
      competingCorridors: [{ line: [{ lng: 0, lat: 20 / 111_320 }, { lng: 100 / 111_320, lat: 20 / 111_320 }], radiusM: 8 }],
    },
  }),
  unsupportedBuildingChord: evaluateRouteSafety({
    selected: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }],
    localFinal: [{ lng: 0, lat: 0 }, { lng: 35 / 111_320, lat: 0 }, { lng: 35 / 111_320, lat: 20 / 111_320 }, { lng: 65 / 111_320, lat: 20 / 111_320 }, { lng: 65 / 111_320, lat: 0 }, { lng: 100 / 111_320, lat: 0 }],
    reference: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }],
    context: { obstacles: [{ id: 'building', polygon: [{ lng: 40 / 111_320, lat: -5 / 111_320 }, { lng: 60 / 111_320, lat: -5 / 111_320 }, { lng: 60 / 111_320, lat: 10 / 111_320 }, { lng: 40 / 111_320, lat: 10 / 111_320 }] }] },
  }),
  trueGapBridge: evaluateRouteSafety({
    selected: [{ lng: 0, lat: 0, segmentId: 'a' }, { lng: 10 / 111_320, lat: 0, segmentId: 'a' }, { lng: 100 / 111_320, lat: 0, segmentId: 'b' }, { lng: 110 / 111_320, lat: 0, segmentId: 'b' }],
    localFinal: [],
    reference: [{ lng: 0, lat: 0 }, { lng: 110 / 111_320, lat: 0 }],
    respectSegmentIds: false,
  }),
  erasedUTurn: evaluateRouteSafety({
    selected: [{ lng: 0, lat: 0 }, { lng: 0, lat: 20 / 111_320 }],
    localFinal: [],
    reference: [{ lng: 0, lat: 0 }, { lng: 100 / 111_320, lat: 0 }, { lng: 100 / 111_320, lat: 20 / 111_320 }, { lng: 0, lat: 20 / 111_320 }],
    context: { topologyToleranceM: 8, topologyCoverageThreshold: 0.95 },
  }),
};
const negativeControlPass = negativeControls.wrongCorridor.corridorIdentity.status === 'FINDING'
  && negativeControls.unsupportedBuildingChord.obstacleOrBarrier.status === 'FINDING'
  && negativeControls.trueGapBridge.movementGap.status === 'FINDING'
  && negativeControls.erasedUTurn.orderedReferenceTopology.status === 'FINDING';

const report = {
  schema: 'cairn.real-map-snap.safety-review.v1',
  contextAuthority: context.authority,
  limitations: context.limitations,
  caseCount: cases.length,
  criticalCaseCount: cases.filter(item => item.criticalCase).length,
  outcomeCounts: Object.fromEntries(['PASS', 'FINDING', 'UNKNOWN'].map(value => [
    value,
    cases.filter(item => item.outcome === value).length,
  ])),
  verifiedGapClearCount: cases.filter(item => item.wholeSelectedVersusIndependentContext.movementGap.status === 'VERIFIED_CLEAR').length,
  obstacleCoverage: 'NOT_VERIFIED',
  competingCorridorIdentityCoverage: 'NOT_VERIFIED',
  universalSafetyClaim: false,
  cases,
};
writeJson(path.join(outputRoot, 'REAL_MAP_SAFETY_REPORT.json'), report);
writeJson(path.join(outputRoot, 'CHECKER_NEGATIVE_CONTROLS.json'), {
  schema: 'cairn.real-map-snap.safety-negative-controls.v1',
  pass: negativeControlPass,
  controls: negativeControls,
});
if (!negativeControlPass) throw new Error('safety_negative_control_failed');
process.stdout.write(`${JSON.stringify({
  caseCount: report.caseCount,
  criticalCaseCount: report.criticalCaseCount,
  outcomeCounts: report.outcomeCounts,
  verifiedGapClearCount: report.verifiedGapClearCount,
  negativeControlPass,
}, null, 2)}\n`);
