#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  deviationMetrics,
  hav,
  lineLength,
  splitPhysicalSegments,
} from './real-map-snap-evaluation-lib.mjs';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const traceRoot = path.resolve(argument('--traces'));
const campaignRoot = path.resolve(argument('--campaign'));
const activityRoot = path.resolve(argument('--activities'));
const outputRoot = path.resolve(argument('--output'));
const runIds = String(argument('--runs')).split(',').filter(Boolean);
const comparisonTolerance = { mean: 1, p95: 2, max: 4 };

const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
};
const round = value => Number.isFinite(value) ? Number(value.toFixed(4)) : null;
const bearing = (left, right) => {
  const y = Math.sin((right.lng - left.lng) * Math.PI / 180)
    * Math.cos(right.lat * Math.PI / 180);
  const x = Math.cos(left.lat * Math.PI / 180) * Math.sin(right.lat * Math.PI / 180)
    - Math.sin(left.lat * Math.PI / 180) * Math.cos(right.lat * Math.PI / 180)
      * Math.cos((right.lng - left.lng) * Math.PI / 180);
  return Math.atan2(y, x) * 180 / Math.PI;
};
const headingDelta = (left, right) => {
  let delta = Math.abs(left - right) % 360;
  if (delta > 180) delta = 360 - delta;
  return delta;
};
const geometryFingerprint = points => crypto.createHash('sha256').update(
  points.map(point => `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`).join('|'),
).digest('hex');

function closestReferenceIndex(point, reference) {
  let best = { index: 0, distanceM: Infinity };
  reference.forEach((candidate, index) => {
    const distanceM = hav(point, candidate);
    if (distanceM < best.distanceM) best = { index, distanceM };
  });
  return best;
}

function referenceInterval(points, reference) {
  const head = closestReferenceIndex(points[0], reference);
  const tail = closestReferenceIndex(points.at(-1), reference);
  const start = Math.min(head.index, tail.index);
  const end = Math.max(head.index, tail.index);
  const sliced = reference.slice(start, end + 1);
  return {
    points: sliced.length >= 2 ? sliced : reference,
    startIndex: start,
    endIndex: end,
    direction: tail.index >= head.index ? 'forward' : 'reverse',
    headDistanceM: head.distanceM,
    tailDistanceM: tail.distanceM,
  };
}

function intervalByEndpoints(points, first, last) {
  let best = { start: 0, end: points.length - 1, score: Infinity };
  for (let start = 0; start < points.length - 1; start += 1) {
    const headM = hav(points[start], first);
    for (let end = start + 1; end < points.length; end += 1) {
      const score = headM + hav(points[end], last);
      if (score < best.score) best = { start, end, score };
    }
  }
  return points.slice(best.start, best.end + 1);
}

function compactMetrics(points, reference, tolerance) {
  const value = deviationMetrics(points, reference, tolerance);
  return {
    sampleCount: value.sampleCount,
    meanDeviationM: round(value.meanM),
    p95DeviationM: round(value.p95M),
    maxDeviationM: round(value.maxM),
    headingChangeErrorRmsDeg: round(value.straightHeadingChangeRmsDeg),
    headingSampleCount: value.straightHeadingSampleCount,
    lengthM: round(value.physicalLengthM),
    physicalSegmentCount: value.physicalSegmentCount,
    excludedGapChordM: round(value.excludedGapChordM),
  };
}

function topologyMetrics(points, reference, protectedTopology) {
  const indices = points.map(point => closestReferenceIndex(point, reference).index);
  const reversals = indices.slice(1).filter((value, index) => value < indices[index] - 2).length;
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  return {
    protectedTopology,
    referenceOrderReversalCount: reversals,
    referenceSpanFraction: round((max - min) / Math.max(1, reference.length - 1)),
    orderedReferencePreserved: reversals === 0,
  };
}

