import type { FrozenMemoryCamera } from '../store/useMemoryNavigationSessionStore';

export type MemoryCameraDefaultSettings = {
  centerCoordinate: [number, number];
  zoomLevel: number;
  heading: number;
  pitch: number;
};

export type MemoryWebInitialViewState = {
  longitude: number;
  latitude: number;
  zoom: number;
  bearing: number;
  pitch: number;
};

/**
 * RNMapbox CameraStop calls map rotation `heading`. Memory deliberately keeps
 * the user-facing state name `bearing`, then maps it at this single native/Web
 * adapter boundary so a recreated map retains the full camera orientation.
 */
export function memoryCameraDefaultSettings(
  sessionCamera: FrozenMemoryCamera | null,
  fallbackCenter: [number, number],
  fallbackZoom: number,
): MemoryCameraDefaultSettings {
  return {
    centerCoordinate: sessionCamera?.center ?? fallbackCenter,
    zoomLevel: sessionCamera?.zoom ?? fallbackZoom,
    heading: sessionCamera?.bearing ?? 0,
    pitch: sessionCamera?.pitch ?? 0,
  };
}

export function memoryWebInitialViewState(
  settings: Partial<MemoryCameraDefaultSettings> | undefined,
  fallbackCenter: [number, number] | undefined,
  fallbackZoom = 12,
): MemoryWebInitialViewState {
  const center = settings?.centerCoordinate ?? fallbackCenter ?? [0, 0];
  return {
    longitude: center[0],
    latitude: center[1],
    zoom: settings?.zoomLevel ?? fallbackZoom,
    bearing: settings?.heading ?? 0,
    pitch: settings?.pitch ?? 0,
  };
}
