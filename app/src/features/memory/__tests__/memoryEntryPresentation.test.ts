import {
  MEMORY_ENTRY_MESSAGE_DELAY_MS,
  MEMORY_ENTRY_SETTLE_MS,
  memoryEntryVisibleState,
} from '../services/memoryEntryPresentation';

describe('Memory entry has one stable presentation owner', () => {
  test.each([0, 50, 150])('%d ms readiness never flashes preparing copy', readyAt => {
    expect(memoryEntryVisibleState({ elapsedMs: readyAt, hasCenter: true, mapReady: true, fogReady: true }))
      .toBe('usable-map');
  });

  test.each([250, 300, 700, 1500, 4000])('%d ms slow readiness uses the same preparing veil', elapsedMs => {
    expect(memoryEntryVisibleState({ elapsedMs, hasCenter: true, mapReady: false, fogReady: false }))
      .toBe('preparing');
  });

  test('map-before-Fog and Fog-before-map remain one placeholder/veil sequence', () => {
    expect(memoryEntryVisibleState({ elapsedMs: 300, hasCenter: true, mapReady: true, fogReady: false })).toBe('preparing');
    expect(memoryEntryVisibleState({ elapsedMs: 300, hasCenter: true, mapReady: false, fogReady: true })).toBe('preparing');
    expect(memoryEntryVisibleState({ elapsedMs: 301, hasCenter: true, mapReady: true, fogReady: true })).toBe('usable-map');
  });

  test('late readiness callbacks cannot regress a previously usable map', () => {
    expect(memoryEntryVisibleState({ elapsedMs: 900, hasCenter: true, mapReady: true, fogReady: false, wasUsable: true }))
      .toBe('usable-map');
  });

  test('documents bounded show-delay and settling fade', () => {
    expect(MEMORY_ENTRY_MESSAGE_DELAY_MS).toBe(250);
    expect(MEMORY_ENTRY_SETTLE_MS).toBeGreaterThanOrEqual(120);
    expect(MEMORY_ENTRY_SETTLE_MS).toBeLessThanOrEqual(180);
  });
});

