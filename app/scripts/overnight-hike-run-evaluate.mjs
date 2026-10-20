#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const corpusRoot = path.resolve(argument('--corpus'));
const outputPath = path.resolve(argument('--output'));
const resultRoots = String(argument('--results', '')).split(',').filter(Boolean).map(value => path.resolve(value));
const include = argument('--include', 'training');
if (!corpusRoot || !outputPath || resultRoots.length === 0) throw new Error('usage_requires_corpus_results_output');

const manifest = JSON.parse(fs.readFileSync(path.join(corpusRoot, 'FROZEN_CORPUS_MANIFEST.json'), 'utf8'));
const selectedEntries = manifest.entries.filter(entry => (
  include === 'all' || (include === 'holdout' ? entry.holdout : !entry.holdout)
));
const activityByRun = new Map();
for (const root of resultRoots) {
  const activityRoots = ['activities', 'replayed-activities']
    .map(name => path.join(root, name))
    .filter(value => fs.existsSync(value));
  for (const activities of activityRoots) {
    for (const name of fs.readdirSync(activities)) {
      const file = path.join(activities, name, 'QA_ACTIVITY.json');
      if (fs.existsSync(file)) activityByRun.set(name, { root, file, activity: JSON.parse(fs.readFileSync(file, 'utf8')) });
    }
  }
}

