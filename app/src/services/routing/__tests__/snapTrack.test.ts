/**
 * snapTrack.test.ts — unit tests for the activity / brush snap pipeline.
 */

// Set token before requiring SUT (env-read at module-load is safer)
process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'test-token';

import {
  analyzeTrustedEndpointCoverage,
  evaluateIslandSeamQuality,
  evaluateMatchedGeometryQuality,
  evaluateWholeRouteQuality,
  preserveTrustedRouteEndpoints,
  resampleMatcherEvidence,
  snapTrack,
  type RawPoint,
} from '../snapTrack';

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
      tracepoints: coords.map(location => ({ matchings_index: 0, location })),
    }),
  };
}

function fakeEchoResponse(url: string, confidence = 0.9): any {
  const encoded = new URL(url).pathname.split('/').at(-1) ?? '';
  const coords = encoded.split(';').map((entry) => {
    const [lng, lat] = entry.split(',').map(Number);
    return [lng, lat] as [number, number];
  });
  return {
    status: 200,
    json: async () => ({
      code: 'Ok',
      matchings: [{ confidence, geometry: { coordinates: coords } }],
      tracepoints: coords.map(location => ({ matchings_index: 0, location })),
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
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.9)));
    const r = await snapTrack(lineNorth(200), { mapboxToken: 'x' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // One shared canonical boundary keeps temporal order unambiguous.
    expect(r.stats.apiCalls).toBe(3);
    expect(r.stats.chunksOk).toBe(3);
  });
});

describe('snapTrack — O49 ordered resampling and provenance', () => {
  test('one-second straight evidence becomes approximately four-second evidence with tidy=false', async () => {
    const raw = lineNorth(13, -36.8, 174.7, 60).map((point, index) => ({
      ...point,
      t: 1_000 + index * 1_000,
    }));
    expect(resampleMatcherEvidence(raw).map(point => point.sourceIndex)).toEqual([0, 4, 8, 12]);
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.98)));
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const requestUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestUrl).toContain('tidy=false');
    expect(requestUrl).toContain('timestamps=');
    expect(result.stats).toMatchObject({ canonicalPointCount: 13, resampledPointCount: 4 });
    expect(result.stats.requestResults[0]).toMatchObject({
      sourceIndexMap: [0, 4, 8, 12],
      matcherTidy: false,
      profile: 'walking',
    });
  });

  test('U-turn and repeated-pass reversal observations survive temporal resampling', () => {
    const eastings = [0, 2, 4, 6, 4, 2, 0, 2, 4, 6];
    const raw = eastings.map((eastM, index) => ({
      lat: -36.8,
      lng: 174.7 + eastM / (111_320 * Math.cos(-36.8 * Math.PI / 180)),
      accuracy: 5,
      t: 1_000 + index * 1_000,
    }));
    const submitted = resampleMatcherEvidence(raw);
    const kept = submitted.map(point => point.sourceIndex);
    expect(kept).toEqual(expect.arrayContaining([2, 3, 4, 5, 6, 7]));
    expect(submitted.filter(point => point.mandatoryReasons.includes('reversal')).length).toBeGreaterThanOrEqual(4);
  });

  test('two independently supported islands retain exact canonical fallback between them', async () => {
    const raw = lineNorth(25, -36.8, 174.7, 120).map((point, index) => ({
      ...point,
      t: 1_000 + index * 1_000,
    }));
    fetchMock.mockImplementation((url: string) => {
      const encoded = new URL(url).pathname.split('/').at(-1) ?? '';
      const submitted = encoded.split(';').map((entry) => {
        const [lng, lat] = entry.split(',').map(Number);
        return { lng, lat };
      });
      const shifted = (point: { lat: number; lng: number }): [number, number] => [
        point.lng + 2 / (111_320 * Math.cos(point.lat * Math.PI / 180)),
        point.lat,
      ];
      return Promise.resolve({
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [
            { confidence: 0.97, geometry: { coordinates: submitted.slice(0, 3).map(shifted) } },
            { confidence: 0.96, geometry: { coordinates: submitted.slice(4).map(shifted) } },
          ],
          tracepoints: submitted.map((point, index) => (
            index <= 2 ? { matchings_index: 0, location: shifted(point) }
              : index >= 4 ? { matchings_index: 1, location: shifted(point) } : null
          )),
        }),
      });
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.matchedIslandCount).toBe(2);
    expect(result.stats.canonicalFallbackDistanceM).toBeGreaterThan(0);
    expect(result.stats.wholeRouteValidation.accepted).toBe(true);
    const middle = result.points.find(point => point.t === raw[12].t);
    expect(middle).toMatchObject({ lat: raw[12].lat, lng: raw[12].lng });
  });

  test('a topology island shorter than ten metres remains canonical', async () => {
    const raw = lineNorth(3, -36.8, 174.7, 8).map((point, index) => ({
      ...point,
      t: 1_000 + index * 5_000,
    }));
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.99)));
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ matchedIslandCount: 0, chunksOk: 0, chunksFallback: 1 });
    expect(result.points).toEqual(raw.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt, t: point.t })));
  });
});

