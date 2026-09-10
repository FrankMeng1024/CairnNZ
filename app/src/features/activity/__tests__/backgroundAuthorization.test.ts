import { refreshBackgroundAuthorization } from '../backgroundAuthorization';

describe('background location authorization refresh', () => {
  test('uses the current native grant without requesting again', async () => {
    const provider = {
      getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
      requestBackgroundPermissionsAsync: jest.fn(),
    };
    await expect(refreshBackgroundAuthorization(provider, { requestIfEligible: true })).resolves.toEqual({
      state: 'granted',
      granted: true,
      canAskAgain: true,
      requestAttempted: false,
    });
    expect(provider.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test('refresh-only lifecycle check never prompts', async () => {
    const provider = {
      getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
      requestBackgroundPermissionsAsync: jest.fn(),
    };
    await expect(refreshBackgroundAuthorization(provider, { requestIfEligible: false })).resolves.toMatchObject({
      state: 'foreground-only',
      granted: false,
      requestAttempted: false,
    });
    expect(provider.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  test('eligible foreground path requests once and returns the actual result', async () => {
    const provider = {
      getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
      requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
    };
    await expect(refreshBackgroundAuthorization(provider, { requestIfEligible: true })).resolves.toMatchObject({
      state: 'granted',
      granted: true,
      requestAttempted: true,
    });
    expect(provider.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
