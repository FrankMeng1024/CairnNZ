import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { destination as turfDestination, distance as turfDistance, point as turfPoint } from '@turf/turf';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../store/useFriendMemoryStore', () => ({
  useFriendMemoryStore: Object.assign(jest.fn(), { getState: jest.fn(() => ({ getVisibleCells: () => [] })) }),
}));
jest.mock('../store/useH3VisitedStore', () => ({
  useH3VisitedStore: { getState: () => ({ addPointToCells: jest.fn(), clear: jest.fn(), bulkImport: jest.fn() }) },
}));
jest.mock('../services/lastFixCache', () => ({ persistLastFix: jest.fn() }));

import {
  buildTiledMemoryDisplayEvidence,
  buildTiledCombinedDisplayEvidence,
  composeFogShape,
  CORRIDOR_WIDTH_M,
  type DisplayGeometrySliceSample,
  prepareMemoryFogContent,
  restoreDisplayGeometryCache,
  serializeDisplayGeometryCache,
} from '../components/FogLayer';
import { useMemoryStore } from '../store/useMemoryStore';
import {
  getFogDisplayCacheReadMetricsForTest,
  fogDisplayCacheChunkPrefixForTest,
  fogDisplayCacheKeyForTest,
  purgeFogDisplayCache,
  readFogDisplayCache,
  resetFogDisplayCacheMemory,
  writeFogDisplayCache,
} from '../services/fogDisplayCache';

type CoveragePoint = { lat: number; lng: number; ts: number; cid: string };

const BUDGETS = Object.freeze({
  maxSynchronousGeometrySliceMs: 150,
  scheduledActionAcknowledgementMs: 100,
  incrementalGeometryUpdateMs: 350,
  maxEventLoopSchedulingDelayMs: 150,
  coldLoad2001Ms: 45_000,
  diagnostic10000Ms: 150_000,
  combinedFriend2000Ms: 60_000,
  cacheSynchronousSliceMs: 150,
  sampledUnsupportedRevealCount: 0,
});
const ORIGIN = { lat: -41.2865, lng: 174.7762 };

function plausibleHistory(count: number): CoveragePoint[] {
  const lngScale = 111_320 * Math.cos(ORIGIN.lat * Math.PI / 180);
  return Array.from({ length: count }, (_, index) => {
    const outing = Math.floor(index / 100);
    const within = index % 100;
    const direction = outing % 2 === 0 ? within : 99 - within;
    const eastM = direction * 16;
    const northM = outing * 100 + Math.sin(within / 12) * 8;
    return {
      lat: ORIGIN.lat + northM / 111_320,
      lng: ORIGIN.lng + eastM / lngScale,
      ts: 1_790_000_000_000 + outing * 86_400_000 + within * 12_000,
      cid: `scale-${count}-${index}`,
    };
  });
}

function plausibleFriendCells(count: number): Array<Array<[number, number]>> {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(ORIGIN.lat * Math.PI / 180);
  const sizeM = 180;
  const columns = 50;
  return Array.from({ length: count }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const minLng = ORIGIN.lng + (5_000 + column * sizeM) / lngScale;
    const minLat = ORIGIN.lat + (5_000 + row * sizeM) / latScale;
    const maxLng = ORIGIN.lng + (5_000 + (column + 1) * sizeM) / lngScale;
    const maxLat = ORIGIN.lat + (5_000 + (row + 1) * sizeM) / latScale;
    return [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]];
  });
}

function vertexCount(value: unknown): number {
  if (!Array.isArray(value)) return 0;
  if (value.length >= 2 && value.every(item => typeof item === 'number')) return 1;
  return value.reduce((total, item) => total + vertexCount(item), 0);
}

function topology(value: any) {
  if (value.type === 'Polygon') return { components: 1, holes: Math.max(0, value.coordinates.length - 1) };
  return {
    components: value.coordinates.length,
    holes: value.coordinates.reduce((total: number, polygon: any[]) => total + Math.max(0, polygon.length - 1), 0),
  };
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))] ?? 0;
}

