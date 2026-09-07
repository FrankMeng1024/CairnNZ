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
      useH3Fog: true,
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
      foregroundAutoUnlockEnabled: false,
      recordMode: 'session-only',
    });

    useMemorySettingsStore.getState().set('foregroundAutoUnlockEnabled', true);
    await Promise.resolve();
    expect(JSON.parse(raw)).toMatchObject({
      foregroundAutoUnlockEnabled: true,
      passiveExplorationContractVersion: 1,
    });
  });
});
