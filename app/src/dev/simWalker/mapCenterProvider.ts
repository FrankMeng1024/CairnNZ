/**
 * mapCenterProvider — v447
 *
 * Small module-scoped registry that lets SimWalkerOverlay (a full-screen
 * floating overlay) reach into HikingScreen's MapView ref to query the
 * current viewport center.
 *
 * Why not context/prop drilling?
 *   - SimWalkerOverlay is mounted at the Screen root level, sibling to
 *     HikingMap. It has no natural access to HikingMap's private
 *     mapViewRef. Prop drilling would require lifting the ref through
 *     3+ layers and re-rendering on every camera event.
 *   - This registry is dev-only (only touched behind debugMode gates)
 *     and stays local to the simWalker directory.
 *
 * Contract:
 *   - HikingScreen registers a getter on mount, unregisters on unmount.
 *   - getter returns Promise<{lat,lng} | null>. null = map not ready.
 *   - Overlay awaits the getter; falls back gracefully if unregistered.
 */

type CenterGetter = () => Promise<{ lat: number; lng: number } | null>;

let getter: CenterGetter | null = null;

export function registerMapCenterGetter(g: CenterGetter): void {
  getter = g;
}

export function unregisterMapCenterGetter(g: CenterGetter): void {
  if (getter === g) getter = null;
}

export async function getCurrentMapCenter(): Promise<{ lat: number; lng: number } | null> {
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}
