import { createSnapLabSyntheticGraphTransport } from '../snapLabSyntheticTransport';

const map = {
  paths: [{
    id: 'footpath',
    name: 'Supported footpath',
    kind: 'pedestrian',
    coordinates: [
      { lat: -43.5321, lng: 172.6362 },
      { lat: -43.5321, lng: 172.6422 },
    ],
  }],
};

const matchingUrl = [
  'https://api.mapbox.com/matching/v5/mapbox/walking/',
  '172.636200,-43.532090;172.638000,-43.532110;172.640000,-43.532090',
  '?geometries=geojson&radiuses=12;12;12&access_token=snap-lab-isolated-authority',
].join('');

describe('Snap Lab deterministic synthetic HTTP boundary', () => {
  test('derives a Mapbox-shaped Matching response from only request evidence and available map', async () => {
    const transport = createSnapLabSyntheticGraphTransport({
      caseId: 'SL01',
      profileId: 'primary',
      scenario: 'mapped corridor',
      map,
    });
    const response = await transport.fetch(matchingUrl);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.code).toBe('Ok');
    expect(body.tracepoints).toHaveLength(3);
    expect(body.matchings[0].confidence).toBeGreaterThan(0.5);
    expect(transport.receipts()).toEqual([
      expect.objectContaining({
        endpoint: 'matching',
        requestOrdinal: 1,
        matched: true,
        status: 200,
        provenance: 'DETERMINISTIC_TRANSPORT',
      }),
    ]);
    expect(JSON.stringify(transport.receipts())).not.toContain('snap-lab-isolated-authority');
  });

  test('parallel-road control retains provider ambiguity and can force low confidence', async () => {
    const transport = createSnapLabSyntheticGraphTransport({
      caseId: 'SL13',
      profileId: 'adversarial',
      scenario: 'parallel road ambiguity',
      forceLowMatchingConfidence: true,
      map: {
        paths: [
          map.paths[0],
          {
            ...map.paths[0],
            id: 'parallel',
            name: 'Competing parallel road',
            coordinates: map.paths[0].coordinates.map(point => ({ ...point, lat: point.lat + 0.00004 })),
          },
        ],
      },
    });
    const body = await (await transport.fetch(matchingUrl)).json();
    expect(body.matchings[0].confidence).toBe(0.18);
    expect(body.tracepoints.every((tracepoint: any) => tracepoint.alternatives_count > 0)).toBe(true);
  });

  test('available-map barrier withholds only projections that cross the wall', async () => {
    const transport = createSnapLabSyntheticGraphTransport({
      caseId: 'SL10',
      profileId: 'primary',
      scenario: 'internal path beside inaccessible arterial',
      map: {
        paths: [{
          id: 'arterial',
          name: 'Arterial behind wall',
          kind: 'arterial',
          coordinates: [
            { lat: -43.53211, lng: 172.6362 },
            { lat: -43.53211, lng: 172.6422 },
          ],
        }],
        barriers: [{
          id: 'wall',
          kind: 'impermeable-wall',
          from: { lat: -43.53205, lng: 172.6370 },
          to: { lat: -43.53205, lng: 172.6414 },
        }],
      },
    });
    const url = [
      'https://api.mapbox.com/matching/v5/mapbox/walking/',
      '172.6363,-43.5320;172.6366,-43.5320;172.6380,-43.5320;172.6416,-43.5320;172.6419,-43.5320',
      '?geometries=geojson&radiuses=18;18;18;18;18&access_token=snap-lab-isolated-authority',
    ].join('');
    const body = await (await transport.fetch(url)).json();
    expect(body.tracepoints[0]).not.toBeNull();
    expect(body.tracepoints[1]).not.toBeNull();
    expect(body.tracepoints[2]).toBeNull();
    expect(body.tracepoints[3]).not.toBeNull();
    expect(body.tracepoints[4]).not.toBeNull();
  });

  test.each([
    ['timeout', null, 'TIMEOUT'],
    ['nomatch', 200, 'NO_MATCH'],
    ['auth-then-unavailable', 401, 'AUTH'],
  ] as const)('records bounded %s outcomes without network fallthrough', async (failureMode, status, category) => {
    const transport = createSnapLabSyntheticGraphTransport({
      caseId: 'SL21',
      profileId: 'primary',
      scenario: 'failure matrix',
      map,
      failureMode,
    });
    if (failureMode === 'timeout') {
      await expect(transport.fetch(matchingUrl)).rejects.toMatchObject({ name: 'AbortError' });
    } else {
      expect((await transport.fetch(matchingUrl)).status).toBe(status);
    }
    expect(transport.receipts()[0]).toMatchObject({ status, errorCategory: category });
  });
});
