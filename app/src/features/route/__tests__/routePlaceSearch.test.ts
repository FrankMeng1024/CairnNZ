import { searchRoutePlaces } from '../routePlaceSearch';

describe('Route place search', () => {
  test('uses one bounded explicit geocoding request and accepts only valid map centers', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({ features: [
        { id: 'place.1', properties: { name_preferred: 'Wellington' }, geometry: { coordinates: [174.7762, -41.2865] } },
        { id: 'bad', properties: { name: 'Broken' }, geometry: { coordinates: [999, 999] } },
      ] }),
    })) as any;
    await expect(searchRoutePlaces(' Wellington ', { token: 'pk.test', fetchImpl })).resolves.toEqual([{
      id: 'place.1', label: 'Wellington', center: { lng: 174.7762, lat: -41.2865 },
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/search/geocode/v6/forward');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('q')).toBe('Wellington');
  });

  test('does not call the provider for an empty/one-character query', async () => {
    const fetchImpl = jest.fn();
    await expect(searchRoutePlaces('x', { token: 'pk.test', fetchImpl: fetchImpl as any })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
