/* eslint-disable @typescript-eslint/no-var-requires */
const { verifyRouteDisplayCoverage } = require('../../../../scripts/lib/route-display-coverage-oracle.cjs');

type Coordinate = [number, number];

const origin: Coordinate = [174.7762, -41.2865];
const p = (eastM: number, northM = 0): Coordinate => [
  origin[0] + eastM / (111_320 * Math.cos(origin[1] * Math.PI / 180)),
  origin[1] + northM / 111_132,
];

const expectedLine = (id: string, coordinates: Coordinate[], occurrenceIds: string[]) => ({
  id, coordinates, occurrenceIds,
});
const displayedLine = (id: string, coordinates: Coordinate[], occurrenceIds: string[]) => ({
  id, coordinates, occurrenceIds, role: 'canonical-presentation',
});

const length = (line: Coordinate[]) => line.slice(1).reduce((sum, point, index) => (
  sum + Math.hypot(point[0] - line[index][0], point[1] - line[index][1])
), 0);

/** This is the #9 one-way oracle reduced to its essential mistake. */
function legacyOneWayCoverage(expected: Coordinate[][], displayed: Coordinate[][]): boolean {
  const expectedSegments = expected.flatMap(line => line.slice(1).map((point, index) => [line[index], point] as const));
  const pointSegment = (point: Coordinate, [a, b]: readonly [Coordinate, Coordinate]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy;
    const fraction = denominator === 0 ? 0 : Math.max(0, Math.min(1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / denominator,
    ));
    return Math.hypot(point[0] - (a[0] + dx * fraction), point[1] - (a[1] + dy * fraction));
  };
  const maximumDisplayedDeviation = Math.max(...displayed.flat().map(point => (
    Math.min(...expectedSegments.map(segment => pointSegment(point, segment)))
  )));
  const expectedLength = expected.reduce((sum, line) => sum + length(line), 0);
  const displayedLength = displayed.reduce((sum, line) => sum + length(line), 0);
  return maximumDisplayedDeviation <= 0.001
    && Math.abs(displayedLength / expectedLength - 1) <= 0.01;
}

describe('Route display coverage oracle negative controls', () => {
  const expected = [
    expectedLine('section-ab', [p(0), p(10)], ['ab']),
    expectedLine('section-cd', [p(100), p(110)], ['cd']),
  ];

  test('records the old equal-length A→B duplication false positive', () => {
    const expected: Coordinate[][] = [
      [[0, 0], [10, 0]],
      [[100, 0], [110, 0]],
    ];
    const defective: Coordinate[][] = [
      [[0, 0], [10, 0]],
      [[0, 0], [10, 0]],
    ];

    expect(legacyOneWayCoverage(expected, defective)).toBe(true);
  });

  test('omitting C→D and duplicating equal-length A→B is rejected', () => {
    const result = verifyRouteDisplayCoverage({
      expectedLines: expected,
      displayLines: [
        displayedLine('first-ab', [p(0), p(10)], ['ab']),
        displayedLine('duplicate-ab', [p(0), p(10)], ['ab']),
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(['omitted-interval', 'omitted-occurrence', 'duplicated-occurrence']));
  });

  test('correct ordered rendering passes', () => {
    expect(verifyRouteDisplayCoverage({
      expectedLines: expected,
      displayLines: [
        displayedLine('ab', [p(0), p(10)], ['ab']),
        displayedLine('cd', [p(100), p(110)], ['cd']),
      ],
    }).pass).toBe(true);
  });

  test('changed segment order fails even with identical spatial coverage', () => {
    const result = verifyRouteDisplayCoverage({
      expectedLines: [expectedLine('connected', [p(0), p(10), p(20)], ['first', 'second'])],
      displayLines: [displayedLine('wrong-order', [p(0), p(10), p(20)], ['second', 'first'])],
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toContain('occurrence-order-mismatch');
  });

  test('a true gap silently connected fails', () => {
    const result = verifyRouteDisplayCoverage({
      expectedLines: expected,
      displayLines: [displayedLine('bridged', [p(0), p(10), p(100), p(110)], ['ab', 'cd'])],
    });
    expect(result.pass).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(['noncanonical-or-gap-bridge', 'true-gap-connected']));
  });

  test('a deliberate ordered retrace passes and display-only turn cap is excluded', () => {
    const retrace = [expectedLine('out-back', [p(0), p(60), p(0)], ['out', 'back'])];
    const before = JSON.stringify(retrace);
    const result = verifyRouteDisplayCoverage({
      expectedLines: retrace,
      displayLines: [
        displayedLine('parallel-lanes', [p(0), p(60), p(0)], ['out', 'back']),
        { id: 'turn-cap', coordinates: [p(60), p(60)], occurrenceIds: ['out', 'back'], role: 'display-only' },
      ],
    });
    expect(result.pass).toBe(true);
    expect(JSON.stringify(retrace)).toBe(before);
  });
});
