/**
 * snapTrack.test.ts — unit tests for the activity / brush snap pipeline.
 */

// Set token before requiring SUT (env-read at module-load is safer)
process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'test-token';

import { snapTrack, type RawPoint } from '../snapTrack';

const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  (global as any).fetch = realFetch;
  (globalThis as any).fetch = realFetch;
});

// === Helpers ================================================================

/** Build a synthetic GPS straight-line stretch heading north. */
function lineNorth(n: number, fromLat = -36.8, fromLng = 174.7, lengthM = 200): RawPoint[] {
  const out: RawPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / Math.max(1, n - 1);
    out.push({
      lat: fromLat + (lengthM / 111_320) * t,
      lng: fromLng,
      alt: 10 + i * 0.1,
      accuracy: 14,
      speed: 1.0,
    });
  }
  return out;
}

/** A successful Mapbox /matching response with N coords. */
function fakeOkResponse(n: number, confidence = 0.9): any {
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    coords.push([174.7, -36.8 + (200 / 111_320) * (i / Math.max(1, n - 1))]);
  }
  return {
    status: 200,
    json: async () => ({
      code: 'Ok',
      matchings: [{ confidence, geometry: { coordinates: coords } }],
    }),
  };
}

// === Input validation ======================================================

describe('snapTrack — input validation', () => {
  test('empty input → no_input', async () => {
    const r = await snapTrack([], { mapboxToken: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_input');
  });

  test('1-point input → too_short', async () => {
    const r = await snapTrack([{ lat: 0, lng: 0 }], { mapboxToken: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('too_short');
  });

  test('missing token → no_token', async () => {
    const r = await snapTrack(lineNorth(5), { mapboxToken: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no_token');
  });

  test('pre-aborted signal → aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x', signal: ac.signal });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('aborted');
  });
});

// === Happy path ============================================================

describe('snapTrack — happy path (single GOOD run)', () => {
  test('5-point line → 1 chunk → 1 Mapbox call → snap returned', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse(5, 0.95));
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.apiCalls).toBe(1);
    expect(r.stats.chunksOk).toBe(1);
    expect(r.stats.chunksFallback).toBe(0);
    expect(r.stats.goodRuns).toBe(1);
    expect(r.stats.lostRuns).toBe(0);
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  test('200-point line → 3 chunks → 3 Mapbox calls', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse(70, 0.9));
    const r = await snapTrack(lineNorth(200), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // chunkBounds for 200 pts at chunk=80 overlap=10 → [0,80] [70,150] [140,200] = 3 chunks
    expect(r.stats.apiCalls).toBe(3);
    expect(r.stats.chunksOk).toBe(3);
  });
});

// === LOST run handling =====================================================

describe('snapTrack — LOST run handling', () => {
  test('all-LOST run is densified raw, never sent to Mapbox', async () => {
    const lost: RawPoint[] = lineNorth(10).map((p) => ({ ...p, speed: -1 }));
    const r = await snapTrack(lost, { mapboxToken: 'x' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.lostRuns).toBe(1);
    expect(r.stats.goodRuns).toBe(0);
    expect(r.stats.apiCalls).toBe(0);
  });

  test('mixed run: good + lost segments → only good sent to Mapbox', async () => {
    // 5 good followed by 5 lost
    const good = lineNorth(5).map((p) => ({ ...p, speed: 1 }));
    const lostBase = lineNorth(5);
    // shift lost segment so concat makes sense
    const lost = lostBase.map((p, i) => ({
      ...p,
      lat: p.lat + 200 / 111_320,
      speed: -1,
    }));
    fetchMock.mockResolvedValue(fakeOkResponse(5, 0.9));
    const r = await snapTrack([...good, ...lost], { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.goodRuns).toBe(1);
    expect(r.stats.lostRuns).toBe(1);
    expect(r.stats.apiCalls).toBe(1); // only the good segment
  });

  test('high-accuracy values mark points LOST', async () => {
    const sketchy: RawPoint[] = lineNorth(5).map((p) => ({ ...p, accuracy: 50 }));
    const r = await snapTrack(sketchy, { mapboxToken: 'x' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.lostRuns).toBe(1);
  });
});

// === Failure modes =========================================================

describe('snapTrack — failure modes degrade gracefully', () => {
  test('Mapbox NoSegment → chunk fallback raw, still ok=true', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 'NoSegment' }),
    });
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.chunksOk).toBe(0);
    expect(r.stats.chunksFallback).toBe(1);
    // Output is the raw line, densified — non-empty
    expect(r.points.length).toBeGreaterThanOrEqual(2);
  });

  test('low confidence → chunk fallback raw', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse(5, 0.1));
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.chunksFallback).toBe(1);
    expect(r.stats.chunksOk).toBe(0);
  });

  test('HTTP 401 → chunk fallback raw', async () => {
    fetchMock.mockResolvedValue({ status: 401, json: async () => ({}) });
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.chunksFallback).toBe(1);
  });

  test('thrown network error → chunk fallback raw', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const r = await snapTrack(lineNorth(5), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.chunksFallback).toBe(1);
  });
});