function seamMetrics(points, canonical, sourceStart, sourceEnd) {
  const entryEdgeM = sourceStart > 0 ? hav(canonical[sourceStart - 1], points[0]) : null;
  const exitEdgeM = sourceEnd < canonical.length - 1 ? hav(points.at(-1), canonical[sourceEnd + 1]) : null;
  const entryHeadingDeltaDeg = sourceStart > 0 && points.length >= 2
    ? headingDelta(
      bearing(canonical[sourceStart - 1], canonical[sourceStart]),
      bearing(points[0], points[1]),
    ) : null;
  const exitHeadingDeltaDeg = sourceEnd < canonical.length - 1 && points.length >= 2
    ? headingDelta(
      bearing(points.at(-2), points.at(-1)),
      bearing(canonical[sourceEnd], canonical[sourceEnd + 1]),
    ) : null;
  return {
    entryEdgeM: round(entryEdgeM),
    exitEdgeM: round(exitEdgeM),
    entryHeadingDeltaDeg: round(entryHeadingDeltaDeg),
    exitHeadingDeltaDeg: round(exitHeadingDeltaDeg),
  };
}

function stageReport(stage, context, previous) {
  const independent = compactMetrics(stage.points, context.referenceInterval.points, context.tolerance);
  const canonical = compactMetrics(stage.points, context.canonicalInterval, comparisonTolerance);
  const local = compactMetrics(stage.points, context.localInterval, comparisonTolerance);
  const previousComparison = previous
    ? compactMetrics(stage.points, previous.points, comparisonTolerance)
    : null;
  const referenceLengthM = lineLength(context.referenceInterval.points);
  return {
    stage: stage.stage,
    geometryFingerprint: stage.geometryFingerprint,
    fingerprintVerified: stage.geometryFingerprint === geometryFingerprint(stage.points),
    pointCount: stage.points.length,
    independentReference: {
      ...independent,
      referenceLengthM: round(referenceLengthM),
      lengthRatio: round(independent.lengthM / Math.max(0.001, referenceLengthM)),
    },
    versusCanonical: canonical,
    versusLocalFinal: local,
    versusPreviousStage: previousComparison,
    seam: seamMetrics(stage.points, context.canonical, context.sourceStart, context.sourceEnd),
    topology: topologyMetrics(stage.points, context.referenceInterval.points, context.protectedTopology),
    wrongCorridorOccupation: 'UNKNOWN_NO_INDEPENDENT_COMPETING_CORRIDOR_VECTOR',
    unsupportedBuildingCrossings: 'UNKNOWN_NO_INDEPENDENT_BUILDING_POLYGON',
    unsupportedBarrierCrossings: 'UNKNOWN_NO_INDEPENDENT_HARD_BARRIER_VECTOR',
  };
}

