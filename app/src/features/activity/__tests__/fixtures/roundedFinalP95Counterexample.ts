import type { TrackPoint } from '../../../../store/useSessionStore';

const BASE_LAT = -43;
const METRES_PER_DEGREE = 111_320;
const point = (eastM: number, northM: number) => ({
  lat: BASE_LAT + northM / METRES_PER_DEGREE,
  lng: 170 + eastM / (METRES_PER_DEGREE * Math.cos(BASE_LAT * Math.PI / 180)),
});

/**
 * Privacy-safe synthetic regression for the O97 post-round quality defect.
 * The approved road candidate sits just inside the 8 m canonical P95 gate;
 * the display fillet removes its exact corner and pushes the same evidence
 * outside that gate. No coordinate was captured from a real Activity.
 */
export function roundedFinalP95Counterexample(): {
  canonical: TrackPoint[];
  approvedUnrounded: TrackPoint[];
  current: TrackPoint[];
  eligibleCorners: boolean[];
} {
  const approvedUnrounded = [point(0, 0), point(40, 0), point(40, 40)].map((coordinate, index) => ({
    ...coordinate,
    t: 1_000 + index * 50_000,
    segmentId: 'synthetic-road-a',
  }));
  const canonicalMetres: Array<[number, number]> = [
    [0, 0],
    ...Array.from({ length: 12 }, (_unused, index) => [3 + index * 3, 0] as [number, number]),
    ...Array.from({ length: 6 }, (_unused, index) => {
      const angle = (-47.5 + index) * Math.PI / 180;
      return [
        40 + 7.989 * Math.cos(angle),
        7.989 * Math.sin(angle),
      ] as [number, number];
    }),
    [40, 40],
  ];
  const canonical = canonicalMetres.map(([eastM, northM], index) => ({
    ...point(eastM, northM),
    t: 1_000 + Math.round(index * 100_000 / (canonicalMetres.length - 1)),
    accuracy: 6,
    segmentId: 'synthetic-road-a',
  }));
  return {
    canonical,
    approvedUnrounded,
    current: approvedUnrounded.map(sample => ({ ...sample })),
    eligibleCorners: [false, true, false],
  };
}