describe('snapTrack — O49 seam and whole-route gates', () => {
  const local = (northM: number, eastM: number): RawPoint => ({
    lat: metresLat(northM),
    lng: metresLng(eastM),
    accuracy: 5,
  });
  function metresLat(northM: number): number { return northM / 111_320; }
  function metresLng(eastM: number): number { return eastM / 111_320; }

  test('clean canonical→matched and matched→canonical boundaries pass', () => {
    const canonical = [local(0, 0), local(0, 5), local(0, 10), local(0, 15), local(0, 20)];
    const matched = canonical.slice(1, 4).map(point => ({ lat: point.lat, lng: point.lng }));
    expect(evaluateIslandSeamQuality(canonical, 1, 3, matched)).toMatchObject({ accepted: true });
  });

  test('opposing bearing at an authority boundary is rejected instead of bridged', () => {
    const canonical = [local(0, 0), local(0, 5), local(0, 10), local(0, 15), local(0, 20)];
    const matched = [local(0, 5), local(0, 0), local(0, 15)];
    expect(evaluateIslandSeamQuality(canonical, 1, 3, matched)).toMatchObject({
      accepted: false,
      reason: 'entry_heading',
    });
  });

  test('a real 90-degree crossing and U-turn are not treated as seam defects', () => {
    const crossing = [local(0, 0), local(0, 5), local(0, 10), local(5, 10), local(10, 10)];
    expect(evaluateIslandSeamQuality(crossing, 2, 4, crossing.slice(2))).toMatchObject({ accepted: true });
    const uTurn = [local(0, 0), local(0, 5), local(0, 10), local(0, 5), local(0, 0)];
    expect(evaluateIslandSeamQuality(uTurn, 2, 4, uTurn.slice(2))).toMatchObject({ accepted: true });
  });

  test('whole-route validation rejects an assembly jump and extra duplicate edge', () => {
    const canonical = [local(0, 0), local(0, 5), local(0, 10), local(0, 15)];
    const jumped = [canonical[0], local(80, 5), canonical[2], canonical[3]];
    expect(evaluateWholeRouteQuality(canonical, jumped).accepted).toBe(false);
    expect(evaluateWholeRouteQuality(canonical, [canonical[0], canonical[1], canonical[1], canonical[2], canonical[3]]))
      .toMatchObject({ accepted: false, reason: 'duplicate_edge' });
  });

  test('10,000 one-second observations keep matcher evidence and request count bounded', async () => {
    const raw = lineNorth(10_000, -36.8, 174.7, 10_000).map((point, index) => ({
      ...point,
      t: 1_000 + index * 1_000,
    }));
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.99)));
    const result = await snapTrack(raw, { mapboxToken: 'x', concurrency: 4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.resampledPointCount).toBeLessThanOrEqual(2_502);
    expect(result.stats.apiCalls).toBeLessThanOrEqual(33);
    expect(result.stats.wholeRouteValidation.accepted).toBe(true);
  }, 20_000);
});

