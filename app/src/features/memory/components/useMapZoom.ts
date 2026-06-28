/**
 * useMapZoom — JS-side zoom store driven by MemoryMap onCameraChanged.
 * Pin components subscribe via useMapZoom() and re-render with new
 * size/scale values.
 *
 * v387 change vs v386: dropped reanimated UI-thread shared value path
 * because PointAnnotation on iOS appears to not honor RN transform on
 * its child View (host annotation view manages its own frame, child
 * transform is silently ignored). useState-driven re-render is
 * slower but reliably visible.
 *
 * Throttled to ~10Hz via lastSetRef so 60fps onCameraChanged events
 * don't trigger 60 re-renders per second. 100ms feels live during
 * pinch and is well within React batching tolerance.
 */
import { useSyncExternalStore } from 'react';

let _zoom = 16;
let _lastSetAt = 0;
const THROTTLE_MS = 100;
const _listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

function getSnapshot() {
  return _zoom;
}

/** React hook — re-renders the calling component when zoom changes. */
export function useMapZoom(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Imperative setter — called from MapView onCameraChanged. Throttled. */
export function setMapZoom(z: number) {
  if (typeof z !== 'number' || Number.isNaN(z)) return;
  const now = Date.now();
  if (now - _lastSetAt < THROTTLE_MS && Math.abs(z - _zoom) < 0.5) return;
  _lastSetAt = now;
  _zoom = z;
  _listeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

// Kept for backward compat with v386 imports if any.
// Returns nothing useful — components should switch to useMapZoom().
export function useMapZoomShared() {
  // Stub: returns a fake shared value compatible object.
  return { value: _zoom };
}
export function useMapZoomProvider() {
  // No-op now that store is module-level.
  return { value: _zoom };
}
