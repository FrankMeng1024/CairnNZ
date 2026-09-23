describe('planWalkingRoute', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  function loadWithToken(token: string) {
    jest.doMock('../../../config/mapbox', () => ({
      resolveMapboxPublicToken: jest.fn(async () => token),
    }));
    return require('../planWalkingRoute') as typeof import('../planWalkingRoute');
  }

  test('requests a walking route and preserves the service geometry order', async () => {
    const { planWalkingRoute } = loadWithToken(`pk.${'a'.repeat(48)}`);
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        routes: [{ geometry: { coordinates: [[174.76, -36.85], [174.77, -36.84], [174.78, -36.83]] } }],
      }),
    }));
    global.fetch = fetchMock as any;

    await expect(planWalkingRoute(
      { lat: -36.85, lng: 174.76 },
      { lat: -36.83, lng: 174.78 },
    )).resolves.toEqual([
      { lat: -36.85, lng: 174.76 },
      { lat: -36.84, lng: 174.77 },
      { lat: -36.83, lng: 174.78 },
    ]);

    const url = String((fetchMock as jest.Mock).mock.calls[0]?.[0]);
    expect(url).toContain('/directions/v5/mapbox/walking/174.76,-36.85;174.78,-36.83');
    expect(url).toContain('geometries=geojson');
  });

  test('fails explicitly when no configured Mapbox authority exists', async () => {
    const { planWalkingRoute, WalkingPlanError } = loadWithToken('');
    await expect(planWalkingRoute(
      { lat: -36.85, lng: 174.76 },
      { lat: -36.83, lng: 174.78 },
    )).rejects.toEqual(expect.objectContaining<Partial<InstanceType<typeof WalkingPlanError>>>({ code: 'NO_TOKEN' }));
  });

  test('does not turn a missing or malformed route into a fabricated draft', async () => {
    const { planWalkingRoute } = loadWithToken(`pk.${'b'.repeat(48)}`);
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ routes: [{ geometry: { coordinates: [[174.76, -36.85]] } }] }),
    })) as any;

    await expect(planWalkingRoute(
      { lat: -36.85, lng: 174.76 },
      { lat: -36.83, lng: 174.78 },
    )).rejects.toEqual(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
  });
});