describe('snapTrack — derived geometry truthfulness', () => {
  test('preserves ordered out-and-back topology over repeated physical geometry', async () => {
    const step = 20 / 111_320;
    const raw: RawPoint[] = [0, 1, 2, 1, 0].map((north, index) => ({
      lat: -36.8 + north * step,
      lng: 174.7,
      accuracy: 5,
      speed: 1,
      t: 1_000 + index * 10_000,
    }));
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.95)));
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Math.abs(result.points[0].lat - raw[0].lat)).toBeLessThan(1e-7);
    expect(Math.abs(result.points[result.points.length - 1].lat - raw[raw.length - 1].lat)).toBeLessThan(1e-7);
    expect(Math.max(...result.points.map(point => point.lat))).toBeGreaterThan(raw[0].lat + step * 1.5);
    expect(result.stats.chunksOk).toBe(1);
  });

  test('preserves trustworthy raw head and tail around a bounded derived middle', () => {
    const raw = lineNorth(5);
    const endpointInset = 5 / 111_320;
    const matched = raw.map((point, index) => ({
      lat: index === 0
        ? point.lat + endpointInset
        : index === raw.length - 1 ? point.lat - endpointInset : point.lat,
      lng: point.lng,
    }));
    const anchored = preserveTrustedRouteEndpoints(raw, matched);
    expect(anchored[0]).toMatchObject({ lat: raw[0].lat, lng: raw[0].lng });
    expect(anchored[anchored.length - 1]).toMatchObject({
      lat: raw[raw.length - 1].lat,
      lng: raw[raw.length - 1].lng,
    });
  });

  test('does not manufacture long endpoint stubs for an uncovered match', () => {
    const raw = lineNorth(5).map(point => ({ ...point, accuracy: 5 }));
    const matched = raw.slice(1, -1).map(point => ({ lat: point.lat, lng: point.lng }));
    expect(analyzeTrustedEndpointCoverage(raw, matched)).toMatchObject({
      eligibleForAnchoring: false,
    });
    expect(preserveTrustedRouteEndpoints(raw, matched)).toEqual(matched);
  });

  test('accepts a correction inside the raw accuracy envelope', () => {
    const raw = lineNorth(12).map(point => ({ ...point, accuracy: 5 }));
    const matched = raw.map(point => ({
      lat: point.lat,
      lng: point.lng + 2 / (111_320 * Math.cos(point.lat * Math.PI / 180)),
    }));
    expect(evaluateMatchedGeometryQuality(raw, matched)).toMatchObject({
      accepted: true,
      reason: 'accepted',
    });
  });

  test('rejects a nearby-path correction outside the raw accuracy envelope', async () => {
    const raw = lineNorth(12).map(point => ({ ...point, accuracy: 5 }));
    const shifted = raw.map(point => ([
      point.lng + 22 / (111_320 * Math.cos(point.lat * Math.PI / 180)),
      point.lat,
    ]));
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{ confidence: 0.95, geometry: { coordinates: shifted } }],
        tracepoints: shifted.map(location => ({ matchings_index: 0, location })),
      }),
    });

    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunksOk: 0, chunksFallback: 1, qualityFallbacks: 1 });
    expect(result.stats.maxP95DeviationM).toBeGreaterThan(15);
  });

  test('moderate reported accuracy cannot steal an internal path 16m onto an external road', async () => {
    const raw = lineNorth(20).map(point => ({ ...point, accuracy: 14.25 }));
    const externalRoad = raw.map(point => ([
      point.lng + 16 / (111_320 * Math.cos(point.lat * Math.PI / 180)),
      point.lat,
    ]));
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{ confidence: 0.99, geometry: { coordinates: externalRoad } }],
        tracepoints: externalRoad.map(location => ({ matchings_index: 0, location })),
      }),
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunksOk: 0, chunksFallback: 1, qualityFallbacks: 1 });
    expect(result.points).toEqual(raw.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt })));
  });

  test('mixed matched/fallback chunks keep their shared temporal boundary', async () => {
    const raw = lineNorth(120, -36.8, 174.7, 240);
    let call = 0;
    fetchMock.mockImplementation((url: string) => {
      call += 1;
      return Promise.resolve(call === 1
        ? fakeEchoResponse(url, 0.95)
        : { status: 200, json: async () => ({ code: 'NoSegment' }) });
    });
    const result = await snapTrack(raw, { mapboxToken: 'x', concurrency: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunksOk: 1, chunksFallback: 1, seamBridges: 0 });
    expect(result.points).toHaveLength(raw.length);
    expect(result.points[80]).toMatchObject({ lat: raw[80].lat, lng: raw[80].lng });
  });

  test('partial Mapbox coverage becomes matched islands plus exact canonical fallback', async () => {
    const raw = lineNorth(10, -36.8, 174.7, 45).map((point, index) => ({
      ...point,
      // Keep all observations in this response-shape fixture. Dedicated O49
      // tests below cover four-second resampling itself.
      t: 1_000 + index * 5_000,
    }));
    const east2m = (point: RawPoint): [number, number] => [
      point.lng + 2 / (111_320 * Math.cos(point.lat * Math.PI / 180)),
      point.lat,
    ];
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [
          { confidence: 0.95, geometry: { coordinates: raw.slice(0, 3).map(east2m) } },
          { confidence: 0.91, geometry: { coordinates: raw.slice(6).map(east2m) } },
        ],
        tracepoints: raw.map((point, index) => (
          index <= 2
            ? { matchings_index: 0, location: east2m(point) }
            : index >= 6 ? { matchings_index: 1, location: east2m(point) } : null
        )),
      }),
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({
      chunksOk: 1,
      chunksFallback: 1,
      seamBridges: 0,
      minConfidence: 0.91,
    });
    expect(result.stats.requestResults[0].result).toBe('accepted_hybrid');
    expect(result.points).toHaveLength(raw.length);
    // The uncovered middle is byte-for-byte geographic fallback.
    expect(result.points.slice(3, 7)).toEqual(raw.slice(3, 7).map(point => ({
      lat: point.lat,
      lng: point.lng,
      alt: point.alt,
      t: point.t,
    })));
    expect(result.points.map(point => point.t)).toEqual(
      [...result.points].map(point => point.t).sort((a, b) => Number(a) - Number(b)),
    );
  });

  test('does not use a matching geometry that bridges across null tracepoints', async () => {
    const raw = lineNorth(6, -36.8, 174.7, 30);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{
          confidence: 0.99,
          geometry: { coordinates: [raw[0], raw[1], raw[4], raw[5]].map(point => [point.lng, point.lat]) },
        }],
        tracepoints: [
          { matchings_index: 0, location: [raw[0].lng, raw[0].lat] },
          { matchings_index: 0, location: [raw[1].lng, raw[1].lat] },
          null,
          null,
          { matchings_index: 0, location: [raw[4].lng, raw[4].lat] },
          { matchings_index: 0, location: [raw[5].lng, raw[5].lat] },
        ],
      }),
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ chunksOk: 0, chunksFallback: 1, seamBridges: 0 });
    expect(result.points).toEqual(raw.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt })));
  });

  test('one Mapbox matching is split into independent temporal islands around null support', async () => {
    const raw = lineNorth(9, -36.8, 174.7, 48).map((point, index) => ({
      ...point,
      t: 1_000 + index * 5_000,
    }));
    const location = (point: RawPoint): [number, number] => [point.lng, point.lat];
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{
          confidence: 0.98,
          geometry: { coordinates: [...raw.slice(0, 3), ...raw.slice(6)].map(location) },
        }],
        tracepoints: raw.map((point, index) => (
          index <= 2 || index >= 6
            ? { matchings_index: 0, location: location(point) }
            : null
        )),
      }),
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats.matchedIslandCount).toBe(2);
    expect(result.stats.requestResults[0].acceptedIslandCount).toBe(2);
    expect(result.points.find(point => point.t === raw[4].t)).toMatchObject({
      lat: raw[4].lat,
      lng: raw[4].lng,
    });
  });

  test('A→B→A→B remains three ordered passes across chunk boundaries', async () => {
    const metres = [
      ...Array.from({ length: 61 }, (_, index) => index),
      ...Array.from({ length: 60 }, (_, index) => 59 - index),
      ...Array.from({ length: 60 }, (_, index) => index + 1),
    ];
    const raw: RawPoint[] = metres.map((eastM, index) => ({
      lat: -36.8,
      lng: 174.7 + eastM / (111_320 * Math.cos(-36.8 * Math.PI / 180)),
      accuracy: 5,
      speed: 1,
      t: 1_000 + index * 1_000,
    }));
    fetchMock.mockImplementation((url: string) => Promise.resolve(fakeEchoResponse(url, 0.99)));
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const directions = result.points.slice(1).map((point, index) => (
      Math.sign(point.lng - result.points[index].lng)
    )).filter(direction => direction !== 0);
    const directionRuns = directions.filter((direction, index) => index === 0 || direction !== directions[index - 1]);
    expect(directionRuns).toEqual([1, -1, 1]);
    expect(result.stats).toMatchObject({ chunksOk: 1, chunksFallback: 0, seamBridges: 0 });
    expect(result.stats.resampledPointCount).toBeLessThan(raw.length);
  });
});

