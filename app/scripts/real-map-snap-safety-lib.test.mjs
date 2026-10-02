import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRouteSafety } from './real-map-snap-safety-lib.mjs';

const METRES_PER_DEGREE = 111_320;
const geo = (eastM, northM, segmentId = 'a') => ({
  lng: eastM / METRES_PER_DEGREE,
  lat: northM / METRES_PER_DEGREE,
  segmentId,
});

test('negative control detects occupation of a supplied competing corridor', () => {
  const result = evaluateRouteSafety({
    selected: [geo(0, 20), geo(100, 20)],
    localFinal: [geo(0, 0), geo(100, 0)],
    reference: [geo(0, 0), geo(100, 0)],
    context: {
      permittedCorridors: [{ line: [geo(0, 0), geo(100, 0)], radiusM: 8 }],
      competingCorridors: [{ line: [geo(0, 20), geo(100, 20)], radiusM: 8 }],
    },
  });
  assert.equal(result.corridorIdentity.status, 'FINDING');
  assert.ok(result.corridorIdentity.competingCorridorSampleCount > 0);
});

test('negative control detects an unsupported building chord introduced versus Local', () => {
  const around = [geo(0, 0), geo(35, 0), geo(35, 20), geo(65, 20), geo(65, 0), geo(100, 0)];
  const result = evaluateRouteSafety({
    selected: [geo(0, 0), geo(100, 0)],
    localFinal: around,
    reference: around,
    context: {
      obstacles: [{
        id: 'building',
        polygon: [geo(40, -5), geo(60, -5), geo(60, 10), geo(40, 10)],
      }],
    },
  });
  assert.equal(result.obstacleOrBarrier.status, 'FINDING');
  assert.equal(result.obstacleOrBarrier.crossingCount, 1);
  assert.equal(result.obstacleOrBarrier.crossings[0].introducedVersusLocal, true);
});

test('negative control detects a rendered true-gap bridge while the real renderer split is clear', () => {
  const points = [geo(0, 0, 'a'), geo(10, 0, 'a'), geo(100, 0, 'b'), geo(110, 0, 'b')];
  const safe = evaluateRouteSafety({
    selected: points,
    localFinal: points,
    reference: [geo(0, 0), geo(110, 0)],
    respectSegmentIds: true,
  });
  const poisoned = evaluateRouteSafety({
    selected: points,
    localFinal: points,
    reference: [geo(0, 0), geo(110, 0)],
    respectSegmentIds: false,
  });
  assert.equal(safe.movementGap.status, 'VERIFIED_CLEAR');
  assert.equal(poisoned.movementGap.status, 'FINDING');
  assert.equal(poisoned.movementGap.renderedBridgeEdgeCount, 1);
});

test('negative control detects an erased U-turn against the ordered independent reference', () => {
  const reference = [geo(0, 0), geo(100, 0), geo(100, 20), geo(0, 20)];
  const selected = [geo(0, 0), geo(0, 20)];
  const result = evaluateRouteSafety({
    selected,
    localFinal: reference,
    reference,
    context: { topologyToleranceM: 8, topologyCoverageThreshold: 0.95 },
  });
  assert.equal(result.orderedReferenceTopology.status, 'FINDING');
  assert.ok(result.orderedReferenceTopology.referenceCoverageFraction < 0.5);
});