const reports = [];
for (const runId of runIds) {
  const probe = JSON.parse(fs.readFileSync(path.join(traceRoot, 'captured-probes', `${runId}.json`)));
  const activity = JSON.parse(fs.readFileSync(path.join(activityRoot, runId, 'QA_ACTIVITY.json')));
  const oracle = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'oracle', `${runId}.json`)));
  const referenceFeature = JSON.parse(fs.readFileSync(path.join(campaignRoot, 'references', `${oracle.routeId}.geojson`)));
  const reference = referenceFeature.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
  const canonicalSegments = splitPhysicalSegments(activity.canonicalPoints);
  const localSegments = splitPhysicalSegments(probe.localFinal);
  const candidates = [];
  probe.segmentStats.forEach((stats, physicalSegmentIndex) => {
    const canonical = canonicalSegments[physicalSegmentIndex];
    const local = localSegments[physicalSegmentIndex];
    for (const trace of stats.candidateTransformationTraces ?? []) {
      const first = canonical[trace.sourceStart];
      const last = canonical[trace.sourceEnd];
      const canonicalInterval = canonical.slice(trace.sourceStart, trace.sourceEnd + 1);
      const localInterval = intervalByEndpoints(local, first, last);
      const refInterval = referenceInterval(canonicalInterval, reference);
      const context = {
        canonical,
        canonicalInterval,
        localInterval,
        referenceInterval: refInterval,
        sourceStart: trace.sourceStart,
        sourceEnd: trace.sourceEnd,
        tolerance: oracle.toleranceM,
        protectedTopology: oracle.protectedTopology,
      };
      const stages = trace.stages.map((stage, index) => (
        stageReport(stage, context, index > 0 ? trace.stages[index - 1] : null)
      ));
      candidates.push({
        physicalSegmentIndex,
        requestId: trace.requestId,
        sourceStart: trace.sourceStart,
        sourceEnd: trace.sourceEnd,
        source: trace.source,
        mode: trace.mode,
        reason: trace.reason,
        confidence: trace.confidence,
        selectedByIntervalScheduler: trace.selectedByIntervalScheduler,
        retainedByAssemblySafety: trace.retainedByAssemblySafety,
        referenceInterval: {
          startIndex: refInterval.startIndex,
          endIndex: refInterval.endIndex,
          direction: refInterval.direction,
          headDistanceM: round(refInterval.headDistanceM),
          tailDistanceM: round(refInterval.tailDistanceM),
        },
        baselines: {
          canonical: compactMetrics(canonicalInterval, refInterval.points, oracle.toleranceM),
          localFinal: compactMetrics(localInterval, refInterval.points, oracle.toleranceM),
        },
        stages,
      });
    }
  });
  reports.push({
    schema: 'cairn.real-map-snap.quality-trace.v1',
    runId,
    routeId: oracle.routeId,
    category: referenceFeature.properties.category,
    expectedClass: oracle.expectedClass,
    protectedTopology: oracle.protectedTopology,
    replayOnly: true,
    unexpectedNavigationRequests: 0,
    candidates,
  });
}

writeJson(path.join(outputRoot, 'SIX_FAILURE_STAGE_TRACE.json'), {
  schema: 'cairn.real-map-snap.six-failure-stage-trace.v1',
  generatedAt: new Date().toISOString(),
  methodology: {
    physicalSegmentsComparedIndependently: true,
    genuineGapChordsInterpolated: false,
    referenceIntervalMethod: 'nearest frozen-reference endpoints around each canonical source interval',
    providerResponseStageCaveat: 'full response geometry is retained for provenance; candidate utility begins at source-correspondence-crop',
    unavailableIndependentVectorsRemainUnknown: true,
  },
  cases: reports,
});

const rows = reports.flatMap(report => report.candidates.flatMap(candidate => candidate.stages.map(stage => (
  `| ${report.runId} | ${candidate.physicalSegmentIndex} | ${candidate.sourceStart}–${candidate.sourceEnd} | ${candidate.mode} | ${candidate.retainedByAssemblySafety ? 'yes' : 'no'} | ${stage.stage} | ${stage.independentReference.meanDeviationM ?? 'NA'} | ${stage.independentReference.p95DeviationM ?? 'NA'} | ${stage.independentReference.maxDeviationM ?? 'NA'} | ${stage.independentReference.headingChangeErrorRmsDeg ?? 'NA'} | ${stage.independentReference.lengthRatio ?? 'NA'} | ${stage.seam.entryHeadingDeltaDeg ?? 'NA'} | ${stage.seam.exitHeadingDeltaDeg ?? 'NA'} |`
))));
writeText(path.join(outputRoot, 'SIX_FAILURE_STAGE_TRACE.md'), `# Six-failure stage trace\n\nCaptured-response replay only; navigation requests issued: **0**. Metrics use frozen independent route references. Physical segments remain separate and no evaluation chord crosses an Activity gap. Full provider-response rows are provenance context; candidate utility begins with the source-correspondence crop. Missing competing-corridor/building/barrier vectors remain UNKNOWN.\n\n| Case | Segment | Source range | Mode | Final retained | Stage | Mean m | P95 m | Max m | Heading RMS ° | Length ratio | Entry Δ° | Exit Δ° |\n|---|---:|---:|---|---|---|---:|---:|---:|---:|---:|---:|---:|\n${rows.join('\n')}\n`);

process.stdout.write(`${JSON.stringify({ ok: true, cases: reports.length, candidates: reports.reduce((sum, report) => sum + report.candidates.length, 0), outputRoot }, null, 2)}\n`);