function beginEventLoopDelayProbe() {
  const delays: number[] = [];
  let active = true;
  let scheduledAt = performance.now();
  let timer: ReturnType<typeof setTimeout>;
  const tick = () => {
    const now = performance.now();
    delays.push(now - scheduledAt);
    if (!active) return;
    scheduledAt = performance.now();
    timer = setTimeout(tick, 0);
  };
  timer = setTimeout(tick, 0);
  return async () => {
    active = false;
    await new Promise(resolve => setTimeout(resolve, 5));
    clearTimeout(timer);
    return delays;
  };
}

function sampleUnsupportedReveal(
  evidence: any,
  points: CoveragePoint[],
  sampleCount = 8_000,
) {
  const latScale = 111_320;
  const lngScale = 111_320 * Math.cos(ORIGIN.lat * Math.PI / 180);
  const local = points.map(point => ({
    x: (point.lng - ORIGIN.lng) * lngScale,
    y: (point.lat - ORIGIN.lat) * latScale,
  }));
  const minX = Math.min(...local.map(point => point.x)) - CORRIDOR_WIDTH_M;
  const maxX = Math.max(...local.map(point => point.x)) + CORRIDOR_WIDTH_M;
  const minY = Math.min(...local.map(point => point.y)) - CORRIDOR_WIDTH_M;
  const maxY = Math.max(...local.map(point => point.y)) + CORRIDOR_WIDTH_M;
  const bucketSize = 64;
  const buckets = new Map<string, Array<{ x: number; y: number }>>();
  for (const point of local) {
    const key = `${Math.floor(point.x / bucketSize)}|${Math.floor(point.y / bucketSize)}`;
    const values = buckets.get(key);
    if (values) values.push(point);
    else buckets.set(key, [point]);
  }
  let insideDisplay = 0;
  let unsupported = 0;
  // Deterministic low-discrepancy sampling. This is explicitly sampled
  // evidence, not a claim of exact zero-area proof.
  for (let index = 1; index <= sampleCount; index += 1) {
    const fractionX = (index * 0.6180339887498949) % 1;
    const fractionY = (index * 0.7548776662466927) % 1;
    const x = minX + (maxX - minX) * fractionX;
    const y = minY + (maxY - minY) * fractionY;
    const geo = turfPoint([ORIGIN.lng + x / lngScale, ORIGIN.lat + y / latScale]);
    if (!booleanPointInPolygon(geo, evidence)) continue;
    insideDisplay += 1;
    const bx = Math.floor(x / bucketSize);
    const by = Math.floor(y / bucketSize);
    let supported = false;
    for (let oy = -1; oy <= 1 && !supported; oy += 1) {
      for (let ox = -1; ox <= 1 && !supported; ox += 1) {
        for (const point of buckets.get(`${bx + ox}|${by + oy}`) ?? []) {
          if (turfDistance(
            turfPoint([ORIGIN.lng + point.x / lngScale, ORIGIN.lat + point.y / latScale]),
            geo,
            { units: 'meters' },
          ) <= CORRIDOR_WIDTH_M + 0.005) {
            supported = true;
            break;
          }
        }
      }
    }
    if (!supported) unsupported += 1;
  }
  const boundingAreaM2 = (maxX - minX) * (maxY - minY);
  return {
    method: '8,000 deterministic low-discrepancy samples plus independent Turf ground-distance support predicate (0.005 m numeric epsilon)',
    sampleCount,
    insideDisplay,
    unsupportedCount: unsupported,
    sampledUnsupportedAreaEstimateM2: boundingAreaM2 * unsupported / sampleCount,
    boundingAreaM2,
  };
}

