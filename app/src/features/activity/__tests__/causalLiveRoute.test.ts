import {
  appendCausalLivePoint,
  buildCausalLiveRoute,
  LIVE_MUTABLE_TAIL_MAX_AGE_MS,
  LIVE_MUTABLE_TAIL_MAX_DISTANCE_M,
} from '../causalLiveRoute';
import { haversineM } from '../../../utils/geo';
import type { TrackPoint } from '../../../store/useSessionStore';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

const LAT = -41.28;
const sample = (eastM: number, northM: number, index: number, segmentId = 'a') => ({
  lat: LAT + northM / 111_320,
  lng: 174.77 + eastM / (111_320 * Math.cos(LAT * Math.PI / 180)),
  t: index * 2_000,
  accuracy: 14,
  segmentId,
});
const length = (points: TrackPoint[]) => points.slice(1)
  .reduce((sum, point, index) => sum + haversineM(points[index], point), 0);

describe('causal Live route presentation', () => {
  test('materially calms a straight urban corridor with 1–5 m wobble', () => {
    const canonical = Array.from({ length: 41 }, (_, index) => sample(index * 4, Math.sin(index * 1.7) * 4, index));
    const live = buildCausalLiveRoute(canonical);
    // Freezing the recent tail promptly intentionally retains a few more
    // stable vertices than the former 24+12 point rewrite window. Geometry
    // still sheds at least a third of raw wobble without moving old history.
    expect(live.length).toBeLessThan(canonical.length * 2 / 3);
    expect(length(live) / haversineM(canonical[0], canonical[canonical.length - 1])).toBeLessThan(1.05);
    expect(live.at(-1)).toBe(canonical.at(-1));
  });

  test('removes a small Z but preserves a true 90 degree corner', () => {
    const z = [sample(0, 0, 0), sample(8, 0, 1), sample(12, 4, 2), sample(16, 0, 3), sample(24, 0, 4)];
    expect(buildCausalLiveRoute(z).length).toBeLessThan(z.length);
    const corner = [
      ...Array.from({ length: 6 }, (_, index) => sample(index * 5, 0, index)),
      ...Array.from({ length: 6 }, (_, index) => sample(25, index * 5, index + 6)).slice(1),
    ];
    const live = buildCausalLiveRoute(corner);
    expect(live.some(point => haversineM(point, sample(25, 0, 0)) < 1)).toBe(true);
  });

  test('T03 keeps an uncertain lateral fix responsive, then settles it after the prior trend resumes', () => {
    const canonical = [
      sample(0, 0, 0), sample(0, 5, 1), sample(0, 10, 2),
      sample(8, 15, 3),
      sample(0, 20, 4), sample(0, 25, 5), sample(0, 30, 6), sample(0, 35, 7),
    ];
    const provisional = buildCausalLiveRoute(canonical.slice(0, 4));
    expect(provisional.at(-1)).toBe(canonical[3]);

    const settled = buildCausalLiveRoute(canonical);
    const retainedDrift = settled.find(point => point.t === canonical[3].t);
    expect(retainedDrift == null || haversineM(retainedDrift, canonical[3]) > 2).toBe(true);
    expect(settled.at(-1)).toBe(canonical.at(-1));
  });

  test('T04 suppresses a short uncertainty-sized lateral run but T08 preserves a meaningful detour', () => {
    const shortDrift = [
      sample(0, 0, 0), sample(0, 5, 1), sample(0, 10, 2),
      sample(5, 15, 3), sample(6, 20, 4), sample(5, 25, 5),
      sample(0, 30, 6), sample(0, 35, 7), sample(0, 40, 8),
    ];
    const settled = buildCausalLiveRoute(shortDrift);
    const maximumSettledEastM = Math.max(...settled.map(point => (
      (point.lng - sample(0, 0, 0).lng) * 111_320 * Math.cos(LAT * Math.PI / 180)
    )));
    expect(maximumSettledEastM).toBeLessThan(5);

    const detour = [
      sample(0, 0, 0), sample(0, 6, 1), sample(0, 12, 2),
      sample(14, 18, 3), sample(16, 26, 4), sample(14, 34, 5),
      sample(0, 40, 6), sample(0, 46, 7), sample(0, 52, 8),
    ];
    const preserved = buildCausalLiveRoute(detour);
    const maximumPreservedEastM = Math.max(...preserved.map(point => (
      (point.lng - sample(0, 0, 0).lng) * 111_320 * Math.cos(LAT * Math.PI / 180)
    )));
    expect(maximumPreservedEastM).toBeGreaterThan(9);
  });

  test('T05 confirms a sustained turn from direction and displacement rather than elapsed time', () => {
    const turn = [
      sample(0, 0, 0), sample(0, 5, 1), sample(0, 10, 2), sample(0, 15, 3),
      sample(0, 20, 4), sample(5, 20, 5), sample(10, 20, 6), sample(15, 20, 7),
    ].map((point, index) => ({ ...point, t: index < 5 ? index * 900 : 4_000 + (index - 4) * 3_100 }));
    const live = buildCausalLiveRoute(turn);
    expect(live.some(point => haversineM(point, sample(0, 20, 0)) < 1)).toBe(true);
    expect(live.at(-1)).toMatchObject({ lat: turn.at(-1)!.lat, lng: turn.at(-1)!.lng });
  });

  test('T05 preserves a sparse evidence-sized turn before it leaves the mutable tail', () => {
    const sparseTurn = [
      sample(0, 0, 0), sample(0, 5, 1), sample(0, 10, 2),
      sample(0, 25, 3),
      sample(14.1, 30.13, 4),
      sample(18.8, 31.84, 5), sample(23.5, 33.55, 6), sample(28.2, 35.26, 7),
    ].map((point, index) => ({ ...point, t: index * 1_000 }));
    const live = buildCausalLiveRoute(sparseTurn);
    const preservedCorner = live.find(point => point.t === sparseTurn[3].t);
    expect(preservedCorner).toBeDefined();
    expect(haversineM(preservedCorner!, sparseTurn[3])).toBeLessThan(0.1);
  });

  test('preserves U-turn chronology and never joins a Gap', () => {
    const outbound = Array.from({ length: 8 }, (_, index) => sample(index * 6, 0, index));
    const returning = Array.from({ length: 8 }, (_, index) => sample(42 - index * 6, 1, index + 8)).slice(1);
    const afterGap = [sample(100, 30, 20, 'b'), sample(110, 30, 21, 'b')];
    const live = buildCausalLiveRoute([...outbound, ...returning, ...afterGap]);
    expect(length(live.filter(point => point.segmentId === 'a') as any)).toBeGreaterThan(70);
    expect(live.filter(point => point.segmentId === 'b')).toHaveLength(2);
  });

  test('freezes a supported curved/self-crossing prefix instead of retaining only start and newest', () => {
    const figureEight = Array.from({ length: 73 }, (_unused, index) => {
      const angle = Math.PI * 2 * index / 72;
      return sample(60 * Math.sin(angle), 32 * Math.sin(angle * 2), index);
    });
    const live = buildCausalLiveRoute(figureEight);
    expect(live.length).toBeGreaterThan(12);
    expect(length(live) / length(figureEight)).toBeGreaterThan(0.8);
    expect(live[0].t).toBe(figureEight[0].t);
    expect(live.at(-1)?.t).toBe(figureEight.at(-1)?.t);
  });

  test('is causal: each publication is derived only from the observed prefix', () => {
    const points = Array.from({ length: 20 }, (_, index) => sample(index * 4, Math.sin(index) * 3, index));
    let published: TrackPoint[] = [];
    const history: TrackPoint[] = [];
    points.forEach((point, index) => {
      history.push(point);
      published = appendCausalLivePoint(published, point, history);
      expect(published).toEqual(buildCausalLiveRoute(points.slice(0, index + 1)));
    });
  });

  test.each([255, 256, 257, 513, 1_025])(
    'cold replay preserves the exact incrementally frozen presentation at %i points',
    count => {
      const split = Math.floor(count * 0.62);
      const points = Array.from({ length: count }, (_, index) => {
        const localIndex = index < split ? index : index - split;
        const segmentId = index < split ? 'out-and-back-a' : 'loop-b';
        const phase = localIndex / 11;
        const eastM = index < split
          ? (localIndex % 80 < 40 ? localIndex % 40 : 40 - (localIndex % 40)) * 2.2
          : Math.sin(phase) * 45;
        const northM = index < split
          ? Math.sin(phase * 1.7) * 5
          : Math.sin(phase * 2) * 28;
        return {
          ...sample(eastM, northM, index, segmentId),
          t: index < split ? index * 1_100 : 90_000 + index * 1_100,
          accuracy: 5 + (index % 13),
        };
      });
      let incremental: TrackPoint[] = [];
      const history: TrackPoint[] = [];
      for (const point of points) {
        history.push(point);
        incremental = appendCausalLivePoint(incremental, point, history);
      }
      const recovered = buildCausalLiveRoute(points);
      expect(recovered).toEqual(incremental);
      expect(recovered.map(point => point.t)).toEqual(incremental.map(point => point.t));
      expect(recovered[0]).toBe(points[0]);
      expect(recovered.at(-1)).toBe(points.at(-1));
      expect(new Set(recovered.map(point => point.segmentId)))
        .toEqual(new Set(['out-and-back-a', 'loop-b']));
    },
  );

  test('never revises display geometry outside the bounded recent tail', () => {
    const points = Array.from({ length: 36 }, (_, index) => ({
      ...sample(index * 2, Math.sin(index * 1.9) * 3.5, index),
      // Include a hike1-like background cadence gap. Point-count-only tails
      // previously kept geometry mutable for roughly 100 seconds here.
      t: index < 18 ? index * 1_000 : 100_000 + (index - 18) * 1_000,
    }));
    let published: TrackPoint[] = [];
    const history: TrackPoint[] = [];
    for (const point of points) {
      const before = published;
      history.push(point);
      published = appendCausalLivePoint(published, point, history);
      const retainedTimes = new Set(published.map(candidate => candidate.t));
      const revised = before.filter(candidate => !retainedTimes.has(candidate.t));
      for (const candidate of revised) {
        expect(point.t - candidate.t).toBeLessThanOrEqual(LIVE_MUTABLE_TAIL_MAX_AGE_MS);
        const from = history.findIndex(item => item.t === candidate.t);
        const to = history.length - 1;
        const travelled = from < 0 ? Infinity : length(history.slice(from, to + 1));
        expect(travelled).toBeLessThanOrEqual(LIVE_MUTABLE_TAIL_MAX_DISTANCE_M + 0.01);
      }
    }
  });

  test('replays a 20,000-point recovery history with bounded-tail scaling', () => {
    const elapsed: Record<number, number> = {};
    for (const count of [1_000, 5_000, 20_000]) {
      const history = Array.from({ length: count }, (_, index) => sample(
        index * 1.1,
        Math.sin(index / 31) * 2.5,
        index,
      ));
      const startedAt = performance.now();
      const live = buildCausalLiveRoute(history);
      elapsed[count] = performance.now() - startedAt;
      expect(live[0].t).toBe(history[0].t);
      expect(live.at(-1)?.t).toBe(history.at(-1)?.t);
    }
    // A generous ratio catches the former repeated full-route copy/filter
    // shape without turning normal shared-runner jitter into a false failure.
    expect(elapsed[20_000]).toBeLessThan(Math.max(2_000, elapsed[5_000] * 8));
    process.stderr.write(`causal-live-recovery-profile=${JSON.stringify({
      machine: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
      node: process.version,
      elapsedMs: elapsed,
    })}\n`);
  });
});