// === LOST run handling =====================================================

describe('snapTrack — LOST run handling', () => {
  test('unknown native speed remains eligible when accuracy is trustworthy', async () => {
    const unknownSpeed: RawPoint[] = lineNorth(10).map((p) => ({ ...p, speed: -1 }));
    fetchMock.mockResolvedValue(fakeOkResponse(10, 0.9));
    const r = await snapTrack(unknownSpeed, { mapboxToken: 'x' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.stats.lostRuns).toBe(0);
    expect(r.stats.goodRuns).toBe(1);
    expect(r.stats.apiCalls).toBe(1);
  });

  test('mixed run: good + lost segments → only good sent to Mapbox', async () => {
    // 5 good followed by 5 lost
    const good = lineNorth(5).map((p) => ({ ...p, speed: 1 }));
    const lostBase = lineNorth(5);
    // shift lost segment so concat makes sense
    const lost = lostBase.map((p) => ({
      ...p,
      lat: p.lat + 200 / 111_320,
      accuracy: 50,
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
    // Output is the exact canonical fallback — non-empty.
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

  test('geometry without tracepoint provenance cannot own a whole chunk', async () => {
    const raw = lineNorth(5);
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [{
          confidence: 0.99,
          geometry: { coordinates: raw.map(point => [point.lng, point.lat]) },
        }],
      }),
    });
    const result = await snapTrack(raw, { mapboxToken: 'x' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stats).toMatchObject({ matchedIslandCount: 0, chunksOk: 0, chunksFallback: 1 });
    expect(result.points).toEqual(raw.map(point => ({ lat: point.lat, lng: point.lng, alt: point.alt })));
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

  test('LOST run alt is preserved by exact canonical fallback', async () => {
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

describe('snapTrack — cross-run splice remains canonical', () => {
  test('GOOD-LOST-GOOD never inserts an invented connector', async () => {
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
    expect(r.stats.seamBridges).toBe(0);
    expect(r.points).toHaveLength(seg1.length + seg2.length + seg3.length);
    expect(r.points[seg1.length]).toMatchObject({ lat: seg2[0].lat, lng: seg2[0].lng });
  });
});
