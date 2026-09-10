import { resolveMapboxPublicToken, resolveMapboxPublicTokenAuthority } from '../mapbox';

describe('Mapbox public token authority', () => {
  test('reuses the configured native singleton token without exposing it', async () => {
    const token = `pk.${'a'.repeat(48)}`;
    const nativeModule = { getAccessToken: jest.fn(async () => token) };
    await expect(resolveMapboxPublicToken(nativeModule)).resolves.toBe(token);
    expect(nativeModule.getAccessToken).toHaveBeenCalledTimes(1);
  });

  test('rejects missing or non-public native credentials', async () => {
    await expect(resolveMapboxPublicToken({ getAccessToken: async () => '' })).resolves.toBe('');
    await expect(resolveMapboxPublicToken({ getAccessToken: async () => `sk.${'x'.repeat(48)}` })).resolves.toBe('');
  });

  test('reports the authority type without logging or returning a second token', async () => {
    const token = 'pk.' + 'b'.repeat(48);
    await expect(resolveMapboxPublicTokenAuthority({ getAccessToken: async () => token })).resolves.toEqual({
      token,
      source: 'native-mapbox-singleton',
    });
    await expect(resolveMapboxPublicTokenAuthority({ getAccessToken: async () => '' })).resolves.toEqual({
      token: '',
      source: 'unavailable',
    });
  });
});
