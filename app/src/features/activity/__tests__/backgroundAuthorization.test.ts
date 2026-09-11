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
      requestResult: 'not-attempted',
      settingsRequired: false,
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

  test('native canAskAgain=false routes to Settings without opening another prompt loop', async () => {
    const provider = {
      getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: false })),
      requestBackgroundPermissionsAsync: jest.fn(),
    };
    await expect(refreshBackgroundAuthorization(provider, { requestIfEligible: true })).resolves.toMatchObject({
      state: 'foreground-only',
      granted: false,
      canAskAgain: false,
      requestAttempted: false,
      requestResult: 'not-attempted',
      settingsRequired: true,
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
      requestResult: 'granted',
      settingsRequired: false,
    });
    expect(provider.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('BACKGROUND_PERMISSION_EDUCATION_SUPPRESSION: eligibility follows native state, not education history', async () => {
    const provider = {
      getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
      requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'denied', canAskAgain: true })),
    };
    // The education flag deliberately is not an input to permission authority.
    // An Activity Start asks once whenever current native state permits it.
    await expect(refreshBackgroundAuthorization(provider, { requestIfEligible: true })).resolves.toMatchObject({
      granted: false,
      requestAttempted: true,
      requestResult: 'denied',
      settingsRequired: true,
    });
    expect(provider.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  });
});
