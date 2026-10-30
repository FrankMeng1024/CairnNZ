import {
  createIncrementalRoutePresentation,
  updateIncrementalRoutePresentation,
} from "../confirmedRoutePresentation";
import { roundSavedFinalRoadCorners } from "../savedFinalCornerRounding";

const METRES_PER_DEGREE = 111_320;

const point = (
  eastM: number,
  northM: number,
  index: number,
  segmentId = "visual-a",
) => ({
  lat: northM / METRES_PER_DEGREE,
  lng: eastM / METRES_PER_DEGREE,
  t: 1_000 + index * 1_000,
  segmentId,
  observationId: `visual-${index}`,
  accuracy: 5,
});

const displayedCoordinates = (points: ReturnType<typeof point>[]) => {
  const state = updateIncrementalRoutePresentation(
    createIncrementalRoutePresentation(),
    points,
  );
  return [
    ...state.staticChunks.flatMap((chunk) => chunk.coordinates),
    ...(state.activeHead?.coordinates ?? []),
  ];
};

const routeLengthM = (coordinates: ReadonlyArray<readonly [number, number]>) =>
  coordinates.slice(1).reduce((total, coordinate, index) => {
    const previous = coordinates[index];
    return (
      total +
      Math.hypot(
        (coordinate[0] - previous[0]) * METRES_PER_DEGREE,
        (coordinate[1] - previous[1]) * METRES_PER_DEGREE,
      )
    );
  }, 0);

