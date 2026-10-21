const mockCallbacks: Array<(observation: any) => void> = [];
const mockSubscriptions: Array<{ remove: jest.Mock }> = [];
const mockEmitter: { removeSubscription?: (subscription: { remove?: () => void }) => void } = {};
const mockWatchPositionAsync = jest.fn(async (
  _options: unknown,
  callback: (observation: any) => void,
  _onError?: unknown,
) => {
  mockCallbacks.push(callback);
  const eventSubscription = { remove: jest.fn() };
  mockSubscriptions.push(eventSubscription);
  return {
    remove: () => mockEmitter.removeSubscription?.(eventSubscription),
  };
});

jest.mock('react-native', () => ({ Platform: { OS: 'web' } }));
jest.mock('expo-location', () => ({
  EventEmitter: mockEmitter,
  watchPositionAsync: (options: unknown, callback: (observation: any) => void, onError: unknown) => (
    mockWatchPositionAsync(options, callback, onError)
  ),
}));

describe('native real location supervisor on Expo Web', () => {
  beforeEach(() => {
    mockCallbacks.length = 0;
    mockSubscriptions.length = 0;
    mockWatchPositionAsync.mockClear();
    delete mockEmitter.removeSubscription;
    jest.resetModules();
  });

  test('stops and restarts the real watcher without duplicate or stale delivery', async () => {
    const { nativeRealLocationSupervisor } = require('../nativeRealLocationSupervisor');
    const first = jest.fn();
    const second = jest.fn();

    await nativeRealLocationSupervisor.setConsumer({
      id: 'activity', ownerUserId: 'owner-web', generation: 'generation-1',
      priority: 100, options: {}, optionsKey: 'first', onObservation: first,
    });
    expect(typeof mockEmitter.removeSubscription).toBe('function');
    mockCallbacks[0]({ timestamp: 1_000, coords: { latitude: -41, longitude: 174 } });
    expect(first).toHaveBeenCalledTimes(1);

    await nativeRealLocationSupervisor.removeConsumer('activity', 'generation-1');
    expect(mockSubscriptions[0].remove).toHaveBeenCalledTimes(1);
    await nativeRealLocationSupervisor.setConsumer({
      id: 'activity', ownerUserId: 'owner-web', generation: 'generation-2',
      priority: 100, options: {}, optionsKey: 'second', onObservation: second,
    });
    mockCallbacks[0]({ timestamp: 2_000, coords: { latitude: -41, longitude: 174 } });
    mockCallbacks[1]({ timestamp: 3_000, coords: { latitude: -41, longitude: 174 } });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(mockWatchPositionAsync).toHaveBeenCalledTimes(2);
    await nativeRealLocationSupervisor.clear();
    expect(mockSubscriptions[1].remove).toHaveBeenCalledTimes(1);
  });
});
