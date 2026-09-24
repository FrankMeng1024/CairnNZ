import { buildBaseFinalGeometry } from '../../../services/routing/pedestrianFinalRoute';
import {
  HIKE1_RELEVANT_RAW_EVIDENCE,
  HIKE1_SCREEN_OFF_CADENCE_S,
  HIKE1_SPIKE_CANONICAL,
  HIKE1_SUMMARY,
} from './fixtures/hike1Deidentified';

const METRES_PER_DEGREE = 111_320;

describe('de-identified real hike1 regressions', () => {
  test('retains the measured sparse background cadence as source evidence', () => {
    expect(Math.max(...HIKE1_SCREEN_OFF_CADENCE_S)).toBe(21);
    expect(HIKE1_SCREEN_OFF_CADENCE_S.filter(gapS => gapS >= 19)).toHaveLength(2);
    expect(HIKE1_SUMMARY).toMatchObject({
      rawCount: 131,
      canonicalCount: 98,
      persistedFinalCount: 27,
      canonicalScreenOffGapS: 87,
    });
  });

  test('keeps rejected evidence out of canonical input while repairing the accepted short spike', () => {
    const rejectedOrdinals = HIKE1_RELEVANT_RAW_EVIDENCE
      .filter(evidence => !evidence[4])
      .map(evidence => evidence[0]);
    expect(rejectedOrdinals).toEqual([111, 112, 113, 114]);
    expect(HIKE1_SPIKE_CANONICAL.some(point => rejectedOrdinals.includes(point.rawOrdinal))).toBe(false);

    const originLat = HIKE1_SPIKE_CANONICAL[0].lat;
    const beforeNorthM = HIKE1_SPIKE_CANONICAL.map(point => (
      (point.lat - originLat) * METRES_PER_DEGREE
    ));
    const result = buildBaseFinalGeometry(HIKE1_SPIKE_CANONICAL);
    const afterNorthM = result.points.map(point => (
      (point.lat - originLat) * METRES_PER_DEGREE
    ));

    expect(Math.min(...beforeNorthM)).toBeLessThan(-7);
    expect(result.diagnostics.removedTransientSpikeCount).toBeGreaterThanOrEqual(1);
    expect(Math.min(...afterNorthM)).toBeGreaterThan(-5.5);
    // The supported turn after the brief spike remains; repair does not force
    // the whole excerpt back onto its initial corridor.
    expect(Math.max(...afterNorthM)).toBeGreaterThan(6);
    expect(result.points[0]).toMatchObject({
      lat: HIKE1_SPIKE_CANONICAL[0].lat,
      lng: HIKE1_SPIKE_CANONICAL[0].lng,
    });
    expect(result.points.at(-1)).toMatchObject({
      lat: HIKE1_SPIKE_CANONICAL.at(-1)!.lat,
      lng: HIKE1_SPIKE_CANONICAL.at(-1)!.lng,
    });
  });
});