const EARTH_M = 6_371_008.8;
const radians = value => value * Math.PI / 180;
function originFor(points) {
  const first = points[0];
  return { lat: first.lat ?? first.coordinate.lat, lng: first.lng ?? first.coordinate.lng };
}
function local(point, origin) {
  const lat = point.lat ?? point.coordinate.lat;
  const lng = point.lng ?? point.coordinate.lng;
  return {
    x: radians(lng - origin.lng) * EARTH_M * Math.cos(radians(origin.lat)),
    y: radians(lat - origin.lat) * EARTH_M,
    t: point.t ?? point.timestampMs ?? null,
    segmentId: point.segmentId ?? 'truth',
  };
}
const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);
function splitSegments(points) {
  const segments = [];
  for (const point of points) {
    const current = segments.at(-1);
    if (!current || current.id !== point.segmentId) segments.push({ id: point.segmentId, points: [point] });
    else current.points.push(point);
  }
  return segments;
}
function lengthM(points) {
  return splitSegments(points).reduce((total, segment) => {
    for (let index = 1; index < segment.points.length; index += 1) total += distance(segment.points[index - 1], segment.points[index]);
    return total;
  }, 0);
}
function resampleSegment(points, spacingM = 3) {
  if (points.length < 2) return points.slice();
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative.at(-1) + distance(points[index - 1], points[index]));
  const total = cumulative.at(-1);
  const sampled = [];
  for (let target = 0; target <= total; target += spacingM) {
    let index = 1;
    while (index < cumulative.length && cumulative[index] < target) index += 1;
    if (index >= cumulative.length) index = cumulative.length - 1;
    const edge = cumulative[index] - cumulative[index - 1];
    const ratio = edge <= 0 ? 0 : (target - cumulative[index - 1]) / edge;
    sampled.push({
      x: points[index - 1].x + (points[index].x - points[index - 1].x) * ratio,
      y: points[index - 1].y + (points[index].y - points[index - 1].y) * ratio,
      t: points[index - 1].t == null || points[index].t == null
        ? null
        : points[index - 1].t + (points[index].t - points[index - 1].t) * ratio,
    });
  }
  if (sampled.length === 0 || distance(sampled.at(-1), points.at(-1)) > 0.05) sampled.push(points.at(-1));
  return sampled;
}
function resample(points, spacingM = 3) {
  return splitSegments(points).flatMap(segment => resampleSegment(segment.points, spacingM));
}
function nearestDistance(point, routeSegments) {
  let best = Infinity;
  for (const route of routeSegments) {
    if (route.length === 1) best = Math.min(best, distance(point, route[0]));
    for (let index = 1; index < route.length; index += 1) {
      const left = route[index - 1];
      const right = route[index];
      const dx = right.x - left.x;
      const dy = right.y - left.y;
      const denominator = dx * dx + dy * dy;
      const ratio = denominator <= 0 ? 0 : Math.max(0, Math.min(1, ((point.x - left.x) * dx + (point.y - left.y) * dy) / denominator));
      best = Math.min(best, distance(point, { x: left.x + ratio * dx, y: left.y + ratio * dy }));
    }
  }
  return Number.isFinite(best) ? best : null;
}
const percentile = (values, fraction) => {
  if (values.length === 0) return null;
  const ordered = values.slice().sort((a, b) => a - b);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
};
function headingRms(points) {
  const sampled = resample(points, 10);
  if (sampled.length < 3) return 0;
  const headings = sampled.slice(1).map((point, index) => Math.atan2(point.y - sampled[index].y, point.x - sampled[index].x));
  const deltas = headings.slice(1).map((heading, index) => {
    let value = (heading - headings[index]) * 180 / Math.PI;
    while (value > 180) value -= 360;
    while (value < -180) value += 360;
    return value;
  });
  return Math.sqrt(deltas.reduce((sum, value) => sum + value * value, 0) / Math.max(1, deltas.length));
}
function interpolateAtTime(points, timestamp) {
  if (points.length === 0 || timestamp == null) return null;
  if (timestamp <= points[0].t) return points[0];
  if (timestamp >= points.at(-1).t) return points.at(-1);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].t <= timestamp) low = middle;
    else high = middle;
  }
  const left = points[low];
  const right = points[high];
  const ratio = right.t === left.t ? 0 : (timestamp - left.t) / (right.t - left.t);
  return {
    x: left.x + (right.x - left.x) * ratio,
    y: left.y + (right.y - left.y) * ratio,
    t: timestamp,
  };
}
function simplify(points, toleranceM = 6) {
  if (points.length <= 2) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop();
    const left = points[start];
    const right = points[end];
    const dx = right.x - left.x;
    const dy = right.y - left.y;
    const denominator = dx * dx + dy * dy;
    let furthest = -1;
    let furthestDistance = -1;
    for (let index = start + 1; index < end; index += 1) {
      const point = points[index];
      const ratio = denominator <= 0 ? 0 : Math.max(0, Math.min(1, (
        (point.x - left.x) * dx + (point.y - left.y) * dy
      ) / denominator));
      const candidate = distance(point, { x: left.x + ratio * dx, y: left.y + ratio * dy });
      if (candidate > furthestDistance) {
        furthest = index;
        furthestDistance = candidate;
      }
    }
    if (furthest > start && furthestDistance > toleranceM) {
      keep[furthest] = true;
      stack.push([start, furthest], [furthest, end]);
    }
  }
  return points.filter((_point, index) => keep[index]);
}
function topologyStats(points) {
  let corners = 0;
  let reversals = 0;
  let maxTurnDeg = 0;
  for (const segment of splitSegments(points)) {
    const structural = simplify(segment.points, 6);
    for (let index = 1; index < structural.length - 1; index += 1) {
      const before = structural[index - 1];
      const point = structural[index];
      const after = structural[index + 1];
      if (distance(before, point) < 10 || distance(point, after) < 10) continue;
      const incoming = { x: point.x - before.x, y: point.y - before.y };
      const outgoing = { x: after.x - point.x, y: after.y - point.y };
      const denominator = Math.hypot(incoming.x, incoming.y) * Math.hypot(outgoing.x, outgoing.y);
      if (denominator <= Number.EPSILON) continue;
      const cosine = Math.max(-1, Math.min(1, (incoming.x * outgoing.x + incoming.y * outgoing.y) / denominator));
      const turn = Math.acos(cosine) * 180 / Math.PI;
      maxTurnDeg = Math.max(maxTurnDeg, turn);
      if (turn >= 55) corners += 1;
      if (turn >= 145) reversals += 1;
    }
  }
  return { corners, reversals, maxTurnDeg };
}
function separatedRevisitPairs(points) {
  const sampled = resample(points, Math.max(3, lengthM(points) / 60));
  if (sampled.length < 8) return 0;
  let pairs = 0;
  const minimumSeparation = Math.max(6, Math.floor(sampled.length / 10));
  for (let left = 0; left < sampled.length; left += 1) {
    for (let right = left + minimumSeparation; right < sampled.length; right += 1) {
      if (distance(sampled[left], sampled[right]) <= 12) pairs += 1;
    }
  }
  return pairs;
}
function channelMetrics(rawPoints, truthPoints, origin, diary, supportObservationTimes) {
  const points = rawPoints.map(point => local(point, origin));
  const truth = truthPoints.map(point => local(point, origin));
  const truthSegments = [truth];
  const outputSegments = splitSegments(points).map(segment => segment.points);
  const samples = resample(points, 3);
  const deviations = samples.map(point => nearestDistance(point, truthSegments)).filter(Number.isFinite);
  const truthSamples = resample(truth, 3);
  const supportedTruthSamples = truthSamples.filter(point => (
    point.t == null
    || supportObservationTimes.some(timestamp => Math.abs(timestamp - point.t) <= 5_000)
  ));
  const uncertaintyM = diary.mode === 'run' ? 18 : 22;
  const covered = truthSamples.filter(point => nearestDistance(point, outputSegments) <= uncertaintyM).length;
  const supportedCovered = supportedTruthSamples
    .filter(point => nearestDistance(point, outputSegments) <= uncertaintyM).length;
  const first = points[0];
  const last = points.at(-1);
  const stopTimes = diary.positions.filter(point => point.phase === 'stopped').map(point => point.timestampMs);
  const stopStart = stopTimes.length > 0 ? Math.min(...stopTimes) : null;
  const stopEnd = stopTimes.length > 0 ? Math.max(...stopTimes) : null;
  const stopped = stopStart == null ? [] : points.filter(point => point.t >= stopStart && point.t <= stopEnd);
  const temporalDeviations = points
    .filter(point => point.t != null)
    .map(point => {
      const truthAtTime = interpolateAtTime(truth, point.t);
      return truthAtTime ? distance(point, truthAtTime) : null;
    })
    .filter(Number.isFinite);
  const truthTopology = topologyStats(truth);
  const outputTopology = topologyStats(points);
  const steps = splitSegments(points).flatMap(segment => segment.points.slice(1).map((point, index) => ({
    distanceM: distance(segment.points[index], point),
    gapS: segment.points[index].t == null || point.t == null
      ? null
      : (point.t - segment.points[index].t) / 1000,
  })));
  const gapBoundarySteps = steps.filter(step => step.gapS != null && step.gapS > 6);
  const stopTruth = stopEnd == null ? null : interpolateAtTime(truth, stopEnd);
  const departure = stopTruth == null ? null : points.find(point => (
    point.t != null && point.t > stopEnd && distance(point, stopTruth) > 5
  ));
  return {
    pointCount: points.length,
    segmentCount: outputSegments.length,
    lengthM: Number(lengthM(points).toFixed(2)),
    distanceErrorPct: Number(((lengthM(points) - diary.distanceM) / diary.distanceM * 100).toFixed(2)),
    crossTrackMeanM: Number((deviations.reduce((sum, value) => sum + value, 0) / Math.max(1, deviations.length)).toFixed(2)),
    crossTrackP50M: Number((percentile(deviations, 0.5) ?? 0).toFixed(2)),
    crossTrackP95M: Number((percentile(deviations, 0.95) ?? 0).toFixed(2)),
    crossTrackMaxM: Number((deviations.length ? Math.max(...deviations) : 0).toFixed(2)),
    timeAlignedP50M: Number((percentile(temporalDeviations, 0.5) ?? 0).toFixed(2)),
    timeAlignedP95M: Number((percentile(temporalDeviations, 0.95) ?? 0).toFixed(2)),
    timeAlignedMaxM: Number((temporalDeviations.length ? Math.max(...temporalDeviations) : 0).toFixed(2)),
    truthCoverageWithinEnvelopePct: Number((covered / Math.max(1, truthSamples.length) * 100).toFixed(2)),
    supportedTruthCoverageWithinEnvelopePct: Number((supportedCovered / Math.max(1, supportedTruthSamples.length) * 100).toFixed(2)),
    supportedTruthFractionPct: Number((supportedTruthSamples.length / Math.max(1, truthSamples.length) * 100).toFixed(2)),
    headingChangeRmsDeg: Number(headingRms(points).toFixed(2)),
    startDisplacementM: first ? Number(distance(first, truth[0]).toFixed(2)) : null,
    endpointDisplacementM: last ? Number(distance(last, truth.at(-1)).toFixed(2)) : null,
    stationaryGrowthM: Number(lengthM(stopped).toFixed(2)),
    departureLagS: stopEnd == null || !departure ? null : Number(((departure.t - stopEnd) / 1000).toFixed(2)),
    topology: {
      truthCorners: truthTopology.corners,
      retainedCorners: outputTopology.corners,
      truthReversals: truthTopology.reversals,
      retainedReversals: outputTopology.reversals,
      truthSeparatedRevisitPairs: separatedRevisitPairs(truth),
      retainedSeparatedRevisitPairs: separatedRevisitPairs(points),
      maxTurnDeg: Number(outputTopology.maxTurnDeg.toFixed(2)),
    },
    maxConsecutiveStepM: Number((steps.length ? Math.max(...steps.map(step => step.distanceM)) : 0).toFixed(2)),
    maxObservedTimeGapS: Number((steps.length ? Math.max(...steps.map(step => step.gapS ?? 0)) : 0).toFixed(2)),
    maxGapBoundaryJumpM: Number((gapBoundarySteps.length ? Math.max(...gapBoundarySteps.map(step => step.distanceM)) : 0).toFixed(2)),
    firstTimestampMs: first?.t ?? null,
    lastTimestampMs: last?.t ?? null,
  };
}