// === alt preservation ======================================================

describe('snapTrack — alt preservation', () => {
  test('alt re-attached on snap success via nearest-neighbor', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse(5, 0.95));
    const raw = lineNorth(5).map((p, i) => ({ ...p, alt: 100 + i }));
    const r = await snapTrack(raw, { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // After dedupe + smoother, every output point should have alt populated
    const allHaveAlt = r.points.every((p) => p.alt != null);
    expect(allHaveAlt).toBe(true);
  });

  test('LOST run alt preserved via densification', async () => {
    const lost: RawPoint[] = lineNorth(5).map((p, i) => ({
      ...p,
      speed: -1,
      alt: 50 + i,
    }));
    const r = await snapTrack(lost, { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.points[0].alt).toBe(50);
    expect(r.points[r.points.length - 1].alt).toBe(54);
  });
});

// === Bounded behaviour (oversize / abort) ==================================

describe('snapTrack — bounded behaviour', () => {
  // These tests use abort/timeout against pending fetches; raise jest's
  // per-test timeout so we can wait safely.
  jest.setTimeout(10_000);

  test('caller abort mid-flight → reason aborted or fallback', async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          // Honor the inner AbortController so abort propagates
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const promise = snapTrack(lineNorth(5), { mapboxToken: 'x', signal: ac.signal });
    setImmediate(() => ac.abort());
    const r = await promise;
    // After abort: pipeline either reports aborted, timed_out, or salvaged
    // raw via chunk-fallback (still ok=true). All three are acceptable
    // contracts — the key invariant is "doesn't hang".
    if (r.ok) {
      // raw fallback path
      expect(r.stats.chunksFallback).toBeGreaterThan(0);
    } else {
      expect(['aborted', 'timed_out', 'all_chunks_failed']).toContain(r.reason);
    }
  });

  test('total timeout aborts pipeline', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const r = await snapTrack(lineNorth(5), {
      mapboxToken: 'x',
      totalTimeoutMs: 50,
      perCallTimeoutMs: 9_999,
    });
    if (r.ok) {
      expect(r.stats.chunksFallback).toBeGreaterThan(0);
    } else {
      expect(['timed_out', 'aborted', 'all_chunks_failed']).toContain(r.reason);
    }
  });
});

// === Cross-run splice ======================================================

describe('snapTrack — cross-run splice does not leave flying lines', () => {
  test('GOOD-LOST-GOOD: no gap > 50m in output', async () => {
    fetchMock.mockResolvedValue(fakeOkResponse(5, 0.95));
    // 5 good, 5 lost (offset 100m east), 5 good (offset 200m east)
    const seg1 = lineNorth(5).map((p) => ({ ...p, speed: 1 }));
    const seg2 = lineNorth(5).map((p) => ({
      ...p,
      lat: p.lat + 100 / 111_320,
      speed: -1,
    }));
    const seg3 = lineNorth(5).map((p) => ({
      ...p,
      lat: p.lat + 200 / 111_320,
      speed: 1,
    }));
    const r = await snapTrack([...seg1, ...seg2, ...seg3], { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // No consecutive output gap > 50m — bridges should fill
    const haversineM = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371000;
      const dLat = ((b.lat - a.lat) * Math.PI) / 180;
      const dLng = ((b.lng - a.lng) * Math.PI) / 180;
      const lat1 = (a.lat * Math.PI) / 180;
      const lat2 = (b.lat * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    let maxGap = 0;
    for (let i = 1; i < r.points.length; i++) {
      maxGap = Math.max(maxGap, haversineM(r.points[i - 1], r.points[i]));
    }
    expect(maxGap).toBeLessThanOrEqual(50);
  });
});
