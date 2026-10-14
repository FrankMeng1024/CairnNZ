export interface MemoryCameraPoint {
  lat: number;
  lng: number;
  ts?: number;
}

export interface MemoryCityViewport {
  center: [number, number];
  zoom: number;
  usedOwnEvidence: boolean;
}

export type MemoryEntryCameraAuthority = 'current' | 'manual-fallback' | 'preserve-manual-browse' | 'wait-for-location';

export function resolveMemoryInitialMapCenter(input: {
  authority: MemoryEntryCameraAuthority;
  current: MemoryCameraPoint | null;
  manualCenter: [number, number] | null;
  cachedMemoryCenter?: MemoryCameraPoint | null;
}): MemoryCameraPoint | null {
  if (input.authority === 'current' && input.current && valid(input.current)) return { ...input.current };
  if (input.authority === 'manual-fallback' && input.manualCenter) {
    const point = { lat: input.manualCenter[1], lng: input.manualCenter[0] };
    return valid(point) ? point : null;
  }
  // Cached account-owned Memory is presentation authority only. It lets the
  // already-hydrated map paint while a fresh device fix is pending, but the
  // caller must keep the puck hidden and must not describe this as current.
  if (input.cachedMemoryCenter && valid(input.cachedMemoryCenter)) {
    return { ...input.cachedMemoryCenter };
  }
  if (input.manualCenter) {
    const point = { lat: input.manualCenter[1], lng: input.manualCenter[0] };
    return valid(point) ? point : null;
  }
  return null;
}

export function resolveCachedMemoryCenter(
  ownEvidence: readonly MemoryCameraPoint[],
): MemoryCameraPoint | null {
  const validEvidence = ownEvidence.filter(valid);
  if (validEvidence.length === 0) return null;
  const latest = validEvidence.reduce((best, point) => (
    Number(point.ts ?? 0) >= Number(best.ts ?? 0) ? point : best
  ));
  return { ...latest };
}

export function resolveMemoryEntryCameraAuthority(input: {
  hasFreshCurrentEvidence: boolean;
  locationAttemptFailed: boolean;
  hasManualCity: boolean;
  manualBrowseThisMount: boolean;
}): MemoryEntryCameraAuthority {
  if (input.manualBrowseThisMount) return 'preserve-manual-browse';
  if (input.hasFreshCurrentEvidence) return 'current';
  if (input.locationAttemptFailed && input.hasManualCity) return 'manual-fallback';
  return 'wait-for-location';
}

const valid = (point: MemoryCameraPoint) => Number.isFinite(point.lat) && Number.isFinite(point.lng);

/** Current location and historical overview are separate camera intents. */
export function resolveCurrentLocationViewport(
  current: MemoryCameraPoint,
): MemoryCityViewport {
  if (!valid(current)) return { center: [0, 0], zoom: 14, usedOwnEvidence: false };
  return { center: [current.lng, current.lat], zoom: 16.5, usedOwnEvidence: false };
}
