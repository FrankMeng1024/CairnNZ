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
    await expect(searchRoutePlaces(' Wellington ', {
      token: 'pk.test', fetchImpl, proximity: { lat: -41.29, lng: 174.78 },
    })).resolves.toEqual([{
      id: 'place.1', label: 'Wellington', center: { lng: 174.7762, lat: -41.2865 },
    }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(fetchImpl.mock.calls[0][0]);
    expect(url.pathname).toBe('/search/geocode/v6/forward');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.get('q')).toBe('Wellington');
    expect(url.searchParams.get('types')).toBe('place,locality,neighborhood,street,address');
    expect(url.searchParams.get('types')).not.toContain('poi');
    expect(url.searchParams.get('proximity')).toBe('174.78,-41.29');
  });

  test('does not call the provider for an empty/one-character query', async () => {
    const fetchImpl = jest.fn();
    await expect(searchRoutePlaces('x', { token: 'pk.test', fetchImpl: fetchImpl as any })).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([401, 403])('surfaces provider authorization failure for HTTP %s', async status => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status })) as any;
    await expect(searchRoutePlaces('Auckland', { token: 'pk.test', fetchImpl }))
      .rejects.toMatchObject({ code: 'unauthorized' });
  });

  test('times out a provider request instead of leaving an infinite spinner', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })) as any;
      const promise = searchRoutePlaces('Tokyo', { token: 'pk.test', fetchImpl, timeoutMs: 250 });
      const rejection = expect(promise).rejects.toMatchObject({ code: 'timeout' });
      await jest.advanceTimersByTimeAsync(251);
      await rejection;
    } finally {
      jest.useRealTimers();
    }
  });

  test('caller cancellation is distinct from timeout and aborts the request', async () => {
    const controller = new AbortController();
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })) as any;
    const promise = searchRoutePlaces('Queenstown', { token: 'pk.test', fetchImpl, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
});
