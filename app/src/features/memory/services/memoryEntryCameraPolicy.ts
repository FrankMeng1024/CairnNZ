export interface MemoryCameraPoint {
  lat: number;
  lng: number;
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
}): MemoryCameraPoint | null {
  if (input.authority === 'current' && input.current && valid(input.current)) return { ...input.current };
  if (input.authority === 'manual-fallback' && input.manualCenter) {
    const point = { lat: input.manualCenter[1], lng: input.manualCenter[0] };
    return valid(point) ? point : null;
  }
  return null;
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

/**
 * Frames current-city personal evidence without treating it as new evidence.
 * Friends are intentionally not an input to ordinary Memory entry.
 */
export function resolveCurrentCityViewport(
  current: MemoryCameraPoint,
  cityBbox: [number, number, number, number] | null,
  ownEvidence: readonly MemoryCameraPoint[],
): MemoryCityViewport {
  if (!valid(current)) return { center: [0, 0], zoom: 14, usedOwnEvidence: false };
  if (!cityBbox) return { center: [current.lng, current.lat], zoom: 14, usedOwnEvidence: false };
  const [minLng, minLat, maxLng, maxLat] = cityBbox;
  const cityEvidence = ownEvidence.filter(point => valid(point)
    && point.lat >= minLat && point.lat <= maxLat
    && point.lng >= minLng && point.lng <= maxLng);
  if (cityEvidence.length === 0) {
    return { center: [current.lng, current.lat], zoom: 14, usedOwnEvidence: false };
  }
  const framed = [...cityEvidence, current];
  const evidenceMinLat = Math.min(...framed.map(point => point.lat));
  const evidenceMaxLat = Math.max(...framed.map(point => point.lat));
  const evidenceMinLng = Math.min(...framed.map(point => point.lng));
  const evidenceMaxLng = Math.max(...framed.map(point => point.lng));
  const span = Math.max(evidenceMaxLat - evidenceMinLat, evidenceMaxLng - evidenceMinLng);
  const zoom = span > 0.3 ? 10 : span > 0.12 ? 11.5 : span > 0.04 ? 12.5 : span > 0.012 ? 13.5 : 14.5;
  return {
    center: [(evidenceMinLng + evidenceMaxLng) / 2, (evidenceMinLat + evidenceMaxLat) / 2],
    zoom,
    usedOwnEvidence: true,
  };
}
