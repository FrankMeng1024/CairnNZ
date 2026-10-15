export const MEMORY_ENTRY_MESSAGE_DELAY_MS = 250;
export const MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS = 1200;
export const MEMORY_ENTRY_SETTLE_MS = 150;

export type MemoryEntryVisibleState = 'stable-placeholder' | 'authorized-preview' | 'preparing' | 'usable-map' | 'error';

export function memoryEntryVisibleState(input: {
  elapsedMs: number;
  hasCenter: boolean;
  mapReady: boolean;
  fogReady: boolean;
  fogUnavailable?: boolean;
  failed?: boolean;
  wasUsable?: boolean;
  hasAuthorizedPreview?: boolean;
}): MemoryEntryVisibleState {
  if (input.failed) return 'error';
  if (input.wasUsable || (input.hasCenter && input.mapReady && (input.fogReady || input.fogUnavailable))) {
    return 'usable-map';
  }
  if (input.hasAuthorizedPreview && input.elapsedMs < MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS) return 'authorized-preview';
  return input.elapsedMs < MEMORY_ENTRY_MESSAGE_DELAY_MS ? 'stable-placeholder' : 'preparing';
}
