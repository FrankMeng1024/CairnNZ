describe('passive exploration settings migration', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('an existing pre-contract payload stays review-gated instead of silently enabling encounters', async () => {
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
      memoryLocationTransitionRequired: true,
      automaticExplorationDisclosureVersion: 0,
      passiveBackgroundConsent: 'not-asked',
    });
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('recordMode');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('showFriendOverlay');

    useMemorySettingsStore.getState().set('passiveExplorationEnabled', true);
    await Promise.resolve();
    expect(JSON.parse(raw)).toMatchObject({
      passiveExplorationEnabled: true,
      passiveExplorationContractVersion: 6,
      automaticExplorationDisclosureVersion: 0,
      passiveBackgroundConsentVersion: 0,
    });
  });

  test('a prior Memory-only ON choice is review-gated for the broader encounter disclosure', async () => {
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
    expect(useMemorySettingsStore.getState().memoryLocationTransitionRequired).toBe(true);
    expect(useMemorySettingsStore.getState().automaticExplorationDisclosureVersion).toBe(0);
    expect(useMemorySettingsStore.getState().passiveBackgroundConsent).toBe('not-asked');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('recordMode');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('showFriendOverlay');
    expect(useMemorySettingsStore.getState()).not.toHaveProperty('useH3Fog');
  });

  test('a fresh install defaults automatic exploration on with current disclosure while stored OFF remains OFF', async () => {
    let raw: string | null = null;
    jest.doMock('../../../store/storage', () => ({
      storage: {
        getItem: jest.fn(async () => raw),
        setItem: jest.fn(async (_key: string, value: string) => { raw = value; }),
      },
    }));
    let module = require('../store/useMemorySettingsStore');
    await module.useMemorySettingsStore.getState().hydrate();
    expect(module.useMemorySettingsStore.getState()).toMatchObject({
      passiveExplorationEnabled: true,
      memoryLocationTransitionRequired: false,
      automaticExplorationDisclosureVersion: 1,
    });

    jest.resetModules();
    raw = JSON.stringify({
      passiveExplorationContractVersion: 5,
      passiveExplorationEnabled: false,
      memoryLocationTransitionRequired: false,
      automaticExplorationDisclosureVersion: 1,
    });
    jest.doMock('../../../store/storage', () => ({
      storage: { getItem: jest.fn(async () => raw), setItem: jest.fn(async () => undefined) },
    }));
    module = require('../store/useMemorySettingsStore');
    await module.useMemorySettingsStore.getState().hydrate();
    expect(module.useMemorySettingsStore.getState()).toMatchObject({
      passiveExplorationEnabled: false,
      memoryLocationTransitionRequired: false,
      automaticExplorationDisclosureVersion: 1,
    });
  });
});
