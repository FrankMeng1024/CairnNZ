import type { RawPoint } from '../../../../services/routing/snapTrack';

// De-identified, translated excerpt of the owner's real hike1 evidence. It
// preserves relative metres, cadence, reported hAcc and acceptance ordinals,
// but contains neither the real location nor the real observation epoch.
const ORIGIN_LAT = -41.28;
const ORIGIN_LNG = 174.77;
const METRES_PER_DEGREE = 111_320;
const EPOCH = 1_700_000_000_000;

type RelativeEvidence = readonly [
  rawOrdinal: number,
  elapsedS: number,
  eastM: number,
  northM: number,
  accepted: boolean,
];

export const HIKE1_RELEVANT_RAW_EVIDENCE: RelativeEvidence[] = [
  [100, 0, 0, 0, true],
  [101, 1, 1.2, -0.5, true],
  [102, 2, 2.5, -1, true],
  [103, 3, 3.5, -1.3, true],
  [104, 4, 4.6, -2.2, true],
  [105, 6, 6.3, -3.2, true],
  [106, 7, 7.4, -3.6, true],
  [107, 9, 9.6, -3.7, true],
  [108, 11, 11.1, -4.5, true],
  [109, 13, 12.2, -3.7, true],
  [110, 15, 13.9, -3.1, true],
  [111, 18, 14.6, -3.9, false],
  [112, 23, 15.6, -2.3, false],
  [113, 25, 14.9, -3.5, false],
  [114, 26, 15.3, -5.5, false],
  [115, 27, 15.8, -6.6, true],
  [116, 28, 16.4, -7.5, true],
  [117, 29, 18.2, -6.3, true],
  [118, 30, 19.3, -5.6, true],
  [119, 31, 20.3, -4.1, true],
  [120, 32, 21.9, -3.1, true],
  [121, 33, 22.9, -1.8, true],
  [122, 34, 24.4, -1, true],
  [123, 35, 25, 0.2, true],
  [124, 37, 24.8, 1.6, true],
  [125, 39, 25.8, 3.3, true],
  [126, 41, 27.3, 4.5, true],
  [127, 42, 28.3, 5.1, true],
  [128, 43, 30.9, 5.8, true],
  [129, 45, 31.2, 6.8, true],
];

function pointFromRelative(evidence: RelativeEvidence): RawPoint & { rawOrdinal: number } {
  const [rawOrdinal, elapsedS, eastM, northM] = evidence;
  return {
    lat: ORIGIN_LAT + northM / METRES_PER_DEGREE,
    lng: ORIGIN_LNG + eastM / (
      METRES_PER_DEGREE * Math.cos(ORIGIN_LAT * Math.PI / 180)
    ),
    t: EPOCH + elapsedS * 1_000,
    accuracy: 14.246,
    rawOrdinal,
  };
}

export const HIKE1_SPIKE_CANONICAL: Array<RawPoint & { rawOrdinal: number }> =
  HIKE1_RELEVANT_RAW_EVIDENCE.filter(evidence => evidence[4]).map(pointFromRelative);

export const HIKE1_SCREEN_OFF_CADENCE_S = [1, 4, 6, 4, 1, 9, 9, 21, 19, 3, 4.554, 2, 1, 1, 1.445];

export const HIKE1_SUMMARY = {
  rawCount: 131,
  canonicalCount: 98,
  persistedFinalCount: 27,
  rawCadenceP50S: 1,
  rawCadenceP95S: 4.554,
  rawCadenceMaxS: 21,
  horizontalAccuracyP50M: 14.246,
  horizontalAccuracyP95M: 14.246,
  canonicalScreenOffGapS: 87,
} as const;
