import {
  createSnapLabCassetteTransport,
  createSnapLabLiveTransport,
  sanitizeSnapLabRequestUrl,
  snapLabRequestFingerprint,
} from '../snapLabTransport';

describe('Snap Lab exact-identity transport', () => {
  const realUrl = 'https://api.mapbox.com/matching/v5/mapbox/walking/174.000000,-41.000000;174.001000,-41.000000?geometries=geojson&access_token=pk.secret-never-record';
  const sanitizedUrl = sanitizeSnapLabRequestUrl(realUrl);
  const requestFingerprint = snapLabRequestFingerprint('GET', realUrl);

  test('replays only the exact sanitized request and never retains a token', async () => {
    const transport = createSnapLabCassetteTransport([{
      requestFingerprint,
      method: 'GET',
      sanitizedUrl,
      status: 200,
      body: { code: 'Ok', tracepoints: [], matchings: [] },
      provenance: 'CAPTURED_REAL_RESPONSE',
    }]);
    const response = await transport.fetch(realUrl);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ code: 'Ok', tracepoints: [], matchings: [] });
    expect(JSON.stringify(transport.receipts())).not.toContain('pk.secret');
    expect(transport.receipts()[0]).toMatchObject({
      requestFingerprint,
      matched: true,
      provenance: 'CAPTURED_REAL_RESPONSE',
    });
  });

  test('request drift is a recorded hard miss, not a network fallback', async () => {
    const transport = createSnapLabCassetteTransport([{
      requestFingerprint,
      method: 'GET',
      sanitizedUrl,
      status: 200,
      body: { code: 'Ok' },
      provenance: 'DETERMINISTIC_TRANSPORT',
    }]);
    await expect(transport.fetch(`${realUrl}&radiuses=8;8`)).rejects.toThrow('snap_lab_cassette_miss');
    expect(transport.receipts().at(-1)).toMatchObject({
      matched: false,
      status: null,
      provenance: 'NO_CASSETTE_MATCH',
    });
  });

  test('a cassette with a mismatched fingerprint is rejected before execution', () => {
    expect(() => createSnapLabCassetteTransport([{
      requestFingerprint: 'snap-http-v1-deadbeef',
      method: 'GET',
      sanitizedUrl,
      status: 200,
      body: {},
      provenance: 'DETERMINISTIC_TRANSPORT',
    }])).toThrow('snap_lab_cassette_identity_mismatch');
  });
});

describe('Snap Lab live-response boundary', () => {
  const isolatedUrl = 'https://api.mapbox.com/matching/v5/mapbox/walking/174.000000,-41.000000;174.001000,-41.000000?geometries=geojson&access_token=snap-lab-isolated-authority';

  afterEach(() => jest.restoreAllMocks());

  test('allows only the walking navigation placeholder request and sanitizes its receipt', async () => {
    const body = { code: 'Ok', tracepoints: [], matchings: [] };
    const response = {
      ok: true,
      status: 200,
      clone: () => ({ json: async () => body }),
      json: async () => body,
    } as unknown as Response;
    const network = jest.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const transport = createSnapLabLiveTransport();
    expect(await transport.fetch(isolatedUrl)).toBe(response);
    expect(network).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(transport.receipts())).not.toContain('snap-lab-isolated-authority');
    expect(transport.receipts()[0]).toMatchObject({
      endpoint: 'matching',
      matched: true,
      status: 200,
      responseCode: 'Ok',
      provenance: 'LIVE_MAPBOX_RESPONSE',
    });
  });

  test.each([
    'https://example.com/matching/v5/mapbox/walking/1,1;2,2?access_token=snap-lab-isolated-authority',
    'https://api.mapbox.com/styles/v1/mapbox/outdoors-v12?access_token=snap-lab-isolated-authority',
    'https://api.mapbox.com/matching/v5/mapbox/walking/1,1;2,2?access_token=pk.real-token',
  ])('rejects requests outside the credential and endpoint boundary: %s', async url => {
    const network = jest.spyOn(globalThis, 'fetch');
    await expect(createSnapLabLiveTransport().fetch(url)).rejects.toThrow(/snap_lab_live_/);
    expect(network).not.toHaveBeenCalled();
  });
});
