const mockLog = jest.fn();

jest.mock('../appLog', () => ({ log: (...args: unknown[]) => mockLog(...args) }));

import {
  __memorySyncDiagnosticNoiseTest,
  flushMemorySyncAttachSkipSummary,
  recordMemorySyncAttachSkip,
} from '../memorySyncDiagnosticNoise';

describe('Memory attach-skip diagnostic coalescing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLog.mockClear();
    __memorySyncDiagnosticNoiseTest.reset();
  });

  afterEach(() => {
    __memorySyncDiagnosticNoiseTest.reset();
    jest.useRealTimers();
  });

  test('retains the first event and an exact bounded-count summary', () => {
    for (let index = 0; index < __memorySyncDiagnosticNoiseTest.SUMMARY_MAX_OCCURRENCES; index += 1) {
      recordMemorySyncAttachSkip('same-user-already-attached', 1_000 + index);
    }

    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog.mock.calls[0]).toEqual([
      'memory_sync.attach_skip',
      { reason: 'same-user-already-attached', coalescing: 'first-in-window' },
    ]);
    expect(mockLog.mock.calls[1]).toEqual([
      'memory_sync.attach_skip_summary',
      expect.objectContaining({
        trigger: 'bounded-count',
        occurrences: __memorySyncDiagnosticNoiseTest.SUMMARY_MAX_OCCURRENCES,
        suppressed_occurrences: __memorySyncDiagnosticNoiseTest.SUMMARY_MAX_OCCURRENCES - 1,
        window_ms: __memorySyncDiagnosticNoiseTest.SUMMARY_MAX_OCCURRENCES - 1,
      }),
    ]);
  });

  test('detach flushes the exact tail without changing Memory state', () => {
    recordMemorySyncAttachSkip(undefined, 4_000);
    recordMemorySyncAttachSkip(undefined, 4_250);
    recordMemorySyncAttachSkip(undefined, 4_900);
    flushMemorySyncAttachSkipSummary('detach');

    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog.mock.calls[1]).toEqual([
      'memory_sync.attach_skip_summary',
      expect.objectContaining({
        trigger: 'detach',
        occurrences: 3,
        suppressed_occurrences: 2,
        window_ms: 900,
      }),
    ]);
  });

  test('a time-window summary preserves the suppressed count', () => {
    recordMemorySyncAttachSkip(undefined, 10_000);
    recordMemorySyncAttachSkip(undefined, 10_100);
    recordMemorySyncAttachSkip(undefined, 10_200);
    jest.advanceTimersByTime(__memorySyncDiagnosticNoiseTest.SUMMARY_WINDOW_MS);

    expect(mockLog).toHaveBeenCalledTimes(2);
    expect(mockLog.mock.calls[1]).toEqual([
      'memory_sync.attach_skip_summary',
      expect.objectContaining({
        trigger: 'time-window',
        occurrences: 3,
        suppressed_occurrences: 2,
        window_ms: 200,
      }),
    ]);
  });
});
