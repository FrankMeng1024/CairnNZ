export const OFFLINE_MAP_PACK_PREFIX = 'cairn-offline-v1-';
export const OFFLINE_MAP_MIN_ZOOM = 10;
export const OFFLINE_MAP_MAX_ZOOM = 15;
export const OFFLINE_MAP_RADIUS_OPTIONS_KM = [2, 5, 10] as const;

export type OfflineMapCenter = { lat: number; lng: number };
export type OfflineMapBounds = {
  northEast: [number, number];
  southWest: [number, number];
};

export type OfflineMapPackStatus = {
  name: string;
  state: number | null;
  percentage: number;
  completedResourceSize: number | null;
  completedTileCount: number | null;
  completedResourceCount: number | null;
  requiredResourceCount: number | null;
};

export type OfflineMapPackRecord = OfflineMapPackStatus & {
  center: OfflineMapCenter | null;
  radiusKm: number | null;
  minZoom: number | null;
  maxZoom: number | null;
  createdAt: number | null;
};

export type OfflineMapPackDraft = {
  center: OfflineMapCenter;
  radiusKm: number;
  minZoom?: number;
  maxZoom?: number;
};

export function offlineMapsFeatureEnabled(envValue = process.env.EXPO_PUBLIC_OFFLINE_MAPS_ENABLED): boolean {
  return envValue?.trim().toLowerCase() === 'true';
}

function finiteInRange(value: number, min: number, max: number, label: string): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} is outside the supported range.`);
  }
  return value;
}

export function validateOfflineMapDraft(draft: OfflineMapPackDraft): Required<OfflineMapPackDraft> {
  const lat = finiteInRange(draft.center.lat, -85, 85, 'Latitude');
  const lng = finiteInRange(draft.center.lng, -180, 180, 'Longitude');
  const radiusKm = finiteInRange(draft.radiusKm, 1, 10, 'Coverage radius');
  const minZoom = finiteInRange(draft.minZoom ?? OFFLINE_MAP_MIN_ZOOM, 0, 22, 'Minimum zoom');
  const maxZoom = finiteInRange(draft.maxZoom ?? OFFLINE_MAP_MAX_ZOOM, 0, 22, 'Maximum zoom');
  if (maxZoom < minZoom) throw new Error('Maximum zoom must not be lower than minimum zoom.');
  return { center: { lat, lng }, radiusKm, minZoom, maxZoom };
}

export function offlineMapBounds(draft: OfflineMapPackDraft): OfflineMapBounds {
  const value = validateOfflineMapDraft(draft);
  const latDelta = value.radiusKm / 111.32;
  const lngDelta = value.radiusKm / (111.32 * Math.max(0.2, Math.cos(value.center.lat * Math.PI / 180)));
  return {
    northEast: [Math.min(180, value.center.lng + lngDelta), Math.min(85, value.center.lat + latDelta)],
    southWest: [Math.max(-180, value.center.lng - lngDelta), Math.max(-85, value.center.lat - latDelta)],
  };
}

export function offlineMapBoundaryFeature(draft: OfflineMapPackDraft) {
  const { northEast, southWest } = offlineMapBounds(draft);
  const [east, north] = northEast;
  const [west, south] = southWest;
  return {
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'Polygon' as const,
      coordinates: [[
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ]],
    },
  };
}

export function makeOfflineMapPackName(now = Date.now()): string {
  return `${OFFLINE_MAP_PACK_PREFIX}${now.toString(36)}`;
}

export function isCairnOfflineMapPack(name: unknown): name is string {
  return typeof name === 'string' && name.startsWith(OFFLINE_MAP_PACK_PREFIX);
}

export function formatOfflineMapBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return 'Size unavailable';
  if (value < 1024) return `${Math.round(value)} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
