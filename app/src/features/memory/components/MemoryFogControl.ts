/**
 * MemoryFogControl — DISABLED via OTA v304.
 *
 * Original purpose: wire the native CairnFogLayer (Metal SDF) module to
 * @rnmapbox/maps MapView. Native module was introduced in commit 3d97c7c
 * for build 46. Build 46 ERRORED on EAS. User devices run build 45 which
 * does NOT include cairn-fog-layer.framework.
 *
 * Why we keep the file: type FogRenderMode is imported by other modules
 * (MemoryMap, useMemorySettingsStore). Removing the file would force a
 * lot of unrelated changes. Instead the hook is now a typed no-op and
 * the imports of the native `cairn-fog-layer/src` module are GONE — so
 * Metro will no longer bundle requireNativeModule('CairnFogLayer') into
 * the JS bundle, and the runtime native-module-not-found exception is
 * impossible.
 *
 * When the native binary catches up (build 47+ with cairn-fog-layer
 * actually shipped), revert this file to its v303 form (git show
 * 3d97c7c:app/src/features/memory/components/MemoryFogControl.ts).
 */

import { log } from '../../../services/appLog';

export type FogRenderMode = 'legacy' | 'off' | 'sdf-soft' | 'sdf-sharp';

interface UseMemoryFogControlArgs {
  mapViewRef: any;
  mode: FogRenderMode;
}

/**
 * v304 OTA: native fog control no-op.
 * Logs once per call so server can see this branch is being exercised.
 */
export function useMemoryFogControl(_args: UseMemoryFogControlArgs): void {
  // Intentionally empty. JS FogLayer (H3 hex-cell) renders the fog.
  log('memory.fog_control_noop_v304', { mode: _args?.mode ?? 'legacy' });
}