const cases = [];
for (const entry of selectedEntries) {
  const evidence = activityByRun.get(entry.runId);
  if (!evidence) {
    cases.push({ runId: entry.runId, routeId: entry.routeId, holdout: entry.holdout, status: 'NOT_RUN' });
    continue;
  }
  const diary = JSON.parse(fs.readFileSync(path.join(corpusRoot, entry.privateDiaryPath), 'utf8'));
  const publicInput = JSON.parse(fs.readFileSync(path.join(corpusRoot, entry.publicInputPath ?? entry.inputPath), 'utf8'));
  const supportObservationTimes = publicInput.rawEvents
    .map(event => Number(event.observationTimeMs))
    .filter(Number.isFinite);
  const truthPoints = diary.positions;
  const origin = originFor(truthPoints);
  const activity = evidence.activity;
  const channels = Object.fromEntries([
    ['raw', activity.rawPoints],
    ['canonical', activity.canonicalPoints],
    ['live', activity.liveBeforeFinish],
    ['localFinal', activity.localFinal],
    ['selectedFinal', activity.selectedFinal],
  ].map(([name, points]) => [name, channelMetrics(points, truthPoints, origin, diary, supportObservationTimes)]));
  cases.push({
    runId: entry.runId,
    routeId: entry.routeId,
    mode: entry.mode,
    profile: entry.profile,
    category: entry.category,
    region: entry.region,
    holdout: entry.holdout,
    status: 'EVALUATED',
    routeFeasibility: {
      status: 'ACCEPTED_PROVIDER_AND_VISUAL_REVIEW',
      provenance: 'frozen Mapbox walking response + independent Mapbox Outdoors atlas',
      cleanReferenceSha256: entry.referenceSha256,
    },
    evidenceRoot: evidence.root,
    activityId: activity.activityId,
    selectedSource: activity.selectedSource,
    cleanDistanceM: diary.distanceM,
    cleanDurationS: diary.durationS,
    channels,
    persistence: {
      finalRevision: activity.session.finalGeometryRevision,
      finalFingerprint: activity.session.finalGeometryFingerprint,
      coldReopenRecorded: true,
      routeSnapshotCount: activity.routeSnapshots?.length ?? 0,
      qaMemoryPointCount: activity.qaMemoryPointCount,
      transportReceiptCount: activity.transportReceipts?.length ?? 0,
    },
  });
}

