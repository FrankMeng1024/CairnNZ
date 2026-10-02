#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  classifyEvaluation,
  deviationMetrics,
  lineLength,
  networkCoverageMetrics,
  splitPhysicalSegments,
} from './real-map-snap-evaluation-lib.mjs';

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
const outputRoot = path.resolve(argument(
  '--output',
  path.join(process.env.HOME, 'Desktop/Cairn_O71_Targeted_RealMap_Closure/corrected-evaluation'),
));
const previousEvaluationRoot = path.resolve(argument(
  '--previous-evaluation',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/final-evaluation'),
));
const capturedRoot = path.resolve(argument(
  '--captured-root',
  path.join(process.env.HOME, 'Desktop/Cairn_RealMap_Snap_Final_Review/final-cassette-source'),
));

const sha256File = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const referenceFeature = routeId => {
  const file = path.join(campaignRoot, 'references', `${routeId}.geojson`);
  const feature = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    file,
    properties: feature.properties,
    points: feature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
  };
};
const groupCounts = values => Object.fromEntries([...new Set(values)].sort().map(value => [
  value,
  values.filter(item => item === value).length,
]));

function compactGeometryFlow(activity) {
  const captures = [];
  for (const receipt of activity.transportReceipts ?? []) {
    const file = path.join(capturedRoot, 'http-captures', `${receipt.requestFingerprint}.json`);
    if (!fs.existsSync(file)) {
      captures.push({ fingerprint: receipt.requestFingerprint, present: false, endpoint: null });
      continue;
    }
    const capture = JSON.parse(fs.readFileSync(file, 'utf8'));
    const matchings = capture.body?.matchings ?? [];
    const routes = capture.body?.routes ?? [];
    const tracepoints = capture.body?.tracepoints ?? [];
    captures.push({
      fingerprint: receipt.requestFingerprint,
      present: true,
      captureSha256: sha256File(file),
      endpoint: capture.endpoint,
      status: capture.status,
      responseCode: capture.body?.code ?? null,
      matchingCount: matchings.length,
      matchingGeometryCoordinateCounts: matchings.map(item => item.geometry?.coordinates?.length ?? 0),
      matchingConfidences: matchings.map(item => item.confidence ?? null),
      tracepointCount: tracepoints.length,
      supportedTracepointCount: tracepoints.filter(Boolean).length,
      routeCount: routes.length,
      routeGeometryCoordinateCounts: routes.map(item => item.geometry?.coordinates?.length ?? 0),
    });
  }
  const decisions = activity.segmentStats.flatMap(stats => stats.sectionDecisions ?? []);
  const sections = activity.segmentStats.flatMap(stats => stats.sections ?? []);
  const matchingCaptures = captures.filter(item => item.endpoint === 'matching');
  const providerNoMatchingEvidence = matchingCaptures.length > 0
    && matchingCaptures.every(item => item.present && item.matchingCount === 0);
  return {
    capturedReceiptCount: captures.length,
    presentCaptureCount: captures.filter(item => item.present).length,
    captures,
    tracepointCorrespondence: {
      acceptedDecisionCount: decisions.filter(item => item.result === 'accepted').length,
      rejectedDecisionCount: decisions.filter(item => item.result === 'rejected').length,
      rejectionReasonCounts: groupCounts(decisions.filter(item => item.result !== 'accepted').map(item => item.reasonCode)),
    },
    cropOffsetAnchorSeamAssembly: {
      persistedNetworkSectionCount: sections.filter(item => item.networkSource !== 'none').length,
      persistedModes: groupCounts(sections.filter(item => item.networkSource !== 'none').map(item => item.geometryMode)),
      seamAcceptedCount: sections.filter(item => item.seam?.accepted === true).length,
      assemblyAccepted: activity.segmentStats.every(stats => stats.wholeRouteValidation?.accepted === true),
      intermediateCropCoordinatesPersisted: false,
    },
    providerNoMatchingEvidence,
    provenResponseGeometryLoss: false,
    rootCauseConclusion: providerNoMatchingEvidence
      ? 'Provider captures contain no Matching geometry; MAP_DATA_LIMITATION is supported for this request identity.'
      : 'Provider geometry/tracepoints and persisted decisions are traceable, but intermediate crop coordinates are not persisted; RESPONSE_GEOMETRY_LOSS is not proven.',
  };
}

