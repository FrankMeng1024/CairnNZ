import type { CanonicalJournalPoint } from '../../../services/hikeTrackWriter';
import {
  projectAcceptedActivityPoints,
  projectAcceptedActivityPointsFromCheckpoint,
  projectActivityJournal,
  projectActivityJournalCooperatively,
  rebaseActivityJournalProjection,
} from '../activityJournalProjection';
import { buildBaseFinalTrackPoints } from '../activityFinalArtifact';
import { appendCausalLivePoint } from '../causalLiveRoute';
import { createElevationQualityState, reduceElevationObservation } from '../elevationQuality';
import { performance } from 'node:perf_hooks';
import os from 'node:os';

function point(
  index: number,
  segmentId = 'segment-a',
  source: CanonicalJournalPoint['source'] = 'background',
): CanonicalJournalPoint {
  const turn = index < 300 ? index : 600 - index;
  return {
    t: 1_000 + index * 1_000,
    lat: -41 + index / 1_000_000,
    lng: 174 + turn / 1_000_000,
    alt: 5,
    accuracy: 5,
    verticalAccuracy: 5,
    speed: 1,
    speedAccuracy: null,
    course: 20,
    courseAccuracy: null,
    rawOrdinal: index + 1,
    source,
    clientActivityId: 'activity-a',
    ownerGeneration: 'generation-a',
    segmentId,
    ...(index === 0 ? { segmentStartReason: 'start' as const } : {}),
  };
}

