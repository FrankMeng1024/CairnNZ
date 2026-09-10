import {
  calculateQualityElevationGain,
  createElevationQualityState,
  reduceElevationObservation,
  type ElevationObservation,
} from '../elevationQuality';

function point(index: number, alt: number, verticalAccuracy = 5, segmentId = 'a'): ElevationObservation {
  return {
    lat: -41 + index * 0.00005,
    lng: 174,
    t: index * 5_000,
    alt,
    verticalAccuracy,
    segmentId,
  };
}

describe('independent elevation quality model', () => {
  test('does not turn symmetric flat-walk noise into climbing', () => {
    const altitudes = [10, 13, 8, 12, 7, 11, 9, 13, 8, 10, 12, 9];
    expect(calculateQualityElevationGain(altitudes.map((alt, index) => point(index, alt)))).toBeLessThan(2);
  });

  test('does not repeatedly credit correlated flat-walk altitude waves', () => {
    const wave = [10, 12, 14, 16, 14, 12, 10, 8, 10, 12, 14, 12, 10];
    expect(calculateQualityElevationGain(wave.map((alt, index) => point(index, alt, 5))))
      .toBeLessThan(2);
  });

  test('credits a sustained climb while ignoring poor vertical fixes', () => {
    const points = [10, 11, 13, 16, 19, 22, 25].map((alt, index) => point(index, alt));
    points.splice(3, 0, point(3, 80, 40));
    expect(calculateQualityElevationGain(points)).toBeGreaterThan(8);
    expect(calculateQualityElevationGain(points)).toBeLessThan(22);
  });

  test('resets continuity at a segment boundary without crediting the jump', () => {
    const points = [point(0, 10), point(1, 11), point(2, 10), point(3, 50, 5, 'b')];
    expect(calculateQualityElevationGain(points)).toBe(0);
  });

  test('reports why altitude was excluded', () => {
    const state = createElevationQualityState();
    expect(reduceElevationObservation(state, point(0, 10, 30)).reason).toBe('poor-vertical-accuracy');
    expect(reduceElevationObservation(state, { ...point(0, 10), verticalAccuracy: null }).reason)
      .toBe('missing-vertical-accuracy');
  });
});
