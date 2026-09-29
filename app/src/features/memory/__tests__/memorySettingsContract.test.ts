describe('passive exploration settings migration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('a pre-contract always-on default is migrated to explicit opt-in OFF', async () => {
    let raw = JSON.stringify({
      foregroundAutoUnlockEnabled: true,
      recordMode: 'always',
      showFriendOverlay: true,
      firstVisitDone: true,
    });
    const setItem = jest.fn(async (_key: string, value: string) => { raw = value; });
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => raw),
        setItem,
      },
    }));

    const { useMemorySettingsStore } = require('../store/useMemorySettingsStore');
    await useMemorySettingsStore.getState().hydrate();
    expect(useMemorySettingsStore.getState()).toMatchObject({
      passiveExplorationEnabled: false,
      passiveBackgroundConsent: 'not-asked',
    });
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('recordMode');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('showFriendOverlay');

    useMemorySettingsStore.getState().set('passiveExplorationEnabled', true);
    await Promise.resolve();
    expect(JSON.parse(raw)).toMatchObject({
      passiveExplorationEnabled: true,
      passiveExplorationContractVersion: 4,
      passiveBackgroundConsentVersion: 0,
    });
  });

  test('a post-consent payload keeps the explicit foreground preference but drops legacy controls', async () => {
    const raw = JSON.stringify({
      passiveExplorationContractVersion: 1,
      foregroundAutoUnlockEnabled: true,
      recordMode: 'always',
      showFriendOverlay: true,
      firstVisitDone: false,
    });
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => raw), setItem: jest.fn(async () => undefined) },
    }));

    const { useMemorySettingsStore } = require('../store/useMemorySettingsStore');
    await useMemorySettingsStore.getState().hydrate();
    expect(useMemorySettingsStore.getState().passiveExplorationEnabled).toBe(true);
    expect(useMemorySettingsStore.getState().passiveBackgroundConsent).toBe('not-asked');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('recordMode');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('showFriendOverlay');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('useH3Fog');
  });
});