const output: any = {
  schema: 'cairnnz.revision03.memory-scale.v1',
  generatedAt: null,
  environment: { machine: `${os.platform()} ${os.arch()} ${os.cpus()[0]?.model ?? 'unknown CPU'}`, node: process.version, renderer: 'actual FogLayer Turf helpers; no Mapbox paint' },
  budgetsFrozenBeforeRun: BUDGETS,
  candidateFingerprint: process.env.R03_CANDIDATE_FINGERPRINT ?? null,
  cases: [],
};

describe('revision-03 representative distinct Memory scale and foreground responsiveness', () => {
  jest.setTimeout(180_000);

  afterAll(() => {
    output.generatedAt = new Date().toISOString();
    const target = process.env.R03_MEMORY_SCALE_OUT;
    if (target) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(output, null, 2));
    }
  });

  test('display-cache storage rejection is reported without an unhandled rejected write', async () => {
    const storageModule = require('@react-native-async-storage/async-storage');
    const AsyncStorage = storageModule.default ?? storageModule;
    AsyncStorage.setItem.mockRejectedValueOnce(new Error('synthetic quota failure'));
    await expect(writeFogDisplayCache({
      version: 3,
      accountId: 'scale-cache-write-failure',
      authority: 'failure-authority',
      contentSignature: 'failure-signature',
      pointCount: 0,
      displayTiles: [],
      savedAt: Date.now(),
    })).resolves.toMatchObject({ persisted: false, superseded: false });
  });

  test('account purge fences and removes a deferred precise-geometry cache write', async () => {
    const storageModule = require('@react-native-async-storage/async-storage');
    const AsyncStorage = storageModule.default ?? storageModule;
    const accountId = 'scale-cache-purge-race';
    const writeBarrier: { release?: () => void } = {};
    AsyncStorage.setItem.mockImplementationOnce(() => new Promise<void>(resolve => {
      writeBarrier.release = resolve;
    }));
    const write = writeFogDisplayCache({
      version: 3,
      accountId,
      authority: `${accountId}|self`,
      contentSignature: 'purge-race-signature',
      pointCount: 1,
      displayTiles: [['1|1', {
        signature: 'one-point',
        pointCount: 1,
        polygons: [[[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0.001], [0, 0]]]],
      }]],
      savedAt: Date.now(),
    });
    for (let attempt = 0; attempt < 20 && !writeBarrier.release; attempt += 1) await Promise.resolve();
    expect(writeBarrier.release).toBeDefined();
    const purge = purgeFogDisplayCache(accountId);
    writeBarrier.release?.();
    const metrics = await write;
    await purge;
    expect(metrics).toMatchObject({ persisted: false, invalidated: true });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys).not.toContain(fogDisplayCacheKeyForTest(accountId));
    expect(keys.some((key: string) => key.startsWith(fogDisplayCacheChunkPrefixForTest(accountId)))).toBe(false);
    await expect(writeFogDisplayCache({
      version: 3,
      accountId,
      authority: `${accountId}|stale`,
      contentSignature: 'stale-after-purge',
      pointCount: 0,
      displayTiles: [],
      savedAt: Date.now(),
    })).resolves.toMatchObject({ persisted: false, invalidated: true });
  });

  test('2,001 distinct accepted footprints cold-load in bounded slices and retain truth during a live append', async () => {
    useMemoryStore.getState().resetForUserSwitch();
    const history = plausibleHistory(2_001);
    const insertionDurations: number[] = [];
    for (const point of history) {
      const started = performance.now();
      useMemoryStore.getState().recordPoint(point.lat, point.lng, point.ts, { source: 'historical_unknown' });
      insertionDurations.push(performance.now() - started);
    }
    const accepted = useMemoryStore.getState().points;
    expect(accepted).toHaveLength(2_001);
    const preparationStarted = performance.now();
    const prepared = prepareMemoryFogContent('scale-2001', accepted, []);
    const renderPreparationMs = performance.now() - preparationStarted;
    expect(prepared.contentSignature).toContain('|2001|0|');

    let actionAcknowledgementMs = -1;
    const actionScheduledAt = performance.now();
    const action = new Promise<void>(resolve => setTimeout(() => {
      const started = performance.now();
      // A scoped control dispatch that does not mutate geometry.
      useMemoryStore.getState().setLastWatcherFix(ORIGIN.lat, ORIGIN.lng, Date.now());
      actionAcknowledgementMs = performance.now() - actionScheduledAt + (performance.now() - started);
      resolve();
    }, 0));
    const stopColdEventLoopProbe = beginEventLoopDelayProbe();
    const coldStarted = performance.now();
    const cold = await buildTiledMemoryDisplayEvidence(accepted, () => true);
    const coldTotalMs = performance.now() - coldStarted;
    const coldEventLoopDelayMs = await stopColdEventLoopProbe();
    process.stderr.write(`scale-2001-cold-ms=${coldTotalMs.toFixed(1)}\n`);
    await action;
    expect(cold?.evidence).not.toBeNull();
    if (!cold?.evidence) throw new Error('2,001-point cold evidence unavailable');
    // Exercise the real chunked storage service, then clear its module memory
    // so the read is a durable reconstruction rather than an object alias.
    const cacheEventLoopProbe = beginEventLoopDelayProbe();
    const cacheWriteMetrics = await writeFogDisplayCache({
      version: 3,
      accountId: 'scale-cache-owner',
      authority: 'scale-2001',
      contentSignature: prepared.contentSignature,
      pointCount: accepted.length,
      displayTiles: serializeDisplayGeometryCache(cold.cache),
      savedAt: Date.now(),
    });
    resetFogDisplayCacheMemory();
    const persisted = await readFogDisplayCache('scale-cache-owner');
    const cacheEventLoopDelayMs = await cacheEventLoopProbe();
    const cacheReadMetrics = getFogDisplayCacheReadMetricsForTest('scale-cache-owner');
    expect(cacheWriteMetrics.persisted).toBe(true);
    expect(persisted?.contentSignature).toBe(prepared.contentSignature);
    expect(persisted?.displayTiles).not.toBe(cold.cache.tiles);
    const restoredCache = restoreDisplayGeometryCache(persisted?.displayTiles ?? []);

    const live = plausibleHistory(2_041).slice(2_001);
    const stopIncrementalEventLoopProbe = beginEventLoopDelayProbe();
    const incrementalStarted = performance.now();
    const incremental = await buildTiledMemoryDisplayEvidence([...accepted, ...live], () => true, restoredCache);
    const incrementalGeometryUpdateMs = performance.now() - incrementalStarted;
    const incrementalEventLoopDelaySamples = await stopIncrementalEventLoopProbe();
    expect(incremental?.evidence).not.toBeNull();
    if (!incremental?.evidence) throw new Error('incremental evidence unavailable');
    const composeStarted = performance.now();
    const fogShape = composeFogShape(incremental.evidence);
    const composeFogShapeMs = performance.now() - composeStarted;
    expect(fogShape).not.toBeNull();
    process.stderr.write(`scale-2001-incremental-geometry-ms=${incrementalGeometryUpdateMs.toFixed(1)} rebuilt-tiles=${incremental.rebuiltTileCount} rebuilt-groups=${incremental.rebuiltGroupCount} compose-ms=${composeFogShapeMs.toFixed(1)}\n`);

    const unsupportedReveal = sampleUnsupportedReveal(incremental.evidence, [...accepted, ...live]);
    const sampledRetainedLoss = accepted.filter((_, index) => index % 97 === 0)
      .filter(point => !booleanPointInPolygon(turfPoint([point.lng, point.lat]), incremental.evidence!)).length;
    const topologyMetrics = topology(incremental.evidence.geometry);
    const allSlices = [...cold.sliceDurationsMs, ...incremental.sliceDurationsMs];
    const coldMaxSynchronousSliceMs = Math.max(...cold.sliceDurationsMs);
    const incrementalMaxSynchronousSliceMs = Math.max(...incremental.sliceDurationsMs);
    const maxSynchronousSliceMs = Math.max(...allSlices);

    output.cases.push({
      id: 'DISTINCT-2001-LIVE-APPEND', rawFixes: 2_041, acceptedCanonicalPoints: 2_041,
      spatiallyUniqueCoverageFootprints: 2_041, temporalWitnesses: 0,
      coldLoadMs: coldTotalMs, sliceCount: allSlices.length,
      coldRebuiltTileCount: cold.rebuiltTileCount,
      incrementalRebuiltTileCount: incremental.rebuiltTileCount,
      coldRebuiltGroupCount: cold.rebuiltGroupCount,
      incrementalRebuiltGroupCount: incremental.rebuiltGroupCount,
      sliceMs: {
        p50: percentile(allSlices, 0.5), p95: percentile(allSlices, 0.95), max: maxSynchronousSliceMs,
        coldMax: coldMaxSynchronousSliceMs, incrementalMax: incrementalMaxSynchronousSliceMs,
      },
      insertionMs: { p50: percentile(insertionDurations, 0.5), p95: percentile(insertionDurations, 0.95), max: Math.max(...insertionDurations) },
      incrementalGeometryUpdateMs, actionAcknowledgementMs,
      renderPreparationMs,
      persistentCacheRoundTrip: {
        inputTileCount: cacheWriteMetrics.inputTileCount,
        serializedTileCount: cacheWriteMetrics.persistedTileCount,
        skippedTileCount: cacheWriteMetrics.skippedTileCount,
        chunks: cacheWriteMetrics.chunkCount,
        bytes: cacheWriteMetrics.serializedBytes,
        encodeMs: cacheWriteMetrics.encodeMs,
        maxEncodeSliceMs: cacheWriteMetrics.maxEncodeSliceMs,
        storageMs: cacheWriteMetrics.storageMs,
        maxChunkWriteMs: cacheWriteMetrics.maxChunkWriteMs,
        read: cacheReadMetrics,
        eventLoopDelayMs: { p95: percentile(cacheEventLoopDelayMs, 0.95), max: Math.max(...cacheEventLoopDelayMs) },
        rebuiltTilesAfterReload: incremental.rebuiltTileCount,
        rebuiltGroupsAfterReload: incremental.rebuiltGroupCount,
      },
      eventLoopSchedulingDelayMs: {
        cold: { p95: percentile(coldEventLoopDelayMs, 0.95), max: Math.max(...coldEventLoopDelayMs) },
        incremental: {
          p95: percentile(incrementalEventLoopDelaySamples, 0.95),
          max: Math.max(...incrementalEventLoopDelaySamples),
        },
      },
      composeFogShapeMs,
      unsupportedReveal, sampledRetainedLoss,
      displayedGeometry: { ...topologyMetrics, vertices: vertexCount(incremental.evidence.geometry.coordinates) },
    });

    expect(sampledRetainedLoss).toBe(0);
    expect(unsupportedReveal.unsupportedCount).toBe(BUDGETS.sampledUnsupportedRevealCount);
    expect(maxSynchronousSliceMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(composeFogShapeMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(renderPreparationMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(Math.max(...coldEventLoopDelayMs, ...incrementalEventLoopDelaySamples))
      .toBeLessThan(BUDGETS.maxEventLoopSchedulingDelayMs);
    expect(coldTotalMs).toBeLessThan(BUDGETS.coldLoad2001Ms);
    expect(actionAcknowledgementMs).toBeLessThan(BUDGETS.scheduledActionAcknowledgementMs);
    expect(incrementalGeometryUpdateMs).toBeLessThan(BUDGETS.incrementalGeometryUpdateMs);
    expect(cacheWriteMetrics.maxEncodeSliceMs).toBeLessThan(BUDGETS.cacheSynchronousSliceMs);
    expect(cacheWriteMetrics.maxChunkWriteMs).toBeLessThan(BUDGETS.cacheSynchronousSliceMs);
    expect(cacheReadMetrics?.maxParseSliceMs ?? Infinity).toBeLessThan(BUDGETS.cacheSynchronousSliceMs);
    expect(Math.max(...cacheEventLoopDelayMs)).toBeLessThan(BUDGETS.maxEventLoopSchedulingDelayMs);
  });

  test('2,001-location self history plus 2,000 coarse friend cells stays tile-local and responsive', async () => {
    const self = plausibleHistory(2_001);
    const friendCells = plausibleFriendCells(2_000);
    const selfEvidence = await buildTiledMemoryDisplayEvidence(self, () => true);
    expect(selfEvidence?.evidence).not.toBeNull();
    if (!selfEvidence) throw new Error('self cache unavailable');
    const selfTileCount = selfEvidence.cache.tiles.size;
    const stopEventLoopProbe = beginEventLoopDelayProbe();
    const startedAt = performance.now();
    const combined = await buildTiledCombinedDisplayEvidence(selfEvidence.cache, friendCells, () => true);
    const totalMs = performance.now() - startedAt;
    const eventLoopDelayMs = await stopEventLoopProbe();
    expect(combined?.evidence).not.toBeNull();
    if (!combined?.evidence) throw new Error('combined display evidence unavailable');
    const composeStartedAt = performance.now();
    const fog = composeFogShape(combined.evidence);
    const composeMs = performance.now() - composeStartedAt;
    expect(fog).not.toBeNull();
    const maxSliceMs = Math.max(...combined.sliceDurationsMs);
    expect(combined.rejectedFriendCellCount).toBe(0);
    expect(selfEvidence.cache.tiles.size).toBe(selfTileCount);
    expect(maxSliceMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(Math.max(...eventLoopDelayMs)).toBeLessThan(BUDGETS.maxEventLoopSchedulingDelayMs);
    expect(composeMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(totalMs).toBeLessThan(BUDGETS.combinedFriend2000Ms);
    output.cases.push({
      id: 'COMBINED-SELF-2001-FRIEND-CELLS-2000',
      selfAcceptedCanonicalPoints: self.length,
      friendProjectionCells: friendCells.length,
      sourceCachesRemainSeparate: true,
      totalMs,
      composeMs,
      maxSynchronousSliceMs: maxSliceMs,
      eventLoopSchedulingDelayMs: {
        p95: percentile(eventLoopDelayMs, 0.95), max: Math.max(...eventLoopDelayMs),
      },
      rejectedFriendCellCount: combined.rejectedFriendCellCount,
      displayedGeometry: { ...topology(combined.evidence.geometry), vertices: vertexCount(combined.evidence.geometry.coordinates) },
    });
  });

  test('10,000 distinct-location diagnostic retains every input without duplicate inflation', async () => {
    const points = plausibleHistory(10_000);
    expect(new Set(points.map(point => `${point.lat.toFixed(7)}|${point.lng.toFixed(7)}`)).size).toBe(10_000);
    const preparationStarted = performance.now();
    const prepared = prepareMemoryFogContent('scale-10000', points, []);
    const renderPreparationMs = performance.now() - preparationStarted;
    expect(prepared.contentSignature).toContain('|10000|0|');
    const stopEventLoopProbe = beginEventLoopDelayProbe();
    const sliceSamples: DisplayGeometrySliceSample[] = [];
    const startedAt = performance.now();
    const built = await buildTiledMemoryDisplayEvidence(points, () => true, null, sample => {
      sliceSamples.push(sample);
    });
    const totalMs = performance.now() - startedAt;
    const eventLoopDelaySamples = await stopEventLoopProbe();
    process.stderr.write(`scale-10000-total-ms=${totalMs.toFixed(1)}\n`);
    const evidence = built?.evidence ?? null;
    const sliceDurationsMs = built?.sliceDurationsMs ?? [];
    expect(evidence).not.toBeNull();
    if (!evidence) throw new Error('10,000-point diagnostic evidence unavailable');
    const composeStarted = performance.now();
    const fogShape = composeFogShape(evidence);
    const composeFogShapeMs = performance.now() - composeStarted;
    expect(fogShape).not.toBeNull();
    const retainedSampleLoss = points.filter((_, index) => index % 401 === 0)
      .filter(point => !booleanPointInPolygon(turfPoint([point.lng, point.lat]), evidence!)).length;
    expect(retainedSampleLoss).toBe(0);
    const maxSynchronousSliceMs = Math.max(...sliceDurationsMs);
    const slowestSlices = [...sliceSamples]
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 12);
    const phaseMaxima = Object.values(sliceSamples.reduce<Record<string, DisplayGeometrySliceSample>>((maxima, sample) => {
      if (!maxima[sample.phase] || sample.durationMs > maxima[sample.phase].durationMs) {
        maxima[sample.phase] = sample;
      }
      return maxima;
    }, {})).sort((left, right) => right.durationMs - left.durationMs);
    process.stderr.write(`scale-10000-slowest-slices=${JSON.stringify(slowestSlices)}\n`);
    process.stderr.write(`scale-10000-phase-maxima=${JSON.stringify(phaseMaxima)}\n`);
    expect(maxSynchronousSliceMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(renderPreparationMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(composeFogShapeMs).toBeLessThan(BUDGETS.maxSynchronousGeometrySliceMs);
    expect(Math.max(...eventLoopDelaySamples)).toBeLessThan(BUDGETS.maxEventLoopSchedulingDelayMs);
    expect(totalMs).toBeLessThan(BUDGETS.diagnostic10000Ms);
    output.cases.push({
      id: 'DISTINCT-10000-DIAGNOSTIC', rawFixes: 10_000, acceptedCanonicalPoints: 10_000,
      spatiallyUniqueCoverageFootprints: 10_000, temporalWitnesses: 0,
      totalMs, sliceCount: sliceDurationsMs.length,
      renderPreparationMs,
      composeFogShapeMs,
      sliceMs: { p50: percentile(sliceDurationsMs, 0.5), p95: percentile(sliceDurationsMs, 0.95), max: maxSynchronousSliceMs },
      slowestSlices,
      phaseMaxima,
      eventLoopSchedulingDelayMs: {
        p95: percentile(eventLoopDelaySamples, 0.95),
        max: Math.max(...eventLoopDelaySamples),
      },
      retainedSampleLoss,
      displayedGeometry: { ...topology(evidence.geometry), vertices: vertexCount(evidence.geometry.coordinates) },
      claimBoundary: 'diagnostic maximum tested; not an unlimited-support claim',
    });
  });

  test('a single tiled footprint stays within the exact 30 m ground-distance authority', async () => {
    const source = { ...ORIGIN, ts: 1, cid: 'exact-radius-source' };
    const built = await buildTiledMemoryDisplayEvidence([source], () => true);
    expect(built?.evidence).not.toBeNull();
    if (!built?.evidence) throw new Error('single-footprint evidence unavailable');
    const coordinates = built.evidence.geometry.type === 'Polygon'
      ? built.evidence.geometry.coordinates
      : built.evidence.geometry.coordinates.flat();
    const vertexDistancesM = coordinates.flat().map(([lng, lat]) => turfDistance(
      turfPoint([source.lng, source.lat]),
      turfPoint([lng, lat]),
      { units: 'meters' },
    ));
    expect(Math.max(...vertexDistancesM)).toBeLessThanOrEqual(CORRIDOR_WIDTH_M + 0.005);
    const outside = turfDestination(
      turfPoint([source.lng, source.lat]),
      CORRIDOR_WIDTH_M + 0.05,
      90,
      { units: 'meters' },
    );
    expect(booleanPointInPolygon(outside, built.evidence)).toBe(false);
  });
});
