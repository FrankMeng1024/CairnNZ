import fs from 'node:fs';
import os from 'node:os';
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign(jest.fn(), {
    getState: jest.fn(() => ({ getVisibleCells: () => [] })),
  }),
}));
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import area from '@turf/area';
import buffer from '@turf/buffer';
import difference from '@turf/difference';
import { booleanValid, featureCollection, multiPoint } from '@turf/turf';
import {
  buildFogShape,
  buildMemoryDisplayEvidence,
  buildTiledMemoryDisplayEvidence,
  composeFogShape,
  CORRIDOR_WIDTH_M,
  selectFogEvidencePoints,
} from '../components/FogLayer';

type Point = { lat: number; lng: number; ts: number; cid: string };

function fogged(shape: NonNullable<ReturnType<typeof buildFogShape>>, point: Point): boolean {
  return booleanPointInPolygon({
    type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
  }, shape);
}

function vertices(value: any): number {
  if (!Array.isArray(value)) return 0;
  if (value.length >= 2 && value.every(item => typeof item === 'number')) return 1;
  return value.reduce((total, item) => total + vertices(item), 0);
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

function movementFixture(count = 240): Point[] {
  const origin = { lat: -41.2865, lng: 174.7762 };
  return Array.from({ length: count }, (_, index) => {
    // Straight -> bend -> switchback fixture. The row jump at 160 is a true
    // source gap; individual footprints must not invent its traversal.
    const leg = Math.floor(index / 40);
    const within = index % 40;
    const latOffset = leg < 2 ? leg * 0.00055 : (leg - 1) * 0.00035;
    const direction = leg % 2 === 0 ? 1 : -1;
    const gap = index >= 160 ? 0.006 : 0;
    return {
      cid: `synthetic-${index}`,
      lat: origin.lat + latOffset + gap,
      lng: origin.lng + (direction > 0 ? within : 39 - within) * 0.00012,
      ts: 1_800_000_000_000 + index * 15_000,
    };
  });
}

describe('real-time Memory presentation evidence', () => {
  test('repeat traversal does not widen, brighten, or duplicate presentation input', () => {
    const point = { cid: 'one', lat: -41.3, lng: 174.8, ts: 1 };
    expect(selectFogEvidencePoints([point, { ...point, cid: 'two', ts: 2 }])).toHaveLength(1);
    const once = buildMemoryDisplayEvidence([point]);
    const repeated = buildMemoryDisplayEvidence([point, point, point]);
    expect(once).not.toBeNull();
    expect(repeated).not.toBeNull();
    expect(Math.abs(area(once!) - area(repeated!))).toBeLessThan(0.01);
  });

  test('turns and parallel sections retain their footprints without filling a never-covered interior', () => {
    const ring: Point[] = [];
    let index = 0;
    for (let x = 0; x <= 8; x += 1) ring.push({ cid: `${index}`, lat: 0, lng: x * 0.00012, ts: ++index });
    for (let y = 1; y <= 8; y += 1) ring.push({ cid: `${index}`, lat: y * 0.00012, lng: 8 * 0.00012, ts: ++index });
    for (let x = 7; x >= 0; x -= 1) ring.push({ cid: `${index}`, lat: 8 * 0.00012, lng: x * 0.00012, ts: ++index });
    for (let y = 7; y >= 1; y -= 1) ring.push({ cid: `${index}`, lat: y * 0.00012, lng: 0, ts: ++index });
    const shape = buildFogShape(ring);
    expect(shape).not.toBeNull();
    for (const point of ring) expect(fogged(shape!, point)).toBe(false);
    expect(fogged(shape!, { cid: 'courtyard', lat: 0.00048, lng: 0.00048, ts: 0 })).toBe(true);
  });

  test('tiled production geometry preserves the 30 m bound, disconnected evidence, and an unvisited hole', async () => {
    const origin = { lat: -41.2865, lng: 174.7762 };
    const lngScale = 111_320 * Math.cos(origin.lat * Math.PI / 180);
    const at = (eastM: number, northM: number, index: number): Point => ({
      cid: `tiled-${index}`,
      lat: origin.lat + northM / 111_320,
      lng: origin.lng + eastM / lngScale,
      ts: index + 1,
    });
    const ring: Point[] = [];
    let index = 0;
    for (let x = 0; x <= 120; x += 15) ring.push(at(x, 0, index++));
    for (let y = 15; y <= 120; y += 15) ring.push(at(120, y, index++));
    for (let x = 105; x >= 0; x -= 15) ring.push(at(x, 120, index++));
    for (let y = 105; y >= 15; y -= 15) ring.push(at(0, y, index++));
    ring.push(at(320, 0, index++));

    const built = await buildTiledMemoryDisplayEvidence(ring, () => true);
    expect(built?.evidence).not.toBeNull();
    const fog = composeFogShape(built!.evidence);
    expect(fog).not.toBeNull();
    expect(booleanValid(built!.evidence!)).toBe(true);
    expect(booleanValid(fog!)).toBe(true);
    expect(fogged(fog!, at(60, 60, 99))).toBe(true);
    expect(fogged(fog!, at(220, 0, 100))).toBe(true);
    for (const point of ring) expect(fogged(fog!, point)).toBe(false);

    const one = await buildTiledMemoryDisplayEvidence([at(0, 0, 0)], () => true);
    const oneFog = composeFogShape(one!.evidence);
    expect(fogged(oneFog!, at(29, 0, 1))).toBe(false);
    expect(fogged(oneFog!, at(31, 0, 2))).toBe(true);
  });

  test('incremental production tiles retain every prior supported point and expose no area outside evidence', async () => {
    const points = movementFixture();
    const first = await buildTiledMemoryDisplayEvidence(points.slice(0, 120), () => true);
    expect(first?.evidence).not.toBeNull();
    if (!first?.evidence) throw new Error('Expected the first bounded slice to produce evidence');
    const complete = await buildTiledMemoryDisplayEvidence(points, () => true, first.cache);
    expect(complete?.evidence).not.toBeNull();
    if (!complete?.evidence) throw new Error('Expected the complete bounded build to produce evidence');
    expect(Math.max(...first.sliceDurationsMs, ...complete.sliceDurationsMs)).toBeLessThan(150);
    const fog = composeFogShape(complete.evidence);
    expect(fog).not.toBeNull();
    for (const point of points.filter((_, index) => index % 23 === 0)) {
      expect(fogged(fog!, point)).toBe(false);
    }
    expect(fogged(fog!, {
      cid: 'true-gap', lat: -41.283, lng: 174.778, ts: 0,
    })).toBe(true);

    const envelope = buffer(multiPoint(points.map(point => [point.lng, point.lat])), CORRIDOR_WIDTH_M, {
      // A denser independent envelope avoids treating the chord gaps of a
      // lower-resolution oracle as unsupported real-world area.
      units: 'meters', steps: 64,
    });
    if (!envelope) throw new Error('Expected the accepted-evidence envelope to be available');
    const unsupported = difference(featureCollection([complete.evidence, envelope]));
    expect(unsupported == null ? 0 : area(unsupported)).toBeLessThan(0.01);
  }, 20_000);

  test('exports representative standalone geometry timing with an explicit renderer label', async () => {
    const points = movementFixture(240);
    let evidence = null as Awaited<ReturnType<typeof buildTiledMemoryDisplayEvidence>>;
    let cache = null as NonNullable<Awaited<ReturnType<typeof buildTiledMemoryDisplayEvidence>>>['cache'] | null;
    const durations: number[] = [];
    const synchronousSlices: number[] = [];
    const intermediate: any[] = [];
    // Bulk reconstruction is reported separately from the foreground case.
    // Normal accepted GPS evidence arrives one point at a time; treating a
    // 40-point reconciliation as one live fix overstates live latency.
    for (let offset = 0; offset < points.length - 1; offset += 40) {
      const acceptedCount = Math.min(points.length - 1, offset + 40);
      const started = performance.now();
      evidence = await buildTiledMemoryDisplayEvidence(
        points.slice(0, acceptedCount),
        () => true,
        cache,
      );
      if (!evidence?.evidence) throw new Error('Expected production tiled evidence');
      cache = evidence.cache;
      synchronousSlices.push(...evidence.sliceDurationsMs);
      const fog = composeFogShape(evidence.evidence);
      durations.push(performance.now() - started);
      intermediate.push({
        acceptedEvidenceCount: acceptedCount,
        updateDurationMs: durations[durations.length - 1],
        rebuiltTileCount: evidence.rebuiltTileCount,
        rebuiltGroupCount: evidence.rebuiltGroupCount,
        maxSynchronousSliceMs: Math.max(...evidence.sliceDurationsMs),
        renderedGeometry: fog ? {
          type: fog.geometry.type,
          vertices: vertices(fog.geometry.coordinates),
        } : null,
      });
    }
    const liveAppendStarted = performance.now();
    const liveAppend = await buildTiledMemoryDisplayEvidence(points, () => true, cache);
    const liveAppendDurationMs = performance.now() - liveAppendStarted;
    if (!liveAppend?.evidence) throw new Error('Expected live append evidence');
    evidence = liveAppend;
    cache = liveAppend.cache;
    synchronousSlices.push(...liveAppend.sliceDurationsMs);
    intermediate.push({
      acceptedEvidenceCount: points.length,
      updateDurationMs: liveAppendDurationMs,
      rebuiltTileCount: liveAppend.rebuiltTileCount,
      rebuiltGroupCount: liveAppend.rebuiltGroupCount,
      maxSynchronousSliceMs: Math.max(...liveAppend.sliceDurationsMs),
      renderedGeometry: (() => {
        const fog = composeFogShape(liveAppend.evidence);
        return fog ? { type: fog.geometry.type, vertices: vertices(fog.geometry.coordinates) } : null;
      })(),
      updateKind: 'one-point-live-append',
    });
    if (!evidence?.evidence) throw new Error('Expected final production tiled evidence');
    const finalFog = composeFogShape(evidence.evidence)!;
    const approvedEnvelope = buffer(
      multiPoint(points.map(point => [point.lng, point.lat])),
      CORRIDOR_WIDTH_M,
      { units: 'meters', steps: 64 },
    );
    if (!approvedEnvelope) throw new Error('Expected bounded comparison geometry');
    const unsupportedGeometry = difference(featureCollection([evidence.evidence, approvedEnvelope]));
    const unsupportedRevealAreaM2 = unsupportedGeometry == null ? 0 : area(unsupportedGeometry);
    const metrics = {
      // Wall-clock limits for this older Intel reference Mac. The 120 ms
      // coalescing delay is included only in the display budget below; neither
      // threshold permits a hidden seconds-long update.
      maxSynchronousWorkUnitBudgetMs: 150,
      onePointLiveUpdateBudgetMs: 650,
      newEvidenceToDisplayBudgetMs: 800,
      debouncePolicyMs: 120,
      reconciliationBatchDurationMs: {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: Math.max(...durations),
      },
      onePointLiveUpdateMs: liveAppendDurationMs,
      newEvidenceToDisplayMs: {
        onePointLive: 120 + liveAppendDurationMs,
      },
      boundedSliceCount: synchronousSlices.length,
      maxSynchronousSliceMs: Math.max(...synchronousSlices),
      previousCoverageLossSampleCount: points.filter((_, index) => index % 17 === 0)
        .filter(point => fogged(finalFog, point)).length,
      unsupportedRevealAreaM2,
      unsupportedRevealMethod: 'calculated Turf difference against an independent 64-step 30 m envelope',
      geometryType: finalFog.geometry.type,
      vertices: vertices(finalFog.geometry.coordinates),
      payloadBytes: JSON.stringify(finalFog).length,
      renderUpdates: intermediate.length,
      acceptedEvidenceCount: points.length,
    };
    expect(metrics.previousCoverageLossSampleCount).toBe(0);
    process.stderr.write(`memory-presentation-updates=${JSON.stringify(intermediate.map(item => ({ accepted: item.acceptedEvidenceCount, durationMs: item.updateDurationMs, rebuiltTiles: item.rebuiltTileCount, rebuiltGroups: item.rebuiltGroupCount, maxSliceMs: item.maxSynchronousSliceMs })))}\n`);
    expect(metrics.unsupportedRevealAreaM2).toBeLessThan(0.01);
    expect(metrics.maxSynchronousSliceMs).toBeLessThan(metrics.maxSynchronousWorkUnitBudgetMs);
    expect(metrics.onePointLiveUpdateMs).toBeLessThan(metrics.onePointLiveUpdateBudgetMs);
    expect(metrics.newEvidenceToDisplayMs.onePointLive).toBeLessThan(metrics.newEvidenceToDisplayBudgetMs);

    const output = process.env.MEMORY_PRESENTATION_EVIDENCE_OUT;
    if (output) {
      fs.writeFileSync(output, JSON.stringify({
        generatedAt: new Date().toISOString(),
        environment: {
          machine: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`,
          node: process.version,
          renderer: 'standalone Turf/GeoJSON geometry; not Mapbox screen or phone rendering',
          dataset: 'synthetic accepted-source-contract NZ fixture; not field evidence',
        },
        acceptedCoverageEvidence: points,
        timeQualifiedPresenceMetadata: 'covered by memoryEvidenceAuthority/memoryPresencePersistence; not inferred from this display fixture',
        approvedEvidenceEnvelope: { radiusM: CORRIDOR_WIDTH_M, sourcePointCount: points.length },
        intermediate,
        lifecycleStages: {
          exercised: false,
          reason: 'standalone geometry test does not execute Activity Finish or durable reload',
        },
        metrics,
        limitations: [
          'Synthetic test input does not establish physical movement, native Mapbox performance, or NZ field validation.',
          'Pre-Finish, Finish, and reload observations are intentionally absent; loaded/store lifecycle tests own those claims.',
          'Persistence write counts are asserted separately by memoryPresencePersistence.test.ts.',
        ],
      }, null, 2));
    }
  }, 20_000);
});
