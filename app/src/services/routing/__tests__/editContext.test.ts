/**
 * editContext unit tests.
 *
 * Verifies buildEditContext behavior with the Mapbox vector tile pipeline.
 * Mocks loadExtras (LocalRouteExtras) and the Mapbox extractor to assert
 * the wiring without touching real Mapbox SDK or AsyncStorage.
 */

import { buildEditContext } from '../editContext';

// Mock LocalRouteExtras — provides originalPoints.
jest.mock('../../LocalRouteExtras', () => ({
  loadExtras: jest.fn(),
}));

// Mock the extractor — controls whether trailGraph populates.
jest.mock('../mapbox/MapboxJunctionExtractor', () => ({
  extractJunctions: jest.fn(),
}));

// Mock the adapter — assert it's called with extractor's result.
jest.mock('../mapbox/buildTrailGraphFromMapbox', () => ({
  buildTrailGraphFromMapbox: jest.fn(),
}));

const { loadExtras } = require('../../LocalRouteExtras');
const { extractJunctions } = require('../mapbox/MapboxJunctionExtractor');
const {
  buildTrailGraphFromMapbox,
} = require('../mapbox/buildTrailGraphFromMapbox');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildEditContext', () => {
  it('returns null when extras missing', async () => {
    loadExtras.mockResolvedValue(null);
    const result = await buildEditContext('route-x', { current: {} });
    expect(result).toBeNull();
  });

  it('returns null when originalPoints < 2', async () => {
    loadExtras.mockResolvedValue({ originalPoints: [{ lng: 0, lat: 0 }] });
    const result = await buildEditContext('route-x', { current: {} });
    expect(result).toBeNull();
  });

  it('returns context with trailGraph when Mapbox extraction succeeds', async () => {
    loadExtras.mockResolvedValue({
      originalPoints: [
        { lng: 174.78, lat: -41.3 },
        { lng: 174.79, lat: -41.3 },
      ],
    });
    const fakeWays = [
      {
        id: 'mw_1',
        klass: 'path',
        coords: [
          { lng: 174.78, lat: -41.3 },
          { lng: 174.79, lat: -41.3 },
        ],
      },
    ];
    extractJunctions.mockResolvedValue({
      ok: true,
      junctions: [],
      ways: fakeWays,
      diagnostics: { rawFeatureCount: 1, rawVertexCount: 2, extractMs: 5, bboxArea: 0 },
    });
    const fakeGraph: any = { nodes: new Map(), meta: new Map(), truncated: false };
    buildTrailGraphFromMapbox.mockReturnValue(fakeGraph);

    const result = await buildEditContext('route-x', { current: {} });
    expect(result).not.toBeNull();
    expect(result!.trailGraph).toBe(fakeGraph);
    expect(buildTrailGraphFromMapbox).toHaveBeenCalledTimes(1);
    // walkedIndex includes both originalPoints AND mapbox-derived points.
    // We can't read kdbush internals, but we can confirm the index exists.
    expect(result!.walkedIndex).toBeDefined();
  });

  it('returns null trailGraph when extractor reports zoom-too-low', async () => {
    loadExtras.mockResolvedValue({
      originalPoints: [
        { lng: 174.78, lat: -41.3 },
        { lng: 174.79, lat: -41.3 },
      ],
    });
    extractJunctions.mockResolvedValue({
      ok: false,
      error: 'zoom-too-low',
    });

    const result = await buildEditContext('route-x', { current: {} });
    expect(result).not.toBeNull();
    expect(result!.trailGraph).toBeNull();
    expect(buildTrailGraphFromMapbox).not.toHaveBeenCalled();
  });

  it('returns null trailGraph when extractor reports no-features', async () => {
    loadExtras.mockResolvedValue({
      originalPoints: [
        { lng: 174.78, lat: -41.3 },
        { lng: 174.79, lat: -41.3 },
      ],
    });
    extractJunctions.mockResolvedValue({ ok: false, error: 'no-features' });

    const result = await buildEditContext('route-x', { current: {} });
    expect(result).not.toBeNull();
    expect(result!.trailGraph).toBeNull();
  });

  it('returns null trailGraph when mapRef is absent', async () => {
    loadExtras.mockResolvedValue({
      originalPoints: [
        { lng: 174.78, lat: -41.3 },
        { lng: 174.79, lat: -41.3 },
      ],
    });

    const result = await buildEditContext('route-x', null);
    expect(result).not.toBeNull();
    expect(result!.trailGraph).toBeNull();
    expect(extractJunctions).not.toHaveBeenCalled();
  });

  it('returns null trailGraph when extractor throws unexpectedly', async () => {
    loadExtras.mockResolvedValue({
      originalPoints: [
        { lng: 174.78, lat: -41.3 },
        { lng: 174.79, lat: -41.3 },
      ],
    });
    extractJunctions.mockRejectedValue(new Error('boom'));

    const result = await buildEditContext('route-x', { current: {} });
    expect(result).not.toBeNull();
    expect(result!.trailGraph).toBeNull();
  });
});
