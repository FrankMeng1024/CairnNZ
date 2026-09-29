import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-application', () => ({}));
jest.mock('expo-updates', () => ({}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

describe('Activity stage ledger cold-restart completeness', () => {
  test('a rejected event remains explicitly partial after module recreation', async () => {
    const values = (globalThis as any).__cairnTestAsyncStorage as Map<string, string>;
    values.clear();
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => values.get(key) ?? null);
    let rejectEventOnce = true;
    (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
      if (rejectEventOnce && key.startsWith('@cairn:activity-stage-ledger:v1:')) {
        rejectEventOnce = false;
        throw new Error('synthetic-event-write-rejection');
      }
      values.set(key, value);
    });
    (AsyncStorage.getAllKeys as jest.Mock).mockImplementation(async () => [...values.keys()]);
    (AsyncStorage.multiRemove as jest.Mock).mockImplementation(async (keys: string[]) => {
      keys.forEach(key => values.delete(key));
    });

    let ledger = require('../activityStageLedger');
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ledger.recordActivityStageEvent({
      ownerUserId: 'owner-cold',
      clientActivityId: 'activity-cold',
      stage: 'provider-state',
      wallTimeMs: 10_000,
      details: { event: 'watchdog-restart' },
    });
    await ledger.flushActivityStageLedger('owner-cold');
    expect((await ledger.exportLatestActivityStageLedger('owner-cold')).diagnosticCompleteness)
      .toMatchObject({ persistence: 'partial', failedWriteCount: 1, summaryAvailable: true });
    const durableMeta = [...values.entries()].find(([key]) => (
      key.startsWith('@cairn:activity-stage-ledger-meta:v1:owner-cold')
    ));
    expect(durableMeta?.[1]).toContain('activity-cold');

    jest.resetModules();
    const restartedStorageModule = require('@react-native-async-storage/async-storage');
    const restartedStorage = restartedStorageModule.default ?? restartedStorageModule;
    restartedStorage.getItem.mockImplementation(async (key: string) => values.get(key) ?? null);
    restartedStorage.setItem.mockImplementation(async (key: string, value: string) => { values.set(key, value); });
    restartedStorage.getAllKeys.mockImplementation(async () => [...values.keys()]);
    restartedStorage.multiRemove.mockImplementation(async (keys: string[]) => {
      keys.forEach(key => values.delete(key));
    });
    expect(await restartedStorage.getItem(durableMeta![0])).toContain('activity-cold');
    ledger = require('../activityStageLedger');
    const afterRestart = await ledger.exportLatestActivityStageLedger('owner-cold');
    expect(afterRestart.events).toHaveLength(0);
    expect(afterRestart.clientActivityId).toBe('activity-cold');
    expect(afterRestart.phaseSummary).toMatchObject({
      clientActivityId: 'activity-cold', capturedEventCount: 1,
      stages: { 'provider-state': expect.objectContaining({ count: 1 }) },
    });
    expect(afterRestart.diagnosticCompleteness).toMatchObject({
      persistence: 'partial',
      summaryAvailable: true,
      failedWriteCount: 1,
      retentionTruncated: false,
    });
    warning.mockRestore();
  });
});