describe("generalized adaptive route visual geometry", () => {
  test("Live renders a bounded geometric arc for a supported ordinary corner", () => {
    const source = [point(0, 0, 0), point(20, 0, 1), point(20, 20, 2)];
    const rendered = displayedCoordinates(source);

    expect(rendered.length).toBeGreaterThan(source.length);
    expect(rendered[0]).toEqual([source[0].lng, source[0].lat]);
    expect(rendered.at(-1)).toEqual([source.at(-1)!.lng, source.at(-1)!.lat]);
    expect(routeLengthM(rendered)).toBeGreaterThan(36);
    expect(routeLengthM(rendered)).toBeLessThan(40);
  });

  test("Saved Final applies the same visible bounded treatment to a long-arm corner", () => {
    const source = [point(0, 0, 0), point(20, 0, 1), point(20, 20, 2)];
    const rounded = roundSavedFinalRoadCorners(source);

    expect(rounded.diagnostics.roundedCorners).toBe(1);
    expect(rounded.diagnostics.maximumTangentM).toBeGreaterThan(3.5);
    expect(rounded.diagnostics.maximumTangentM).toBeLessThanOrEqual(6);
    expect(rounded.points[0]).toEqual(source[0]);
    expect(rounded.points.at(-1)).toEqual(source.at(-1));
    expect(
      rounded.points.filter((candidate) => candidate.observationId != null),
    ).toEqual([source[0], source[2]]);
  });

  test("straight movement and a reversal do not acquire invented curves", () => {
    const straight = [point(0, 0, 0), point(10, 0, 1), point(20, 0, 2)];
    const reversal = [point(0, 0, 0), point(10, 0, 1), point(0, 0, 2)];

    expect(displayedCoordinates(straight)).toHaveLength(straight.length);
    expect(displayedCoordinates(reversal)).toHaveLength(reversal.length);
    expect(roundSavedFinalRoadCorners(reversal).points).toEqual(reversal);
  });

  test("segment boundaries remain separate and never receive a cross-gap fillet", () => {
    const source = [
      point(0, 0, 0, "segment-a"),
      point(12, 0, 1, "segment-a"),
      point(12, 12, 2, "segment-b"),
    ];
    const state = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      source,
    );

    expect(state.staticChunks).toHaveLength(1);
    expect(state.staticChunks[0].coordinates).toEqual([
      [source[0].lng, source[0].lat],
      [source[1].lng, source[1].lat],
    ]);
    expect(state.activeHead?.coordinates).toEqual([
      [source[2].lng, source[2].lat],
    ]);
  });

  test("incremental and cold assembly are equal after a legal tail revision", () => {
    const original = [
      point(0, 0, 0),
      point(16, 0, 1),
      point(16, 16, 2),
      point(28, 22, 3),
    ];
    let incremental = createIncrementalRoutePresentation();
    original.forEach((_candidate, index) => {
      incremental = updateIncrementalRoutePresentation(
        incremental,
        original.slice(0, index + 1),
      );
    });
    const revised = original.map((candidate, index) =>
      index === 2 ? { ...candidate, lat: 15.2 / METRES_PER_DEGREE } : candidate,
    );
    incremental = updateIncrementalRoutePresentation(incremental, revised);
    const cold = updateIncrementalRoutePresentation(
      createIncrementalRoutePresentation(),
      revised,
    );

    expect(incremental.staticChunks).toEqual(cold.staticChunks);
    expect(incremental.activeHead?.coordinates).toEqual(
      cold.activeHead?.coordinates,
    );
  });

  test.each([
    ["translated", 0, 37, -23, false],
    ["rotated", Math.PI * 0.63, -18, 41, false],
    ["mirrored", Math.PI * 1.21, 24, 19, true],
  ])(
    "%s movement receives the same geometric policy",
    (_name, rotation, translateX, translateY, mirror) => {
      const transform = ([x, y]: [number, number]) => {
        const reflectedX = mirror ? -x : x;
        return [
          translateX + reflectedX * Math.cos(rotation) - y * Math.sin(rotation),
          translateY + reflectedX * Math.sin(rotation) + y * Math.cos(rotation),
        ] as [number, number];
      };
      const source = (
        [
          [0, 0],
          [20, 0],
          [20, 20],
        ] as [number, number][]
      ).map((coordinate, index) => {
        const [x, y] = transform(coordinate);
        return point(x, y, index);
      });
      const live = displayedCoordinates(source);
      const saved = roundSavedFinalRoadCorners(source);

      expect(live.length).toBeGreaterThan(source.length);
      expect(saved.diagnostics.roundedCorners).toBe(1);
      expect(saved.diagnostics.maximumTangentM).toBeGreaterThan(3.5);
      expect(routeLengthM(live)).toBeGreaterThan(36);
      expect(routeLengthM(live)).toBeLessThan(40);
    },
  );

  test("plausible uncertainty scales treatment without changing eligibility or topology", () => {
    const source = [point(0, 0, 0), point(20, 0, 1), point(20, 20, 2)];
    const precise = roundSavedFinalRoadCorners(
      source.map((candidate) => ({
        ...candidate,
        accuracy: 3,
      })),
    );
    const uncertain = roundSavedFinalRoadCorners(
      source.map((candidate) => ({
        ...candidate,
        accuracy: 22,
      })),
    );

    expect(precise.diagnostics.roundedCorners).toBe(1);
    expect(uncertain.diagnostics.roundedCorners).toBe(1);
    expect(precise.diagnostics.maximumTangentM).toBeGreaterThan(
      uncertain.diagnostics.maximumTangentM,
    );
    expect(uncertain.diagnostics.maximumTangentM).toBeGreaterThan(2.5);
    expect([precise.points[0].lng, precise.points[0].lat]).toEqual([
      uncertain.points[0].lng,
      uncertain.points[0].lat,
    ]);
    expect([precise.points.at(-1)!.lng, precise.points.at(-1)!.lat]).toEqual([
      uncertain.points.at(-1)!.lng,
      uncertain.points.at(-1)!.lat,
    ]);
  });

  test("resampling the same physical corner preserves its semantic shape", () => {
    const coarse = [point(0, 0, 0), point(20, 0, 1), point(20, 20, 2)];
    const dense = [
      point(0, 0, 0),
      point(10, 0, 1),
      point(20, 0, 2),
      point(20, 10, 3),
      point(20, 20, 4),
    ];
    const coarseRendered = displayedCoordinates(coarse);
    const denseRendered = displayedCoordinates(dense);

    expect(coarseRendered.length).toBeGreaterThan(coarse.length);
    expect(denseRendered.length).toBeGreaterThan(dense.length);
    expect(
      Math.abs(routeLengthM(coarseRendered) - routeLengthM(denseRendered)),
    ).toBeLessThan(2);
    expect(coarseRendered.at(-1)).toEqual(denseRendered.at(-1));
  });

  test("a repeated switchback keeps its chronological coverage and reversals", () => {
    const source = [
      point(0, 0, 0),
      point(24, 0, 1),
      point(3, 5, 2),
      point(27, 10, 3),
      point(6, 15, 4),
    ];
    const rendered = displayedCoordinates(source);
    const saved = roundSavedFinalRoadCorners(source);

    expect(rendered).toEqual(
      source.map((candidate) => [candidate.lng, candidate.lat]),
    );
    expect(saved.points).toEqual(source);
    expect(routeLengthM(rendered)).toBeGreaterThan(85);
  });

  test("causal Live skips a fillet beside an earlier non-adjacent traversal", () => {
    const source = [
      point(0, 0, 0),
      point(20, 0, 1),
      point(20, 20, 2),
      point(0, 20, 3),
      point(0, 2, 4),
      point(10, 2, 5),
      point(10, 12, 6),
    ];
    const rendered = displayedCoordinates(source);

    expect(rendered).toContainEqual([source[4].lng, source[4].lat]);
    expect(rendered).toContainEqual([source[5].lng, source[5].lat]);
  });

  test("chunk freezing reuses the exact already displayed settled prefix", () => {
    const source = Array.from({ length: 257 }, (_unused, index) => {
      const pair = Math.floor(index / 2);
      return point((pair + (index % 2)) * 8, pair * 8, index);
    });
    let state = createIncrementalRoutePresentation();
    for (let index = 0; index < 256; index += 1) {
      state = updateIncrementalRoutePresentation(
        state,
        source.slice(0, index + 1),
      );
    }
    const before = [
      ...state.staticChunks.flatMap((chunk) => chunk.coordinates),
      ...(state.activeHead?.coordinates ?? []),
    ];
    state = updateIncrementalRoutePresentation(state, source);
    const frozen = state.staticChunks.at(-1)!.coordinates;

    expect(frozen).toEqual(before.slice(0, frozen.length));
    expect(frozen.at(-1)).toEqual(state.activeHead?.coordinates[0]);
  });
});