function aggregate(channel) {
  const rows = cases.filter(item => item.status === 'EVALUATED').map(item => item.channels[channel]);
  const mean = key => Number((rows.reduce((sum, row) => sum + row[key], 0) / Math.max(1, rows.length)).toFixed(2));
  return {
    caseCount: rows.length,
    crossTrackMeanM: mean('crossTrackMeanM'),
    crossTrackP50MeanM: mean('crossTrackP50M'),
    crossTrackP95MeanM: mean('crossTrackP95M'),
    crossTrackMaxMeanM: mean('crossTrackMaxM'),
    timeAlignedP50MeanM: mean('timeAlignedP50M'),
    timeAlignedP95MeanM: mean('timeAlignedP95M'),
    timeAlignedMaxMeanM: mean('timeAlignedMaxM'),
    truthCoverageWithinEnvelopePct: mean('truthCoverageWithinEnvelopePct'),
    supportedTruthCoverageWithinEnvelopePct: mean('supportedTruthCoverageWithinEnvelopePct'),
    supportedTruthFractionPct: mean('supportedTruthFractionPct'),
    absoluteDistanceErrorMeanPct: Number((rows.reduce((sum, row) => sum + Math.abs(row.distanceErrorPct), 0) / Math.max(1, rows.length)).toFixed(2)),
    stationaryGrowthMeanM: mean('stationaryGrowthM'),
    endpointDisplacementMeanM: mean('endpointDisplacementM'),
    departureLagMeanS: Number((rows.filter(row => row.departureLagS != null)
      .reduce((sum, row) => sum + row.departureLagS, 0) / Math.max(1, rows.filter(row => row.departureLagS != null).length)).toFixed(2)),
    maxGapBoundaryJumpMeanM: mean('maxGapBoundaryJumpM'),
  };
}

const report = {
  schema: 'cairn.hike-run.hidden-truth-evaluation.v2',
  generatedAt: new Date().toISOString(),
  corpusSha256: manifest.corpusSha256,
  include,
  productBoundary: 'Private diaries were opened only by this post-run evaluator. They were never passed to the app or provider transport.',
  routeFeasibilityRequired: true,
  resultRoots,
  aggregate: Object.fromEntries(['raw', 'canonical', 'live', 'localFinal', 'selectedFinal'].map(channel => [channel, aggregate(channel)])),
  cases,
};
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ outputPath, evaluated: cases.filter(item => item.status === 'EVALUATED').length, aggregate: report.aggregate }, null, 2)}\n`);
