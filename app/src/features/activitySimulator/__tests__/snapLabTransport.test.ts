import {
  createSnapLabCassetteTransport,
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
