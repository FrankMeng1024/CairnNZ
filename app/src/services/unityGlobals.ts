/**
 * unityGlobals — RN-side wrapper for Unity's CairnGlobals MonoBehaviour.
 *
 * v186 introduces 7 OTA-tunable shader globals that change the visual
 * "feel" of strands without requiring an EAS Build. Set from RN at any
 * time; values are clamped server-side (in CairnGlobals.cs) so a bad
 * payload can never invisible-disappear cairns.
 *
 * Globals (see plan §1.C and CairnGlobals.cs for full ranges):
 *   - BloomScale     0.3-2.0   master bloom intensity multiplier
 *   - Alpha          0.05-1.0  master fade (clamped >0 — never invisible)
 *   - LightEstimate  0.3-2.0   ARKit ambient feed-in (currently default)
 *   - ScrollMul      0.0-2.0   strand flow speed (0 = still for screenshots)
 *   - BreathFreq     0.0-2.0   resting pulse Hz (0 disables breathing)
 *   - HaloRadiusMul  0.5-2.0   halo disc size
 *
 * ThermalScale is NOT settable from RN — driven internally by
 * CairnThermalMonitor based on iOS thermal state.
 *
 * Usage:
 *   const ref = useRef<UnityAROverlayHandle | null>(null);
 *   ...
 *   setUnityGlobal(ref.current, 'BloomScale', 1.5);
 *
 * Wire-format (Unity side JsonUtility-deserializes this):
 *   { "name": "BloomScale", "value": 1.5 }
 *
 * If the unityRef is null or Unity hasn't sent ArReady yet, the call
 * is silently no-op'd. There's no point queueing — globals are just
 * hints, missing one is fine.
 */

import type { UnityAROverlayHandle } from '../components/UnityAROverlay';

export type UnityGlobalName =
  | 'BloomScale'
  | 'Alpha'
  | 'LightEstimate'
  | 'ScrollMul'
  | 'BreathFreq'
  | 'HaloRadiusMul';

const RANGES: Record<UnityGlobalName, [number, number]> = {
  BloomScale:     [0.3, 2.0],
  Alpha:          [0.05, 1.0],
  LightEstimate:  [0.3, 2.0],
  ScrollMul:      [0.0, 2.0],
  BreathFreq:     [0.0, 2.0],
  HaloRadiusMul:  [0.5, 2.0],
};

/**
 * Send a global update to Unity. Clamps client-side as well as
 * server-side. Returns whether the call was actually dispatched.
 */
export function setUnityGlobal(
  handle: UnityAROverlayHandle | null,
  name: UnityGlobalName,
  value: number,
): boolean {
  if (!handle) return false;
  if (!Number.isFinite(value)) return false;
  const [min, max] = RANGES[name];
  const clamped = Math.max(min, Math.min(max, value));
  // The handle exposes `setGlobal` (added in v186 — see UnityAROverlay
  // imperative API). It posts an OnSetGlobal message to CairnBridge.
  if (typeof (handle as any).setGlobal === 'function') {
    (handle as any).setGlobal(name, clamped);
    return true;
  }
  return false;
}

/**
 * Convenience: enter "screenshot mode" — strands stop scrolling so a
 * still photograph looks crisp, no motion blur. Call setUnityGlobal
 * directly for finer control.
 */
export function setStrandStillForScreenshot(handle: UnityAROverlayHandle | null) {
  setUnityGlobal(handle, 'ScrollMul', 0);
}

/**
 * Convenience: restore default flow.
 */
export function restoreStrandMotion(handle: UnityAROverlayHandle | null) {
  setUnityGlobal(handle, 'ScrollMul', 1);
}
