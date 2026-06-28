/**
 * useMapZoom — shared reanimated value for current map zoom, driven by
 * MemoryMap's <MapView onCameraChanged>. Pin components subscribe via
 * useMapZoomShared() and animate transform:scale on the UI thread.
 *
 * v386: replaces SymbolLayer GL-side zoom interpolation (which couldn't
 * ship because Mapbox SDK rasteriser doesn't see react-native-svg
 * content — see docs/plan/v385-sprite-zoom-research.md). Reanimated
 * shared value is purely JS, runs at 60fps on the UI thread.
 */
import { useSharedValue } from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';

// Module-level singleton so all pin components subscribe to the same value.
// Default zoom 16 = neutral scale (1.0 in the typical interpolation range).
const _zoomShared: { current: SharedValue<number> | null } = { current: null };

function getOrCreate(): SharedValue<number> {
  // Hook below initialises lazily so module load doesn't require react context.
  if (!_zoomShared.current) {
    throw new Error('useMapZoomShared: not initialised — useMapZoomProvider must mount first');
  }
  return _zoomShared.current;
}

/** Call this in the screen / map provider once. Returns the same shared value
 * across renders so updates from <MapView onCameraChanged> propagate to all
 * subscribers. */
export function useMapZoomProvider(): SharedValue<number> {
  const sv = useSharedValue<number>(16);
  if (!_zoomShared.current) _zoomShared.current = sv;
  return _zoomShared.current;
}

/** Subscribe to zoom in any component (pin etc.). */
export function useMapZoomShared(): SharedValue<number> {
  // Lazy default: if provider hasn't mounted yet (defensive), create a
  // default-16 shared value via a one-shot hook call. Components that read
  // before MemoryMap mounts will just see scale = 1.0.
  const fallback = useSharedValue<number>(16);
  if (!_zoomShared.current) _zoomShared.current = fallback;
  return _zoomShared.current;
}

/** Imperative setter — called from MapView onCameraChanged in MemoryMap. */
export function setMapZoom(z: number) {
  if (_zoomShared.current) {
    _zoomShared.current.value = z;
  }
}
