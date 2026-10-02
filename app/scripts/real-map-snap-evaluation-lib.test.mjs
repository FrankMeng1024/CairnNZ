import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyEvaluation,
  deviationMetrics,
} from './real-map-snap-evaluation-lib.mjs';

const METRES_PER_DEGREE = 111_320;
const geo = (eastM, northM, segmentId = 'a') => ({
  lng: eastM / METRES_PER_DEGREE,
  lat: northM / METRES_PER_DEGREE,
  segmentId,
});
const reference = [geo(0, 0), geo(120, 0)];
const toleranceM = { mean: 7, p95: 13, max: 24 };
const coverage = {
  eligibleRegions: [{ networkCoverageFraction: 1 }],
};
const oracle = {
  routeId: 'U99',
  expectedClass: 'network-positive',
  toleranceM,
};
const activity = selectedSource => ({
  selectedSource,
  acceptedIslandCount: selectedSource === 'local' ? 0 : 1,
  segmentStats: [{
    requestResults: [{ httpStatus: 200, responseCode: 'Ok' }],
    sectionDecisions: [],
  }],
});
const metric = ({ meanM, p95M, maxM = p95M, heading = 8 }) => ({
  meanM,
  p95M,
  maxM,
  withinMaxToleranceFraction: 1,
  straightHeadingChangeRmsDeg: heading,
  straightHeadingSampleCount: 12,
  eligible: { withinP95ToleranceFraction: 1 },
});

test('an unchanged hybrid is not accepted without useful mean or straight-support heading gain', () => {
  const result = classifyEvaluation(activity('hybrid'), oracle, {
    local: metric({ meanM: 5, p95M: 9 }),
    selected: metric({ meanM: 5, p95M: 9 }),
  }, coverage);
  assert.equal(result.observedOutcome, 'UTILITY_NOT_DEMONSTRATED');
  assert.equal(result.utility.usefulMean, false);
  assert.equal(result.utility.usefulHeading, false);
});

test('p95 deterioration beyond the frozen 0.5 m bound remains a finding despite mean gain', () => {
  const result = classifyEvaluation(activity('hybrid'), oracle, {
    local: metric({ meanM: 5, p95M: 9 }),
    selected: metric({ meanM: 4, p95M: 9.6 }),
  }, coverage);
  assert.equal(result.observedOutcome, 'UTILITY_REGRESSION');
});

test('renaming an otherwise identical local case does not manufacture a map-data root cause', () => {
  const metrics = {
    local: metric({ meanM: 5, p95M: 9 }),
    selected: metric({ meanM: 5, p95M: 9 }),
  };
  const urban = classifyEvaluation(activity('local'), { ...oracle, routeId: 'U99' }, metrics, coverage);
  const mountain = classifyEvaluation(activity('local'), { ...oracle, routeId: 'M99' }, metrics, coverage);
  assert.equal(urban.observedOutcome, 'UTILITY_NOT_DEMONSTRATED');
  assert.equal(mountain.observedOutcome, urban.observedOutcome);
  assert.equal(urban.provenRootCause, 'NOT_PROVEN');
  assert.equal(mountain.provenRootCause, 'NOT_PROVEN');
});

test('multi-segment metrics exclude the untravelled chord', () => {
  const points = [
    geo(0, 0, 'a'), geo(10, 0, 'a'),
    geo(100, 0, 'b'), geo(110, 0, 'b'),
  ];
  const metrics = deviationMetrics(points, reference, toleranceM, [[0, 1]]);
  assert.equal(metrics.physicalSegmentCount, 2);
  assert.ok(Math.abs(metrics.physicalLengthM - 20) < 0.2);
  assert.ok(Math.abs(metrics.excludedGapChordM - 90) < 0.5);
  assert.ok(Math.abs(metrics.unsplitLengthM - 110) < 0.5);
});

test('straight-support heading metric measures like-for-like residual jitter', () => {
  const local = Array.from({ length: 13 }, (_unused, index) => geo(index * 10, index % 2 ? 2 : -2));
  const selected = Array.from({ length: 13 }, (_unused, index) => geo(index * 10, 0));
  const localMetrics = deviationMetrics(local, reference, toleranceM, [[0, 1]]);
  const selectedMetrics = deviationMetrics(selected, reference, toleranceM, [[0, 1]]);
  assert.ok(localMetrics.straightHeadingSampleCount >= 5);
  assert.ok(selectedMetrics.straightHeadingSampleCount >= 5);
  assert.ok(selectedMetrics.straightHeadingChangeRmsDeg < localMetrics.straightHeadingChangeRmsDeg * 0.1);
});
