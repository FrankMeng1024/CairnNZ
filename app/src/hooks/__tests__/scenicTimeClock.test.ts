let mockAppState: 'active' | 'background' | 'inactive' = 'active';
let mockAppStateListener: ((state: typeof mockAppState) => void) | null = null;
const mockRemove = jest.fn();
const mockAddEventListener = jest.fn((_event: string, listener: typeof mockAppStateListener) => {
  mockAppStateListener = listener;
  return {
    remove: () => {
      mockRemove();
      if (mockAppStateListener === listener) mockAppStateListener = null;
    },
  };
});

jest.mock('react-native', () => ({
  AppState: {
    get currentState() { return mockAppState; },
    addEventListener: (...args: Parameters<typeof mockAddEventListener>) => mockAddEventListener(...args),
  },
}));

import {
  __scenicTimeClockTest,
  subscribeScenicTimeClock,
} from '../scenicTimeClock';

describe('shared Scenic clock ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockAppState = 'active';
    mockAppStateListener = null;
    mockRemove.mockClear();
    mockAddEventListener.mockClear();
    __scenicTimeClockTest.reset();
  });

  afterEach(() => {
    __scenicTimeClockTest.reset();
    jest.useRealTimers();
  });

  test('multiple consumers share one timer/listener and the last unsubscribe releases both', () => {
    const first = jest.fn();
    const second = jest.fn();
    const unsubscribeFirst = subscribeScenicTimeClock(first);
    const unsubscribeSecond = subscribeScenicTimeClock(second);

    expect(mockAddEventListener).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(1);
    unsubscribeFirst();
    expect(jest.getTimerCount()).toBe(1);
    expect(mockRemove).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(jest.getTimerCount()).toBe(0);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  test('background releases the minute timer and active restores it once', () => {
    const unsubscribe = subscribeScenicTimeClock(jest.fn());
    expect(jest.getTimerCount()).toBe(1);
    mockAppState = 'background';
    mockAppStateListener?.('background');
    expect(jest.getTimerCount()).toBe(0);
    mockAppState = 'active';
    mockAppStateListener?.('active');
    mockAppStateListener?.('active');
    expect(jest.getTimerCount()).toBe(1);
    unsubscribe();
  });
});