function evaluationSections(activity) {
  const result = [];
  for (let segmentIndex = 0; segmentIndex < activity.segmentStats.length; segmentIndex += 1) {
    const stats = activity.segmentStats[segmentIndex];
    for (const decision of stats.sectionDecisions ?? []) {
      result.push({
        physicalSegmentIndex: segmentIndex,
        sourceStart: decision.sourceStart,
        sourceEnd: decision.sourceEnd,
        state: decision.result === 'accepted'
          ? 'NETWORK_REFINED'
          : decision.result === 'rejected' ? 'LOCAL' : 'NOT_EVALUATED',
        supportingEvidence: {
          requestId: decision.requestId,
          requestKind: decision.requestKind,
          classification: decision.classification,
          providerConfidence: decision.providerConfidence,
          tracepointSupportCount: decision.tracepointSupportCount,
          expectedTracepointCount: decision.expectedTracepointCount,
          candidateSource: decision.candidateSource,
        },
        result: decision.result,
        reasonCode: decision.reasonCode,
      });
    }
    if (segmentIndex < activity.segmentStats.length - 1) {
      result.push({
        physicalSegmentIndex: segmentIndex,
        state: 'MOVEMENT_EVIDENCE_GAP',
        sourceStart: null,
        sourceEnd: null,
        supportingEvidence: null,
        result: 'not-evaluated',
        reasonCode: 'DECLARED_SEGMENT_BOUNDARY',
      });
    }
  }
  return result;
}

