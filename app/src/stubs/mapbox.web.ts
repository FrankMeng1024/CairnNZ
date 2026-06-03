/**
 * Web stubs for native-only modules.
 * These files are resolved by metro/webpack on web platform
 * to prevent crashes from native module imports.
 *
 * Sprint 45 — STORY-00152
 */

// Stub for @rnmapbox/maps
export default {
  setAccessToken: () => {},
  setTelemetryEnabled: () => {},
};

export const MapView = null;
export const Camera = null;
export const PointAnnotation = null;
export const UserLocation = null;
export const LineLayer = null;
export const ShapeSource = null;
export const offlineManager = {
  createPack: async () => {},
  getPack: async () => null,
  getPacks: async () => [],
  deletePack: async () => {},
  subscribe: () => {},
  unsubscribe: () => {},
  invalidatePack: async () => {},
  invalidateAmbientCache: async () => {},
  clearAmbientCache: async () => {},
  setMaximumAmbientCacheSize: async () => {},
  resetDatabase: async () => {},
  migrateOfflineCache: async () => {},
  mergeOfflineRegions: async () => {},
  setTileCountLimit: () => {},
  setProgressEventThrottle: () => {},
};
