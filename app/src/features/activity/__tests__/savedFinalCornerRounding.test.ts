import { roundSavedFinalRoadCorners } from '../savedFinalCornerRounding';

const meters = (x: number, y: number, index: number, segmentId = 'road-a') => ({
  lat: y / 111_320,
  lng: x / 111_320,
  t: 1_000 + index * 1_000,
  segmentId,
});

describe('saved Final road corner rounding', () => {
  test('adds a light sub-metre arc to an accepted right-angle road turn', () => {
    const source = [meters(0, 0, 0), meters(10, 0, 1), meters(10, 10, 2)];
    const result = roundSavedFinalRoadCorners(source);
    expect(result.diagnostics.roundedCorners).toBe(1);
    expect(result.diagnostics.maximumTangentM).toBeCloseTo(1.2, 1);
    expect(result.points.length).toBeGreaterThan(source.length);
    expect(result.points[0]).toEqual(source[0]);
    expect(result.points[result.points.length - 1]).toEqual(source[2]);
    expect(new Set(result.points.map(point => point.segmentId))).toEqual(new Set(['road-a']));
    // The centre sample cuts the mathematical corner only gently. At this
    // scale its distance to either original road arm is about 0.3 m.
    const centre = result.points[Math.floor(result.points.length / 2)];
    const deviationM = Math.min(
      Math.abs(centre.lat) * 111_320,
      Math.abs(centre.lng - source[1].lng) * 111_320,
    );
    expect(deviationM).toBeLessThanOrEqual(0.75);
  });

  test.each([
    ['hairpin', [meters(0, 0, 0), meters(10, 0, 1), meters(0, 0, 2)]],
    ['short arm', [meters(0, 0, 0), meters(3, 0, 1), meters(3, 10, 2)]],
    ['segment boundary', [
      meters(0, 0, 0, 'a'), meters(10, 0, 1, 'a'), meters(10, 10, 2, 'b'),
    ]],
  ])('retains %s geometry verbatim', (_label, source) => {
    const result = roundSavedFinalRoadCorners(source);
    expect(result.diagnostics.roundedCorners).toBe(0);
    expect(result.points).toEqual(source);
  });

  test('does not round a corner beside a non-adjacent crossing edge', () => {
    const source = [
      meters(0, 0, 0),
      meters(10, 0, 1),
      meters(10, 10, 2),
      meters(20, 10, 3),
      meters(10, -10, 4),
      meters(10, 10, 5),
    ];
    const result = roundSavedFinalRoadCorners(source);
    expect(result.diagnostics.skippedTopologyGuard).toBeGreaterThan(0);
    // In particular the first road intersection remains an exact vertex.
    expect(result.points).toContainEqual(source[1]);
  });

  test('does not mutate source GPS objects or invent cross-segment points', () => {
    const source = [
      { ...meters(0, 0, 0), segmentStartReason: 'start' as const },
      meters(10, 0, 1),
      meters(10, 10, 2),
    ];
    const snapshot = JSON.parse(JSON.stringify(source));
    const result = roundSavedFinalRoadCorners(source);
    expect(source).toEqual(snapshot);
    expect(result.points.every(point => point.segmentId === 'road-a')).toBe(true);
    expect(result.points.filter(point => point.segmentStartReason === 'start')).toEqual([
      source[0],
    ]);
  });

  test('R11 rejects a new crossing introduced only by the rounded candidate', () => {
    // Contract fixture is stated in local metres and converted here with the
    // same small-area equirectangular approximation used by the other cases.
    const source = [
      meters(-10, 0, 0),
      meters(0, 0, 1),
      meters(0, 10, 2),
      meters(-0.15, 0.15, 3),
    ];
    const result = roundSavedFinalRoadCorners(source, {
      eligibleCorners: [false, true, false, false],
    });
    expect(result.diagnostics.postRoundRejected).toBe(true);
    expect(result.diagnostics.postRoundRejectReason).toBe('new-non-adjacent-intersection');
    expect(result.points).toEqual(source);
  });

  test('rounds only a corner with explicit local high-confidence road provenance', () => {
    const source = [
      meters(0, 0, 0),
      meters(10, 0, 1),
      meters(10, 10, 2),
      meters(20, 10, 3),
    ];
    const result = roundSavedFinalRoadCorners(source, {
      eligibleCorners: [false, true, false, false],
    });
    expect(result.diagnostics.roundedCorners).toBe(1);
    expect(result.diagnostics.skippedProvenanceGuard).toBe(1);
    expect(result.points).toContainEqual(source[2]);
  });

  test('falls back when a short source time span would duplicate rounded timestamps', () => {
    const source = [
      meters(0, 0, 0),
      { ...meters(10, 0, 1), t: 1_001 },
      { ...meters(10, 10, 2), t: 1_002 },
    ].map((point, index) => ({ ...point, t: 1_000 + index }));
    const result = roundSavedFinalRoadCorners(source, {
      eligibleCorners: [false, true, false],
    });
    expect(result.diagnostics).toMatchObject({
      roundedCorners: 0,
      postRoundRejected: true,
      postRoundRejectReason: 'timestamp-order',
    });
    expect(result.points).toEqual(source);
  });
});
