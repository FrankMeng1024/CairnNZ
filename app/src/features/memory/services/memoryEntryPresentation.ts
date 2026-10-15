export const MEMORY_ENTRY_MESSAGE_DELAY_MS = 250;
export const MEMORY_ENTRY_SETTLE_MS = 150;

export type MemoryEntryVisibleState = 'stable-placeholder' | 'preparing' | 'usable-map' | 'error';

export function memoryEntryVisibleState(input: {
  elapsedMs: number;
  hasCenter: boolean;
  mapReady: boolean;
  fogReady: boolean;
  fogUnavailable?: boolean;
  failed?: boolean;
  wasUsable?: boolean;
}): MemoryEntryVisibleState {
  if (input.failed) return 'error';
  if (input.wasUsable || (input.hasCenter && input.mapReady && (input.fogReady || input.fogUnavailable))) {
    return 'usable-map';
  }
  return input.elapsedMs < MEMORY_ENTRY_MESSAGE_DELAY_MS ? 'stable-placeholder' : 'preparing';
}

