const dispatcherGuardKey = Symbol('cairn-mapbox-gl2-retired-dispatcher-guard');
const mapGuardKey = Symbol('cairn-mapbox-gl2-map-lifecycle-guard');

type MapboxGl2Actor = {
  send: (...args: any[]) => { cancel: () => void };
};

type MapboxGl2Dispatcher = {
  actors?: unknown[];
  getActor?: () => MapboxGl2Actor;
  [dispatcherGuardKey]?: true;
};

type MapboxGl2Map = {
  _setCacheLimits?: (limit: number, checkThreshold: number) => void;
  style?: { dispatcher?: MapboxGl2Dispatcher };
  remove?: (...args: any[]) => unknown;
  setStyle?: (...args: any[]) => unknown;
  [mapGuardKey]?: true;
};

const retiredActor: MapboxGl2Actor = {
  // A callback that reaches this actor belongs to a Map/Style whose workers
  // have already been released. It must not re-enter the retired style.
  send: () => ({ cancel: () => {} }),
};

function guardDispatcher(dispatcher: MapboxGl2Dispatcher | undefined) {
  if (!dispatcher || dispatcher[dispatcherGuardKey] || typeof dispatcher.getActor !== 'function') {
    return false;
  }
  const originalGetActor = dispatcher.getActor;
  dispatcher.getActor = function getActiveOrRetiredActor(this: MapboxGl2Dispatcher) {
    if (Array.isArray(this.actors) && this.actors.length === 0) return retiredActor;
    return originalGetActor.call(this);
  };
  dispatcher[dispatcherGuardKey] = true;
  return true;
}

/**
 * Mapbox GL JS v2 can finish an IndexedDB-backed tile request after
 * Style#_remove has emptied its Dispatcher actors. The late cache-maintenance
 * callback then calls `getActor().send(...)` on the retired dispatcher and
 * escapes through the tile-cache Promise as `undefined.send`.
 *
 * Guard only that already-retired state. Live dispatchers still use Mapbox's
 * original actor selection, and GL3/native maps are untouched.
 */
export function guardMapboxGl2RetiredDispatcher(map: MapboxGl2Map | null | undefined) {
  // `_setCacheLimits` is the GL JS v2 boundary used by the Web adapter. Do not
  // install private-shape guards into a future GL3 map by accident.
  if (!map || typeof map._setCacheLimits !== 'function') return false;

  const guardCurrentStyle = () => guardDispatcher(map.style?.dispatcher);
  guardCurrentStyle();
  if (map[mapGuardKey]) return true;

  if (typeof map.remove === 'function') {
    const originalRemove = map.remove;
    map.remove = function guardedRemove(this: MapboxGl2Map, ...args: any[]) {
      guardCurrentStyle();
      return originalRemove.apply(this, args);
    };
  }
  if (typeof map.setStyle === 'function') {
    const originalSetStyle = map.setStyle;
    map.setStyle = function guardedSetStyle(this: MapboxGl2Map, ...args: any[]) {
      // Protect the outgoing style before Mapbox removes its workers.
      guardCurrentStyle();
      const result = originalSetStyle.apply(this, args);
      // Mapbox assigns the replacement style synchronously in v2. Protect it
      // immediately; the microtask also covers compatible deferred wrappers.
      guardCurrentStyle();
      queueMicrotask(guardCurrentStyle);
      return result;
    };
  }
  map[mapGuardKey] = true;
  return true;
}
