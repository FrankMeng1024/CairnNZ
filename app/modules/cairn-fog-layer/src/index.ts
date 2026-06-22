// CairnFogLayer JS wrapper — typed access to the native Expo module.
//
// All native methods are AsyncFunctions; we resolve to Promise<void>
// with explicit error codes propagated as rejected promises.

import { requireNativeModule } from 'expo-modules-core';

/** SDF fog mode. "off" disables rendering entirely (alpha=0 globally).
 *  "sdf-soft" is the default — smooth feathered edges, ~30% of radius.
 *  "sdf-sharp" eliminates the soft edge (feather≈0) for a hard cut. */
export type FogMode = 'off' | 'sdf-soft' | 'sdf-sharp';

/** One unlock circle. Coordinates in WGS84 (lat/lng degrees), radius
 *  in meters, optional bornAt epoch ms for future ripple-anim use. */
export interface FogCircle {
  lat: number;
  lng: number;
  radius: number;     // meters
  bornAt?: number;    // epoch ms
}

interface CairnFogLayerNativeModule {
  addFogLayer: (reactTag: number) => Promise<void>;
  updateCircles: (reactTag: number, circles: number[][]) => Promise<void>;
  setMode: (reactTag: number, mode: FogMode) => Promise<void>;
  setFeather: (reactTag: number, feather: number) => Promise<void>;
  setRipple: (reactTag: number, enabled: boolean) => Promise<void>;
  setFogColor: (reactTag: number, r: number, g: number, b: number, a: number) => Promise<void>;
  removeFogLayer: (reactTag: number) => Promise<void>;
}

const NativeModule = requireNativeModule<CairnFogLayerNativeModule>('CairnFogLayer');

/** Attach the SDF fog layer to the @rnmapbox/maps MapView identified by
 *  `reactTag`. The view must be mounted and its Mapbox MapView ready.
 *  Subsequent updateCircles / setMode / etc. calls target this layer. */
export function addFogLayer(reactTag: number): Promise<void> {
  return NativeModule.addFogLayer(reactTag);
}

/** Replace the entire unlock-circle set. Up to 256 circles uploaded to
 *  the GPU uniform buffer. Excess circles silently dropped (in v304 we
 *  pack into a texture for >256). */
export function updateCircles(reactTag: number, circles: FogCircle[]): Promise<void> {
  const packed = circles.map((c) => [
    c.lng,
    c.lat,
    c.radius,
    c.bornAt ?? 0,
  ]);
  return NativeModule.updateCircles(reactTag, packed);
}

/** Switch fog rendering mode at runtime. No re-attach needed. */
export function setMode(reactTag: number, mode: FogMode): Promise<void> {
  return NativeModule.setMode(reactTag, mode);
}

/** Soft-edge band as fraction of circle radius. 0 = hard. 0.30 = default. */
export function setFeather(reactTag: number, feather: number): Promise<void> {
  return NativeModule.setFeather(reactTag, feather);
}

/** Toggle the ring-pulse animation. Default off (saves battery — the
 *  layer redraws every frame when on, vs only on map-pan when off). */
export function setRipple(reactTag: number, enabled: boolean): Promise<void> {
  return NativeModule.setRipple(reactTag, enabled);
}

/** Override the fog color. RGBA in [0,1]. Default = sepia
 *  (0.196, 0.137, 0.078, 0.62) matching MemoryColors.fogOverlay. */
export function setFogColor(
  reactTag: number,
  r: number, g: number, b: number, a: number,
): Promise<void> {
  return NativeModule.setFogColor(reactTag, r, g, b, a);
}

/** Detach the layer from the map. Releases Metal resources. */
export function removeFogLayer(reactTag: number): Promise<void> {
  return NativeModule.removeFogLayer(reactTag);
}

export default {
  addFogLayer,
  updateCircles,
  setMode,
  setFeather,
  setRipple,
  setFogColor,
  removeFogLayer,
};
