#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { evaluateRouteSafety } from './real-map-snap-safety-lib.mjs';
import { hav, splitPhysicalSegments } from './real-map-snap-evaluation-lib.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const campaignRoot = path.resolve(argument('--campaign'));
const activityRoot = path.resolve(argument('--activities'));
const configPath = path.resolve(argument('--config'));
const osmLedgerPath = path.resolve(argument('--osm-ledger'));
const outputRoot = path.resolve(argument('--output'));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const osmLedger = JSON.parse(fs.readFileSync(osmLedgerPath, 'utf8'));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const nearestPointM = (point, points) => Math.min(...points.map(candidate => hav(point, candidate)));

const cases = config.cases.map(oracle => {
  const activity = JSON.parse(fs.readFileSync(
    path.join(activityRoot, oracle.runId, 'QA_ACTIVITY.json'),
    'utf8',
  ));
  const routeId = activity.context.caseId;
  const feature = JSON.parse(fs.readFileSync(
    path.join(campaignRoot, 'references', `${routeId}.geojson`),
    'utf8',
  ));
  const evaluationOracle = JSON.parse(fs.readFileSync(
    path.join(campaignRoot, 'oracle', `${oracle.runId}.json`),
    'utf8',
  ));
  if (feature.properties.sha256 !== oracle.intendedCorridor.sha256) {
    throw new Error(`reference_identity_mismatch:${oracle.runId}`);
  }
  const reference = feature.geometry.coordinates.map(([lng, lat]) => ({ lng, lat }));
  const safety = evaluateRouteSafety({
    selected: activity.selectedFinal,
    localFinal: activity.localFinal,
    reference,
    context: {
      topologyToleranceM: oracle.intendedCorridor.radiusM,
      topologyCoverageThreshold: 0.95,
      topologyReferenceFractions: evaluationOracle.eligibleFractions.length > 0
        ? evaluationOracle.eligibleFractions
        : [[0, 1]],
      permittedCorridors: [{ line: reference, radiusM: oracle.intendedCorridor.radiusM }],
      competingCorridors: oracle.competingCorridors ?? [],
      obstacles: [
        ...(oracle.buildingPolygons ?? []).map(item => ({ ...item, kind: 'building' })),
        ...(oracle.hardBarriers ?? []).map(item => ({ ...item, kind: 'hard-barrier' })),
      ],
      validPassages: [],
    },
    respectSegmentIds: true,
  });
  const buildingAvailable = Array.isArray(oracle.buildingPolygons);
  const barrierAvailable = Array.isArray(oracle.hardBarriers);
  const competingAvailable = Array.isArray(oracle.competingCorridors);
  const physicalSegments = splitPhysicalSegments(activity.selectedFinal);
  const propertyFindings = [
    safety.movementGap.status,
    safety.orderedReferenceTopology.status,
    competingAvailable ? safety.corridorIdentity.status : null,
    buildingAvailable || barrierAvailable ? safety.obstacleOrBarrier.status : null,
  ].filter(Boolean).filter(status => status === 'FINDING');
  const propertyUnknowns = [
    competingAvailable ? null : oracle.competingCorridorStatus,
    buildingAvailable ? null : oracle.buildingStatus,
    barrierAvailable ? null : oracle.barrierStatus,
  ].filter(Boolean);
  return {
    runId: oracle.runId,
    routeId,
    purpose: oracle.purpose,
    selectedSource: activity.selectedSource,
    acceptedIslandCount: activity.acceptedIslandCount,
    oracleIdentity: {
      intendedCorridorSource: oracle.intendedCorridor.source,
      intendedCorridorSha256: oracle.intendedCorridor.sha256,
      referenceIdentityVerified: true,
      selectedFinalWasNotUsedToConstructOracle: true,
    },
    wrongCorridorOccupation: competingAvailable ? {
      status: safety.corridorIdentity.status,
      competingCorridorSampleCount: safety.corridorIdentity.competingCorridorSampleCount,
      outsideIntendedCorridorSampleCount: safety.corridorIdentity.outsidePermittedSampleCount,
    } : {
      status: 'UNKNOWN',
      reason: oracle.competingCorridorStatus ?? 'NO_INDEPENDENT_COMPETING_CORRIDOR_VECTOR',
      competingCorridorSampleCount: null,
      outsideIntendedCorridorSampleCount: safety.corridorIdentity.outsidePermittedSampleCount,
    },
    unsupportedBuildingCrossings: buildingAvailable ? {
      status: safety.obstacleOrBarrier.status,
      crossingCount: safety.obstacleOrBarrier.crossingCount,
    } : { status: 'UNKNOWN', reason: oracle.buildingStatus ?? 'NOT_APPLICABLE_OR_NOT_AVAILABLE', crossingCount: null },
    unsupportedHardBarrierCrossings: barrierAvailable ? {
      status: safety.obstacleOrBarrier.status,
      crossingCount: safety.obstacleOrBarrier.crossingCount,
    } : { status: 'UNKNOWN', reason: oracle.barrierStatus ?? 'NOT_APPLICABLE_OR_NOT_AVAILABLE', crossingCount: null },
    validPassage: oracle.validPassage ? {
      ...oracle.validPassage,
      selectedNearestM: nearestPointM(oracle.validPassage.waypoint, activity.selectedFinal),
      localNearestM: nearestPointM(oracle.validPassage.waypoint, activity.localFinal),
      status: 'PASSAGE_IDENTITY_SUPPORTED_POLYGON_APERTURE_UNKNOWN',
    } : null,
    gap: {
      ...safety.movementGap,
      expectedPhysicalSegmentCount: oracle.expectedPhysicalSegmentCount ?? null,
      selectedPhysicalSegmentCount: physicalSegments.length,
      physicalSegmentCountMatches: oracle.expectedPhysicalSegmentCount == null
        ? null
        : physicalSegments.length === oracle.expectedPhysicalSegmentCount,
    },
    topology: {
      protectedTopology: oracle.protectedTopology,
      ...safety.orderedReferenceTopology,
    },
    overall: propertyFindings.length > 0 ? 'FAIL' : propertyUnknowns.length > 0 ? 'UNKNOWN' : 'PASS',
    limitations: propertyUnknowns,
  };
});

const report = {
  schema: 'cairn.real-map-snap.targeted-safety-results.v1',
  generatedAt: new Date().toISOString(),
  config: path.relative(process.cwd(), configPath),
  osmSupplement: {
    ledger: path.relative(process.cwd(), osmLedgerPath),
    capturedCount: osmLedger.receipts.filter(item => item.outcome === 'CAPTURED').length,
    unavailableCount: osmLedger.receipts.filter(item => item.outcome === 'UNAVAILABLE').length,
    navigationBudgetImpact: 0,
    estimatedCostUsd: 0,
  },
  cases,
  counts: Object.fromEntries(['PASS', 'FAIL', 'UNKNOWN'].map(value => [
    value,
    cases.filter(item => item.overall === value).length,
  ])),
};
writeJson(path.join(outputRoot, 'TARGETED_SAFETY_ORACLE_RESULTS.json'), report);
process.stdout.write(`${JSON.stringify({ ok: true, counts: report.counts, outputRoot }, null, 2)}\n`);
