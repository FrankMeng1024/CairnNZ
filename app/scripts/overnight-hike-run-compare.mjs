#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const argument = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const workspace = path.resolve(argument('--workspace'));
const output = path.resolve(argument('--output'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const activityPath = (root, runId) => path.join(workspace, root, 'activities', runId, 'QA_ACTIVITY.json');
const normalizePoints = points => points.map(point => ({
  lat: point.lat,
  lng: point.lng,
  t: point.t,
  segmentOrdinal: point.segmentOrdinal ?? null,
}));
const channelReceipt = (activity, channel) => {
  const normalized = normalizePoints(activity[channel]);
  return { pointCount: normalized.length, sha256: sha256(JSON.stringify(normalized)) };
};
const compareActivity = (leftRoot, leftRunId, rightRoot, rightRunId) => {
  const leftPath = activityPath(leftRoot, leftRunId);
  const rightPath = activityPath(rightRoot, rightRunId);
  const left = readJson(leftPath);
  const right = readJson(rightPath);
  const channels = {};
  for (const channel of ['rawPoints', 'canonicalPoints', 'liveBeforeFinish', 'localFinal', 'selectedFinal']) {
    const leftReceipt = channelReceipt(left, channel);
    const rightReceipt = channelReceipt(right, channel);
    channels[channel] = { left: leftReceipt, right: rightReceipt, exact: leftReceipt.sha256 === rightReceipt.sha256 };
  }
  return {
    left: { root: leftRoot, runId: leftRunId, selectedSource: left.selectedSource, evidenceLabel: left.context.evidenceLabel },
    right: { root: rightRoot, runId: rightRunId, selectedSource: right.selectedSource, evidenceLabel: right.context.evidenceLabel },
    channels,
    everyGeometryChannelExact: Object.values(channels).every(channel => channel.exact),
    rightPersistence: {
      finalGeometryRevision: right.session.finalGeometryRevision,
      routeSnapshotCount: right.routeSnapshots?.length ?? 0,
      transportReceiptCount: right.transportReceipts?.length ?? 0,
    },
  };
};

const baselineMetrics = readJson(path.join(workspace, 'baseline-evaluation', 'TRAINING_METRICS.json'));
const candidateMetrics = readJson(path.join(workspace, 'candidate-training-evaluation', 'TRAINING_METRICS.json'));
const baselineCases = new Map(baselineMetrics.cases.map(item => [item.runId, item]));
const training = candidateMetrics.cases.map(candidate => {
  const baseline = baselineCases.get(candidate.runId);
  return {
    runId: candidate.runId,
    routeId: candidate.routeId,
    holdout: false,
    routeFeasibility: candidate.routeFeasibility,
    everyMetricExact: JSON.stringify(baseline.channels) === JSON.stringify(candidate.channels),
    baseline: baseline.channels,
    candidate: candidate.channels,
  };
});

const replayCases = [
  {
    label: 'successful_fresh_process',
    comparison: compareActivity('candidate-training-batch-02', 'SH01-hike-normal', 'fresh-process-replay-success', 'SH01-hike-normal'),
  },
  {
    label: 'degraded_gps_fresh_process_with_plant',
    comparison: compareActivity('candidate-training-batch-02', 'SH02-run-degraded', 'candidate-run-plant-flow-13-final', 'SH02-run-degraded'),
  },
  {
    label: 'offline_reconnect_fresh_process',
    comparison: compareActivity('holdout-offline-reconnect', 'X05-hike-offline-holdout', 'fresh-process-replay-offline', 'X05-hike-offline-holdout'),
  },
];
for (const item of replayCases) {
  const runResults = readJson(path.join(workspace, item.comparison.right.root, 'RUN_RESULTS.json'));
  item.capturedOnly = runResults.capturedOnly;
  item.unexpectedLiveNavigationRequests = runResults.unexpectedLiveNavigationRequests;
  item.runtimeErrors = runResults.runtimeErrors;
  item.result = item.comparison.everyGeometryChannelExact
    && item.capturedOnly
    && item.unexpectedLiveNavigationRequests === 0
    && item.runtimeErrors.length === 0
    ? 'EXACT_REPLAY_PASS'
    : 'REPLAY_MISMATCH';
}

const onlineOfflinePair = compareActivity(
  'holdout-live-online',
  'X05-hike-online-holdout',
  'holdout-offline-reconnect',
  'X05-hike-offline-holdout',
);
const report = {
  schema: 'cairn.hike-run.candidate-comparison.v1',
  generatedAt: new Date().toISOString(),
  geometryNormalization: 'lat/lng/provider timestamp/segment ordinal; excludes generated Activity IDs and owner generations',
  training: {
    aggregateMetricsExact: JSON.stringify(baselineMetrics.aggregate) === JSON.stringify(candidateMetrics.aggregate),
    caseCount: training.length,
    everyCaseMetricExact: training.every(item => item.everyMetricExact),
    cases: training,
  },
  freshProcessReplay: {
    requiredCases: ['successful', 'degraded-gps', 'offline-reconnect'],
    cases: replayCases,
    everyCaseExact: replayCases.every(item => item.result === 'EXACT_REPLAY_PASS'),
  },
  pairedNetworkSchedule: {
    sameFrozenNoisyInput: true,
    onlineOfflinePair,
    everyGeometryChannelExact: onlineOfflinePair.everyGeometryChannelExact,
  },
};
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output,
  trainingAggregateExact: report.training.aggregateMetricsExact,
  trainingCasesExact: report.training.everyCaseMetricExact,
  freshProcessReplayExact: report.freshProcessReplay.everyCaseExact,
  onlineOfflineGeometryExact: report.pairedNetworkSchedule.everyGeometryChannelExact,
}, null, 2)}\n`);