describe('durable Activity journal projection', () => {
  test.each(['hiking', 'running'])('%s restores the frozen prefix plus later headless tail', () => {
    const durable = Array.from({ length: 620 }, (_, index) => point(index));
    const staleMountedTail = durable.slice(590, 600);

    const projected = projectActivityJournal(staleMountedTail, durable);

    expect(projected.canonical).toHaveLength(620);
    expect(projected.canonical[0].t).toBe(1_000);
    expect(projected.canonical[619].t).toBe(620_000);
    expect(projected.appendedFromJournal).toBe(610);
    expect(projected.live[0].t).toBe(1_000);
    expect(projected.live[projected.live.length - 1].t).toBe(620_000);
    expect(projected.distanceM).toBeGreaterThan(0);
  });

  test('retains explicit gaps without manufacturing a connector', () => {
    const first = [point(0, 'segment-a'), point(1, 'segment-a')];
    const second = [point(20, 'segment-b'), point(21, 'segment-b')].map((item, index) => ({
      ...item,
      ...(index === 0 ? { segmentStartReason: 'gps-reacquired' as const } : {}),
    }));

    const projected = projectActivityJournal([], [...first, ...second]);

    expect(projected.live.map(item => item.segmentId)).toEqual([
      'segment-a', 'segment-a', 'segment-b', 'segment-b',
    ]);
    expect(projected.distanceM).toBeLessThan(10);
  });

  test('deduplicates an already-mounted point by stable evidence identity', () => {
    const durable = [point(0), point(1), point(2)];
    const projected = projectActivityJournal([durable[0], durable[1]], durable);
    expect(projected.canonical).toHaveLength(3);
    expect(projected.appendedFromJournal).toBe(1);
  });

  test('does not collide equal ordinals from different immutable owner generations', () => {
    const generationA = { ...point(0), rawOrdinal: 7, ownerGeneration: 'generation-a' };
    const generationB = {
      ...point(1),
      rawOrdinal: 7,
      ownerGeneration: 'generation-b',
      segmentId: generationA.segmentId,
      segmentStartReason: 'resume' as const,
    };
    const projected = projectActivityJournal([], [generationA, generationB]);
    expect(projected.canonical).toHaveLength(2);
    expect(projected.canonical.map(item => item.ownerGeneration)).toEqual([
      'generation-a',
      'generation-b',
    ]);
    expect(projectActivityJournal(projected.canonical, [generationA, generationB]).canonical)
      .toHaveLength(2);
  });

  test('rebasing at commit time retains a foreground fix accepted while the WAL read was in flight', () => {
    const journal = Array.from({ length: 96 }, (_, index) => point(index));
    const stateAtReadStart = journal.slice(0, 72);
    const staleProjection = projectActivityJournal(stateAtReadStart, journal);
    const concurrentForegroundFix = point(96, 'segment-a', 'foreground');

    // This is the old failure: committing a projection calculated before the
    // new foreground fix silently drops that fix.
    expect(staleProjection.canonical.at(-1)).toMatchObject({ rawOrdinal: 96 });

    const currentStateAtCommit = [...stateAtReadStart, concurrentForegroundFix];
    const rebasedProjection = projectActivityJournal(currentStateAtCommit, journal);
    expect(rebasedProjection.canonical).toHaveLength(97);
    expect(rebasedProjection.canonical.at(-1)).toMatchObject({ rawOrdinal: 97 });
  });

  test('a WAL replay published while an accepted foreground write is in flight cannot be overwritten by its stale transition', () => {
    const journal = Array.from({ length: 96 }, (_, index) => point(index));
    const stateWhenForegroundAcceptanceStarted = journal.slice(0, 72);
    const acceptedForegroundFix = point(96, 'segment-a', 'foreground');

    const stateAfterReplay = projectActivityJournal(
      stateWhenForegroundAcceptanceStarted,
      journal,
    ).canonical;
    const committed = projectAcceptedActivityPoints(
      stateAfterReplay,
      [acceptedForegroundFix],
    );

    expect(committed.canonical).toHaveLength(97);
    expect(committed.canonical[71]).toMatchObject({ rawOrdinal: 72 });
    expect(committed.canonical[95]).toMatchObject({ rawOrdinal: 96 });
    expect(committed.canonical.at(-1)).toMatchObject({ rawOrdinal: 97 });
  });

  test('foreground takeover restores the incrementally frozen Live prefix before publishing a concurrent fix', () => {
    const journal = Array.from({ length: 620 }, (_, index) => point(
      index,
      index < 410 ? 'segment-a' : 'segment-b',
      index < 410 ? 'foreground' : 'background',
    ));
    let incrementallyPublished: any[] = [];
    const history: any[] = [];
    for (const durablePoint of journal) {
      history.push(durablePoint);
      incrementallyPublished = appendCausalLivePoint(
        incrementallyPublished,
        durablePoint,
        history,
      );
    }

    const takeover = projectActivityJournal(journal.slice(0, 390), journal);
    const presentation = (values: any[]) => values.map(item => ({
      lat: item.lat, lng: item.lng, t: item.t,
      rawOrdinal: item.rawOrdinal, segmentId: item.segmentId,
    }));
    expect(presentation(takeover.live)).toEqual(presentation(incrementallyPublished));

    const concurrentFix = point(620, 'segment-b', 'foreground');
    const expectedAfterFix = appendCausalLivePoint(
      incrementallyPublished,
      concurrentFix,
      [...history, concurrentFix],
    );
    const publishedAfterFix = projectAcceptedActivityPoints(takeover.canonical, [concurrentFix]);
    expect(presentation(publishedAfterFix.live)).toEqual(presentation(expectedAfterFix));
    expect(presentation(publishedAfterFix.live.filter(item => item.t < concurrentFix.t - 15_000)))
      .toEqual(presentation(incrementallyPublished.filter(item => item.t < concurrentFix.t - 15_000)));
  });

  test.each(['hiking', 'running'])('%s keeps a frozen prefix through headless writes, restore, continuation, and Finish', () => {
    const foreground = Array.from({ length: 72 }, (_, index) => point(index, 'segment-a', 'foreground'));
    const headless = Array.from({ length: 24 }, (_, offset) => point(offset + 72, 'segment-a', 'background'));
    const restored = projectActivityJournal(foreground, [...foreground, ...headless]);
    expect(restored.canonical).toHaveLength(96);
    expect(restored.canonical.slice(0, 72)).toEqual(foreground.map(item => expect.objectContaining({
      t: item.t,
      rawOrdinal: item.rawOrdinal,
    })));

    const continued = Array.from({ length: 12 }, (_, offset) => point(offset + 96, 'segment-a', 'foreground'));
    const afterContinuation = projectActivityJournal(
      restored.canonical,
      [...foreground, ...headless, ...continued],
    );
    expect(afterContinuation.canonical).toHaveLength(108);
    expect(afterContinuation.canonical[0]).toMatchObject({ rawOrdinal: 1, t: 1_000 });
    expect(afterContinuation.canonical.at(-1)).toMatchObject({ rawOrdinal: 108, t: 108_000 });
    expect(afterContinuation.live[0]).toMatchObject({ rawOrdinal: 1, t: 1_000 });

    const finish = buildBaseFinalTrackPoints(afterContinuation.canonical);
    expect(finish[0]).toMatchObject({ t: afterContinuation.canonical[0].t });
    expect(finish.at(-1)).toMatchObject({ t: afterContinuation.canonical.at(-1)!.t });
  });

  test('cooperative cold replay preserves exact geometry and a same-version return reuses Live', async () => {
    const journal = Array.from({ length: 1_025 }, (_, index) => point(
      index,
      index < 640 ? 'segment-a' : 'segment-b',
    ));
    const expected = projectActivityJournal([], journal);
    const cold = await projectActivityJournalCooperatively([], journal, {
      maxPointsPerSlice: 32,
    });
    expect(cold).not.toBeNull();
    expect(cold!.projection).toMatchObject({
      canonical: expected.canonical,
      live: expected.live,
      distanceM: expected.distanceM,
      elevationGainM: expected.elevationGainM,
    });
    expect(cold!.metrics).toMatchObject({ fullLiveRebuilds: 1, reusedLiveCheckpoint: false });
    expect(cold!.metrics.yieldCount).toBeGreaterThan(0);

    const mountedPrefix = projectActivityJournal([], journal.slice(0, 640));
    const extended = await projectActivityJournalCooperatively(
      mountedPrefix.canonical,
      journal,
      {
        currentLive: mountedPrefix.live,
        currentDistanceAccumulator: mountedPrefix.distanceAccumulator,
        currentElevationGainM: mountedPrefix.elevationGainM,
        maxPointsPerSlice: 32,
      },
    );
    expect(extended).not.toBeNull();
    expect(extended!.projection.live).toEqual(expected.live);
    expect(extended!.metrics).toMatchObject({
      fullLiveRebuilds: 0,
      reusedLiveCheckpoint: true,
      appendedFromJournal: 385,
    });

    const returned = await projectActivityJournalCooperatively(
      cold!.projection.canonical,
      journal,
      {
        currentLive: cold!.projection.live,
        currentDistanceAccumulator: cold!.projection.distanceAccumulator,
        currentElevationGainM: cold!.projection.elevationGainM,
        maxPointsPerSlice: 32,
      },
    );
    expect(returned).not.toBeNull();
    expect(returned!.projection.live).toEqual(expected.live);
    expect(returned!.metrics).toMatchObject({
      fullLiveRebuilds: 0,
      reusedLiveCheckpoint: true,
      appendedFromJournal: 0,
    });
  });

  test('a long legacy Live checkpoint without reducer provenance is rebuilt from complete WAL', async () => {
    const journal = Array.from({ length: 1_025 }, (_, index) => point(index));
    const expected = projectActivityJournal([], journal);
    const legacyIncompleteLive = [
      ...expected.live.slice(0, 2),
      ...expected.live.slice(-8),
    ].map(({ liveTrendConfirmed: _confirmed, livePresentationSettled: _settled, ...sample }) => (
      sample
    ));

    const recovered = await projectActivityJournalCooperatively(
      expected.canonical,
      journal,
      {
        currentLive: legacyIncompleteLive,
        currentDistanceAccumulator: expected.distanceAccumulator,
        currentElevationGainM: expected.elevationGainM,
        maxPointsPerSlice: 32,
      },
    );

    expect(recovered).not.toBeNull();
    expect(recovered!.projection.live).toEqual(expected.live);
    expect(recovered!.metrics).toMatchObject({
      fullLiveRebuilds: 1,
      reusedLiveCheckpoint: false,
    });
  });

  test('one warm WAL append does not replay full-history metric work', async () => {
    const prefix = Array.from({ length: 1_025 }, (_, index) => point(index));
    const mounted = projectActivityJournal([], prefix);
    const elevationState = prefix.reduce((state, sample) => (
      reduceElevationObservation(state, sample).state
    ), createElevationQualityState());
    let hostYields = 0;
    const extended = await projectActivityJournalCooperatively(
      mounted.canonical,
      [...prefix, point(prefix.length)],
      {
        currentLive: mounted.live,
        currentDistanceAccumulator: mounted.distanceAccumulator,
        currentElevationGainM: mounted.elevationGainM,
        currentElevationState: elevationState,
        maxPointsPerSlice: 16,
        yieldToHost: async () => { hostYields += 1; },
      },
    );

    expect(extended).not.toBeNull();
    expect(extended!.metrics).toMatchObject({
      appendedFromJournal: 1,
      reusedLiveCheckpoint: true,
      fullLiveRebuilds: 0,
      yieldCount: 0,
    });
    expect(hostYields).toBe(0);
    const expected = projectActivityJournal([], [...prefix, point(prefix.length)]);
    expect(extended!.projection).toMatchObject({
      canonical: expected.canonical,
      live: expected.live,
      distanceM: expected.distanceM,
      distanceAccumulator: expected.distanceAccumulator,
      elevationGainM: expected.elevationGainM,
    });
  });

  test.each([1, 512, 513, 514, 1_025, 4_097])(
    'cooperative lifecycle replay for %i canonical WAL rows equals uninterrupted projection',
    async (pointCount) => {
      const segmentLength = Math.max(1, Math.floor(pointCount / 4));
      const generationBoundary = Math.max(1, Math.floor(pointCount / 2));
      const journal = Array.from({ length: pointCount }, (_, index) => {
        const segmentIndex = Math.min(3, Math.floor(index / segmentLength));
        const base = point(
          index,
          `segment-${segmentIndex}`,
          index % 3 === 0 ? 'foreground' : 'background',
        );
        const generationIndex = index < generationBoundary ? index : index - generationBoundary;
        return {
          ...base,
          rawOrdinal: (generationIndex + 1) * 4 + (index % 2),
          ownerGeneration: index < generationBoundary ? 'generation-a' : 'generation-b',
          ...(index === 0
            ? { segmentStartReason: 'start' as const }
            : index % segmentLength === 0
              ? { segmentStartReason: index < generationBoundary
                ? 'gps-reacquired' as const
                : 'resume' as const }
              : { segmentStartReason: undefined }),
        };
      });
      const uninterrupted = projectActivityJournal([], journal);
      let canonical: typeof uninterrupted.canonical = [];
      let live: typeof uninterrupted.live = [];
      let distanceAccumulator: typeof uninterrupted.distanceAccumulator | undefined;
      let elevationGainM = 0;
      const frontiers = pointCount > 1_025
        ? [pointCount]
        : [...new Set([
            Math.max(1, Math.ceil(pointCount / 4)),
            Math.max(1, Math.ceil(pointCount / 2)),
            pointCount,
          ])];
      let finalReplay: Awaited<ReturnType<typeof projectActivityJournalCooperatively>> = null;
      for (const frontier of frontiers) {
        const replay = await projectActivityJournalCooperatively(
          canonical,
          journal.slice(0, frontier),
          {
            currentLive: live,
            currentDistanceAccumulator: distanceAccumulator,
            currentElevationGainM: elevationGainM,
            maxPointsPerSlice: 127,
          },
        );
        expect(replay).not.toBeNull();
        finalReplay = replay;
        canonical = replay!.projection.canonical;
        live = replay!.projection.live;
        distanceAccumulator = replay!.projection.distanceAccumulator;
        elevationGainM = replay!.projection.elevationGainM;
      }

      const coldAfterProcessRecovery = pointCount > 1_025
        ? finalReplay
        : await projectActivityJournalCooperatively([], journal, { maxPointsPerSlice: 127 });
      expect(coldAfterProcessRecovery).not.toBeNull();
      expect(canonical).toEqual(uninterrupted.canonical);
      expect(live).toEqual(uninterrupted.live);
      expect(distanceAccumulator).toEqual(uninterrupted.distanceAccumulator);
      expect(coldAfterProcessRecovery!.projection).toMatchObject({
        canonical: uninterrupted.canonical,
        live: uninterrupted.live,
        distanceAccumulator: uninterrupted.distanceAccumulator,
        distanceM: uninterrupted.distanceM,
        elevationGainM: uninterrupted.elevationGainM,
      });
      expect(buildBaseFinalTrackPoints(canonical)).toEqual(
        buildBaseFinalTrackPoints(uninterrupted.canonical),
      );
    },
    30_000,
  );

  test('a foreground fix arriving during yielded recovery rebases without stale publication or loss', async () => {
    const journal = Array.from({ length: 513 }, (_, index) => point(index));
    const concurrent = point(513, 'segment-a', 'foreground');
    let mounted = journal.slice(0, 200) as any[];
    let injected = false;
    const prepared = await projectActivityJournalCooperatively(mounted, journal, {
      maxPointsPerSlice: 16,
      yieldToHost: async () => {
        if (!injected) {
          injected = true;
          mounted = [...mounted, concurrent];
        }
        await Promise.resolve();
      },
    });
    expect(prepared).not.toBeNull();
    const rebased = rebaseActivityJournalProjection(prepared!.projection, mounted);
    expect(rebased).not.toBeNull();
    const expected = projectActivityJournal(mounted, journal);
    expect(rebased!.canonical).toEqual(expected.canonical);
    expect(rebased!.live).toEqual(expected.live);
    expect(rebased!.canonical.at(-1)).toMatchObject({ rawOrdinal: 514 });
  });

  test('concurrent background recovery and foreground acceptance share one exact elevation frontier', async () => {
    const journal = Array.from({ length: 96 }, (_, index) => ({
      ...point(index),
      alt: index * 1.5,
      verticalAccuracy: 2,
    }));
    const foreground = {
      ...point(journal.length, 'segment-a', 'foreground'),
      alt: journal.length * 1.5,
      verticalAccuracy: 2,
    };
    let mounted = journal.slice(0, 24) as CanonicalJournalPoint[];
    let injected = false;
    const prepared = await projectActivityJournalCooperatively(mounted, journal, {
      maxPointsPerSlice: 8,
      yieldToHost: async () => {
        if (!injected) {
          injected = true;
          mounted = [...mounted, foreground];
        }
        await Promise.resolve();
      },
    });
    expect(prepared).not.toBeNull();

    const rebased = rebaseActivityJournalProjection(prepared!.projection, mounted);
    const expected = projectActivityJournal(mounted, journal);
    expect(rebased).toEqual(expected);
    expect(rebased!.elevationState).toEqual(expected.elevationState);
    expect(rebased!.elevationGainM).toBeGreaterThan(40);

    const checkpointAppend = projectAcceptedActivityPointsFromCheckpoint(
      prepared!.projection.canonical,
      prepared!.projection.live,
      prepared!.projection.distanceAccumulator,
      prepared!.projection.elevationGainM,
      [foreground],
      prepared!.projection.elevationState,
    );
    expect(checkpointAppend.elevationState).toEqual(expected.elevationState);
    expect(checkpointAppend.elevationGainM).toBe(expected.elevationGainM);
  });

  test('legacy warm elevation append retains and advances positive gain without full replay', async () => {
    const legacy = Array.from({ length: 64 }, (_, index) => ({
      ...point(index),
      alt: index,
      verticalAccuracy: null,
    }));
    const mounted = projectActivityJournal([], legacy);
    const extendedJournal = [
      ...legacy,
      { ...point(64), alt: 64, verticalAccuracy: null },
      { ...point(65), alt: 66, verticalAccuracy: null },
    ];
    const projected = await projectActivityJournalCooperatively(
      mounted.canonical,
      extendedJournal,
      {
        currentLive: mounted.live,
        currentDistanceAccumulator: mounted.distanceAccumulator,
        currentElevationGainM: mounted.elevationGainM,
        currentElevationState: mounted.elevationState,
      },
    );
    const expected = projectActivityJournal([], extendedJournal);
    expect(projected).not.toBeNull();
    expect(projected!.projection.elevationGainM).toBe(expected.elevationGainM);
    expect(projected!.projection.elevationState).toEqual(expected.elevationState);
    expect(projected!.metrics).toMatchObject({
      appendedFromJournal: 2,
      reusedLiveCheckpoint: true,
      fullLiveRebuilds: 0,
    });
  });

  test.each(['hiking', 'running'])('%s preserves one Activity through three foreground/background cycles and a yielded-recovery fix', async () => {
    const cycleSize = 48;
    const sources: CanonicalJournalPoint['source'][] = [
      'foreground', 'background', 'foreground',
      'background', 'foreground', 'background', 'foreground',
    ];
    const journal = sources.flatMap((source, cycleIndex) => Array.from(
      { length: cycleSize },
      (_, offset) => point(cycleIndex * cycleSize + offset, 'segment-a', source),
    ));
    const concurrent = point(journal.length, 'segment-a', 'foreground');
    let mounted = journal.slice(0, cycleSize / 2) as CanonicalJournalPoint[];
    let injected = false;

    const prepared = await projectActivityJournalCooperatively(mounted, journal, {
      maxPointsPerSlice: 12,
      yieldToHost: async () => {
        if (!injected) {
          injected = true;
          mounted = [...mounted, concurrent];
        }
        await Promise.resolve();
      },
    });
    expect(prepared).not.toBeNull();
    const rebased = rebaseActivityJournalProjection(prepared!.projection, mounted);
    expect(rebased).not.toBeNull();
    const expected = projectActivityJournal(mounted, journal);
    expect(rebased).toEqual(expected);
    expect(rebased!.canonical).toHaveLength(journal.length + 1);
    expect(journal.every(item => (
      item.clientActivityId === 'activity-a' && item.ownerGeneration === 'generation-a'
    ))).toBe(true);
    expect(rebased!.canonical.every(item => item.segmentId === 'segment-a')).toBe(true);
    expect(rebased!.canonical[0]).toMatchObject({ rawOrdinal: 1 });
    expect(rebased!.canonical.at(-1)).toMatchObject({ rawOrdinal: journal.length + 1 });
    const evidenceIds = rebased!.canonical.map(item => `${item.segmentId}:${item.rawOrdinal}`);
    expect(new Set(evidenceIds).size).toBe(evidenceIds.length);
    const sourceTransitions = journal.slice(1).filter((item, index) => (
      item.source !== journal[index].source
    ));
    expect(sourceTransitions).toHaveLength(6);
    const liveEvidenceIds = rebased!.live.map(item => `${item.segmentId}:${item.rawOrdinal}`);
    expect(new Set(liveEvidenceIds).size).toBe(liveEvidenceIds.length);
    expect(rebased!.live[0]).toMatchObject({ rawOrdinal: 1 });
    expect(rebased!.live.at(-1)).toMatchObject({ rawOrdinal: journal.length + 1 });
    expect(prepared!.metrics.yieldCount).toBeGreaterThan(0);
  });

  test('foreground recovery yields to queued actions under a fixed 1k/5k/20k protocol', async () => {
    // Fixed before execution for this production helper path: one repetition,
    // 16 points/slice, exact geometry, <=120 ms uninterrupted JS work, <=250
    // ms until a queued action runs, and exactly one cold full Live rebuild.
    const protocol = {
      historySizes: [1_000, 5_000, 20_000],
      repetitions: 1,
      maxPointsPerSlice: 16,
      maxSynchronousSliceMs: 120,
      maxQueuedActionDelayMs: 250,
      expectedFullLiveRebuilds: 1,
    } as const;
    const results: Array<Record<string, number>> = [];
    for (const count of protocol.historySizes) {
      const journal = Array.from({ length: count }, (_, index) => point(
        index,
        index < Math.floor(count * 0.62) ? 'segment-a' : 'segment-b',
      ));
      const expected = projectActivityJournal([], journal);
      let queuedActionAt = 0;
      const queuedAt = performance.now();
      const action = new Promise<void>(resolve => setTimeout(() => {
        queuedActionAt = performance.now();
        resolve();
      }, 0));
      const projected = await projectActivityJournalCooperatively([], journal, {
        maxPointsPerSlice: protocol.maxPointsPerSlice,
      });
      await action;
      expect(projected).not.toBeNull();
      expect(projected!.projection.live).toEqual(expected.live);
      const actionDelayMs = queuedActionAt - queuedAt;
      expect(projected!.metrics.maxSynchronousSliceMs)
        .toBeLessThanOrEqual(protocol.maxSynchronousSliceMs);
      expect(actionDelayMs).toBeLessThanOrEqual(protocol.maxQueuedActionDelayMs);
      expect(projected!.metrics.fullLiveRebuilds).toBe(protocol.expectedFullLiveRebuilds);
      results.push({
        count,
        totalMs: projected!.metrics.totalMs,
        maxSynchronousSliceMs: projected!.metrics.maxSynchronousSliceMs,
        queuedActionDelayMs: actionDelayMs,
        yieldCount: projected!.metrics.yieldCount,
        fullLiveRebuilds: projected!.metrics.fullLiveRebuilds,
      });
    }
    process.stderr.write(`activity-live-foreground-profile=${JSON.stringify({
      machine: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
      node: process.version,
      protocol,
      results,
    })}\n`);
  }, 120_000);
});