function svgPath(points, bounds, width, height) {
  const padding = 40;
  const spanX = Math.max(1e-9, bounds.maxLng - bounds.minLng);
  const spanY = Math.max(1e-9, bounds.maxLat - bounds.minLat);
  const scale = Math.min((width - padding * 2) / spanX, (height - padding * 2) / spanY);
  return points.map((point, index) => {
    const x = padding + (point.lng - bounds.minLng) * scale;
    const y = height - padding - (point.lat - bounds.minLat) * scale;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

async function renderComparison(runId, activity, reference, report) {
  const width = 1000;
  const height = 800;
  const all = [...reference, ...activity.rawPoints, ...activity.localFinal, ...activity.selectedFinal];
  const bounds = {
    minLat: Math.min(...all.map(point => point.lat)), maxLat: Math.max(...all.map(point => point.lat)),
    minLng: Math.min(...all.map(point => point.lng)), maxLng: Math.max(...all.map(point => point.lng)),
  };
  const layers = [
    ['Reference', [reference], '#0f766e', 8, ''],
    ['Raw', splitPhysicalSegments(activity.rawPoints), '#94a3b8', 2, '7 6'],
    ['Local Final', splitPhysicalSegments(activity.localFinal), '#f59e0b', 5, ''],
    ['Selected Final', splitPhysicalSegments(activity.selectedFinal), '#7c3aed', 5, ''],
  ];
  const paths = layers.flatMap(([, segments, color, strokeWidth, dash]) => segments.map(points => (
    `<path d="${svgPath(points, bounds, width, height)}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`
  ))).join('\n');
  const legend = layers.map(([label, , color], index) => (
    `<rect x="55" y="${92 + index * 30}" width="30" height="6" fill="${color}"/><text x="95" y="${100 + index * 30}" font-size="18" fill="#1f2937">${label}</text>`
  )).join('');
  const oldVerdict = report.previousEvaluation?.verdict ?? 'NONE';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#f7f4ea"/>
    ${paths}
    <rect x="35" y="25" width="680" height="230" rx="16" fill="#ffffff" fill-opacity="0.92" stroke="#d8d5ca"/>
    <text x="55" y="52" font-size="20" font-family="sans-serif" font-weight="700" fill="#173f35">${runId}</text>
    <text x="55" y="75" font-size="15" font-family="sans-serif" fill="#374151">old ${oldVerdict} → corrected ${report.observedOutcome}</text>
    ${legend}
    <text x="55" y="238" font-size="14" font-family="monospace" fill="#374151">local μ ${report.metrics.local.meanM.toFixed(1)}m → selected μ ${report.metrics.selected.meanM.toFixed(1)}m · gaps excluded ${report.metrics.selected.excludedGapChordM.toFixed(1)}m</text>
  </svg>`;
  const target = path.join(outputRoot, 'comparisons', `${runId}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(target);
  return target;
}

fs.mkdirSync(outputRoot, { recursive: true });
const reports = [];
for (const runId of fs.readdirSync(activityRoot).sort()) {
  const activityPath = path.join(activityRoot, runId, 'QA_ACTIVITY.json');
  if (!fs.existsSync(activityPath)) continue;
  const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
  const oraclePath = path.join(campaignRoot, 'oracle', `${runId}.json`);
  if (!fs.existsSync(oraclePath)) continue;
  const oracle = JSON.parse(fs.readFileSync(oraclePath, 'utf8'));
  const reference = referenceFeature(oracle.routeId);
  const previousPath = path.join(previousEvaluationRoot, 'reports', `${runId}.json`);
  const previousEvaluation = fs.existsSync(previousPath)
    ? JSON.parse(fs.readFileSync(previousPath, 'utf8'))
    : null;
  const metrics = {
    referenceLengthM: lineLength(reference.points),
    raw: deviationMetrics(activity.rawPoints, reference.points, oracle.toleranceM, oracle.eligibleFractions),
    canonical: deviationMetrics(activity.canonicalPoints, reference.points, oracle.toleranceM, oracle.eligibleFractions),
    local: deviationMetrics(activity.localFinal, reference.points, oracle.toleranceM, oracle.eligibleFractions),
    selected: deviationMetrics(activity.selectedFinal, reference.points, oracle.toleranceM, oracle.eligibleFractions),
  };
  const coverage = networkCoverageMetrics(activity, oracle.eligibleFractions);
  const geometryFlow = compactGeometryFlow(activity);
  const classification = classifyEvaluation(activity, oracle, metrics, coverage, geometryFlow);
  const report = {
    schema: 'cairn.real-map-snap.evaluation.v2',
    runId,
    routeId: oracle.routeId,
    category: reference.properties.category,
    expectedClass: oracle.expectedClass,
    holdout: oracle.holdout,
    selectedSource: activity.selectedSource,
    requests: {
      matching: activity.requestCount,
      directions: activity.directionsRequestCount,
      receipts: activity.transportReceipts.map(receipt => ({
        fingerprint: receipt.requestFingerprint,
        status: receipt.status,
        responseCode: receipt.responseCode ?? null,
        errorCategory: receipt.errorCategory ?? null,
        provenance: receipt.provenance,
      })),
    },
    acceptedIslandCount: activity.acceptedIslandCount,
    metrics,
    coverage,
    toleranceM: oracle.toleranceM,
    eligibleFractions: oracle.eligibleFractions,
    evaluationSections: evaluationSections(activity),
    geometryFlow,
    previousEvaluation: previousEvaluation ? {
      schema: previousEvaluation.schema,
      verdict: previousEvaluation.verdict,
      metrics: previousEvaluation.metrics,
    } : null,
    observedOutcome: classification.observedOutcome,
    provenRootCause: classification.provenRootCause,
    classification,
    safetyEvidence: {
      obstacleOrBarrierCrossing: 'NOT_VERIFIED_WITHOUT_OBSTACLE_GEOMETRY',
      competingCorridorIdentity: 'NOT_VERIFIED_WITHOUT_COMPETING_CORRIDOR_GEOMETRY',
      productionWholeRouteValidation: activity.segmentStats.every(stats => stats.wholeRouteValidation?.accepted === true),
      independentTopology: 'EVALUATED_SEPARATELY_BY_REAL_MAP_SAFETY_CHECKER',
    },
    referenceAuthority: {
      sha256: oracle.referenceSha256,
      sourceType: reference.properties.sourceType,
      referenceConfidence: reference.properties.referenceConfidence,
      surveyedGroundTruth: reference.properties.surveyedGroundTruth,
      sources: reference.properties.sources,
    },
  };
  report.verdict = report.observedOutcome;
  report.comparisonImage = path.relative(outputRoot, await renderComparison(runId, activity, reference.points, report));
  writeJson(path.join(outputRoot, 'reports', `${runId}.json`), report);
  reports.push(report);
}

const summary = {
  schema: 'cairn.real-map-snap.evaluation-summary.v2',
  generatedAt: new Date().toISOString(),
  count: reports.length,
  outcomeCounts: groupCounts(reports.map(report => report.observedOutcome)),
  provenRootCauseCounts: groupCounts(reports.map(report => report.provenRootCause)),
  previousVerdictCounts: groupCounts(reports.map(report => report.previousEvaluation?.verdict ?? 'NONE')),
  changedOutcomeCount: reports.filter(report => report.previousEvaluation?.verdict !== report.observedOutcome).length,
  cases: reports.map(report => ({
    runId: report.runId,
    category: report.category,
    selectedSource: report.selectedSource,
    previousVerdict: report.previousEvaluation?.verdict ?? null,
    observedOutcome: report.observedOutcome,
    provenRootCause: report.provenRootCause,
    meanImprovementPercent: report.classification.utility.meanImprovementFraction == null
      ? null
      : Number((report.classification.utility.meanImprovementFraction * 100).toFixed(1)),
    headingImprovementPercent: report.classification.utility.headingImprovementFraction == null
      ? null
      : Number((report.classification.utility.headingImprovementFraction * 100).toFixed(1)),
    selectedP95M: Number(report.metrics.selected.p95M.toFixed(2)),
    localP95M: Number(report.metrics.local.p95M.toFixed(2)),
    selectedExcludedGapChordM: Number(report.metrics.selected.excludedGapChordM.toFixed(2)),
    matchedSourcePercent: report.coverage.matchedSourceFraction == null
      ? null
      : Number((report.coverage.matchedSourceFraction * 100).toFixed(1)),
    eligibleNetworkCoveragePercent: report.coverage.eligibleNetworkCoverageFraction == null
      ? null
      : Number((report.coverage.eligibleNetworkCoverageFraction * 100).toFixed(1)),
    eligibleCorrectCorridorOccupationPercent: report.classification.corridorOccupation.eligibleFractionWithinP95Tolerance == null
      ? null
      : Number((report.classification.corridorOccupation.eligibleFractionWithinP95Tolerance * 100).toFixed(1)),
  })),
};
writeJson(path.join(outputRoot, 'SUMMARY.json'), summary);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
