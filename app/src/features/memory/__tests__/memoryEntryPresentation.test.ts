import {
  MEMORY_ENTRY_MESSAGE_DELAY_MS,
  MEMORY_ENTRY_SETTLE_MS,
  MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS,
  memoryEntryVisibleState,
  memoryMinePreviewCanCapture,
  memoryMinePreviewCanRender,
} from '../services/memoryEntryPresentation';

describe('Memory entry has one stable presentation owner', () => {
  test.each([0, 50, 150])('%d ms readiness never flashes preparing copy', readyAt => {
    expect(memoryEntryVisibleState({ elapsedMs: readyAt, hasCenter: true, mapReady: true, fogReady: true }))
      .toBe('usable-map');
  });

  test.each([250, 400, 700, 1000, 2000, 4000])('%d ms cold readiness uses the same preparing veil', elapsedMs => {
    expect(memoryEntryVisibleState({ elapsedMs, hasCenter: true, mapReady: false, fogReady: false }))
      .toBe('preparing');
  });

  test.each([0, 50, 150, 250, 400, 700, 1000])('%d ms warm entry keeps authorized content instead of Preparing', elapsedMs => {
    expect(memoryEntryVisibleState({
      elapsedMs, hasCenter: true, mapReady: false, fogReady: false, hasAuthorizedPreview: true,
    })).toBe('authorized-preview');
  });

  test('a genuinely slow warm render eventually gains one loading message without changing shells', () => {
    expect(memoryEntryVisibleState({
      elapsedMs: MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS,
      hasCenter: true, mapReady: false, fogReady: false, hasAuthorizedPreview: true,
    })).toBe('preparing');
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
    expect(MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS).toBe(1200);
    expect(MEMORY_ENTRY_SETTLE_MS).toBeGreaterThanOrEqual(120);
    expect(MEMORY_ENTRY_SETTLE_MS).toBeLessThanOrEqual(180);
  });

  test('warm preview capture is Mine-only and requires the exact painted Fog scene', () => {
    expect(memoryMinePreviewCanCapture({
      scope: 'self', currentReadinessKey: 'self-v2', paintedReadinessKey: 'self-v2',
    })).toBe(true);
    expect(memoryMinePreviewCanCapture({
      scope: 'combined', currentReadinessKey: 'combined-v2', paintedReadinessKey: 'combined-v2',
    })).toBe(false);
    expect(memoryMinePreviewCanCapture({
      scope: 'self', currentReadinessKey: 'self-v2', paintedReadinessKey: 'combined-v1',
    })).toBe(false);
    expect(memoryMinePreviewCanCapture({
      scope: 'self', currentReadinessKey: '', paintedReadinessKey: '',
    })).toBe(false);
  });

  test('a Mine preview never renders for combined scope or another account/theme', () => {
    const preview = { ownerId: 'viewer-a', scope: 'self' as const, themeMode: 'day' };
    expect(memoryMinePreviewCanRender({
      scope: 'self', ownerId: 'viewer-a', themeMode: 'day', preview,
    })).toBe(true);
    expect(memoryMinePreviewCanRender({
      scope: 'combined', ownerId: 'viewer-a', themeMode: 'day', preview,
    })).toBe(false);
    expect(memoryMinePreviewCanRender({
      scope: 'self', ownerId: 'viewer-b', themeMode: 'day', preview,
    })).toBe(false);
    expect(memoryMinePreviewCanRender({
      scope: 'self', ownerId: 'viewer-a', themeMode: 'night', preview,
    })).toBe(false);
  });
});
