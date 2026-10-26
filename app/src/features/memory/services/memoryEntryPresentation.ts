export const MEMORY_ENTRY_MESSAGE_DELAY_MS = 250;
export const MEMORY_WARM_ENTRY_MESSAGE_DELAY_MS = 1200;
export const MEMORY_ENTRY_SETTLE_MS = 150;

export type MemoryEntryVisibleState = 'stable-placeholder' | 'authorized-preview' | 'preparing' | 'usable-map' | 'error';

/**
 * A warm Fog rebuild can retain the last complete, authorized scene while a
 * newly culled viewport is prepared locally. That is render work, not a new
 * user-visible loading target. A scope/source/revision transition remains a
 * real content target and keeps its scoped status until the atomic scene swap.
 */
export function memoryFogReadinessDatasetIdentity(readinessKey: string): string {
  return readinessKey.replace(/\|viewport:[^|]*/g, '|viewport:<camera-independent>');
}

export function memoryFogTransitionIsVisiblyPending(input: {
  readinessKey: string;
  readyReadinessKey: string;
  retainsDisplayedScene: boolean;
}): boolean {
  if (input.readyReadinessKey === input.readinessKey) return false;
  if (!input.retainsDisplayedScene) return true;
  if (!input.readyReadinessKey) return false;
  return memoryFogReadinessDatasetIdentity(input.readyReadinessKey)
    !== memoryFogReadinessDatasetIdentity(input.readinessKey);
}

/** A full Mapbox frame can contain borrowed Fog, markers, and region context.
 * Warm previews are therefore captured only from an exact painted Mine scene,
 * never from combined content or a self scene that is still preparing. */
export function memoryMinePreviewCanCapture(input: {
  scope: 'self' | 'combined';
  currentReadinessKey: string;
  paintedReadinessKey: string;
}): boolean {
  return input.scope === 'self'
    && input.currentReadinessKey.length > 0
    && input.paintedReadinessKey === input.currentReadinessKey;
}

export function memoryMinePreviewCanRender(input: {
  scope: 'self' | 'combined';
  ownerId: string | null;
  themeMode: string;
  preview: { ownerId: string; scope: 'self'; themeMode: string } | null;
}): boolean {
  return input.scope === 'self'
    && Boolean(input.ownerId)
    && input.preview?.ownerId === input.ownerId
    && input.preview.scope === 'self'
    && input.preview.themeMode === input.themeMode;
}

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
