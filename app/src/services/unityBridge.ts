/**
 * Cairn RN <-> Unity bridge.
 *
 * Wraps @azesmway/react-native-unity's UnityView with a typed message
 * protocol matching what Unity's CairnBridge expects.
 *
 * Wire diagram:
 *   RN:  unityRef.postMessage('CairnBridge', methodName, payloadJson)
 *        - Routes to Unity's GameObject named 'CairnBridge' via SendMessage
 *
 *   Unity -> RN: Unity calls UnityNativeBridge.Send("Name|jsonOrPayload")
 *        - Lands in NativeCallProxy.mm sendMessageToMobileApp(...)
 *        - RNUnityView fires onUnityMessage prop with { nativeEvent: { message } }
 *
 *   This file:
 *     - sendToUnity(unityRef, method, data)  -- typed wrapper
 *     - parseUnityMessage(raw)               -- discriminated union parser
 */

import type UnityView from '@azesmway/react-native-unity';
import { crashLogger } from './crashLogger';

// Unity GameObject name MUST match CairnBridge.GAMEOBJECT_NAME on the Unity side.
const UNITY_BRIDGE_GO = 'CairnBridge';

const TAG = 'unity-bridge';

// OTA #183: throttle parse:recovered breadcrumbs to 1/sec per message name.
// Without this, a 10Hz ArFrame stream that triggers recovery on every frame
// floods the 500-entry crashLogger ring buffer in ~50s, overwriting earlier
// breadcrumbs (mount diagnostics, init steps). parse:fail-* breadcrumbs are
// NOT throttled — they are rare and signal new corruption patterns.
const parseRecoveredLastLog: Record<string, number> = {};

/**
 * Reset the parse:recovered throttle map. Called by UnityAROverlay on mount
 * so that a remount (e.g., AR screen exited and re-entered) gets a fresh
 * first-recovery breadcrumb instead of being silently throttled by stale
 * timestamps from the previous mount session.
 */
export function resetParseRecoveredThrottle(): void {
  for (const k of Object.keys(parseRecoveredLastLog)) {
    delete parseRecoveredLastLog[k];
  }
}

type UnityViewRef = React.RefObject<UnityView | null>;

/**
 * Send a structured message to Unity's CairnBridge.
 * Method names must match the public methods on Unity's CairnBridge.cs:
 *   - 'OnSpawnStrand'   (data: SpawnRequest)
 *   - 'OnClearAll'      (data: anything, ignored)
 *   - 'OnPing'          (data: token string)
 */
export function sendToUnity(
  unityRef: UnityViewRef,
  method: 'OnSpawnStrand' | 'OnClearAll' | 'OnPing',
  data: object | string
): void {
  if (!unityRef.current) {
    crashLogger.breadcrumb(`${TAG}:send:no-ref method=${method}`);
    return;
  }
  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  try {
    unityRef.current.postMessage(UNITY_BRIDGE_GO, method, payload);
    crashLogger.breadcrumb(`${TAG}:send:${method} bytes=${payload.length}`);
  } catch (e: any) {
    crashLogger.breadcrumb(
      `${TAG}:send:fail method=${method} err=${e?.message ?? 'unknown'}`
    );
  }
}

/**
 * Discriminated union of messages Unity sends to RN.
 * Format coming over the bridge:
 *   "Name|jsonPayload"           — most messages
 *   "UnityLog|level|line"        — log forwarding (3 segments)
 */
export type UnityMessage =
  | { kind: 'ArReady';        unityVersion: string; arSession: string }
  | { kind: 'ArFrame';        px: number; py: number; pz: number; fx: number; fy: number; fz: number }
  | { kind: 'PlaneDetected';  x: number; y: number; z: number; area: number }
  | { kind: 'ArSessionState'; state: string }
  | { kind: 'Pong';           token: string; unityTime: number }
  | { kind: 'UnityLog';       level: 'info' | 'warn' | 'error'; line: string }
  | { kind: 'Checkpoint';     step: string }
  | { kind: 'XRDiag';         phase: string; managerNull?: boolean; loaderCount?: number; loaders?: string; error?: string }
  | { kind: 'ARBgDiag';       phase: string; present?: boolean; enabled?: boolean; useCustomMaterial?: boolean; materialNull?: boolean; error?: string }
  | { kind: 'ARStateStall';   state: string; elapsedSec: string; activeLoaders: string }
  | { kind: 'A1State';        state: 'UNLOCKED' | 'ARMED' | 'LOCKED' | 'FROZEN'; prev?: string; a11?: boolean }
  | { kind: 'SpawnRejected';  id: string; reason: string }
  // v0.2.4 Block A/C — acquire 状态 + 引导事件(让 ARScreen / AcquireGuidance 真接到)
  | { kind: 'AcquireState';     markerId: string; from: string; to: string; dist: number; tInAcquire: number }
  | { kind: 'AcquireGuidance';  markerId: string; level: number; elapsed: number }
  | { kind: 'Unknown';        raw: string };

export function parseUnityMessage(raw: string): UnityMessage {
  if (!raw || typeof raw !== 'string') {
    return { kind: 'Unknown', raw: String(raw) };
  }

  // UnityLog / NativeLog / Checkpoint use prefix dispatch — handled BEFORE
  // the generic Name|json parser so their payloads are never passed to JSON.parse.
  //
  // UnityLog:   sent by Unity C# logger (WARN/ERROR only).
  // NativeLog:  sent by CAIRN_LOG macro in RNUnityView.mm (ObjC diagnostics).
  //             Both emit kind:'UnityLog' so UnityAROverlay handles them identically.
  // Checkpoint: sent by cairnCheckpoint() in RNUnityView.mm at each init step.
  //             Payload is plain text (not JSON), e.g. "step8-runEmbeddedWithArgc-START".
  if (raw.startsWith('UnityLog|') || raw.startsWith('NativeLog|')) {
    const parts = raw.split('|');
    const level = (parts[1] === 'warn' || parts[1] === 'error') ? parts[1] : 'info';
    const line  = parts.slice(2).join('|');
    return { kind: 'UnityLog', level, line };
  }

  if (raw.startsWith('Checkpoint|')) {
    const step = raw.slice('Checkpoint|'.length);
    return { kind: 'Checkpoint', step };
  }

  // Other messages: Name|json (Name has no '|' by convention)
  const idx = raw.indexOf('|');
  if (idx < 0) return { kind: 'Unknown', raw };

  const name = raw.slice(0, idx);
  const json = raw.slice(idx + 1);

  let data: any = {};
  try {
    data = json ? JSON.parse(json) : {};
  } catch {
    // Defensive recovery: Unity's IL2CPP string.Format has a known bug
    // where the format spec leaks into output as a literal (e.g. "F3",
    // "NaN", "Inf", "-Inf") whenever a {N:F3}}} placeholder sits
    // immediately before an escaped }}. Diag from 2026-06-05 confirmed
    // every ArFrame and Pong arrived with `..."fz":F3}` /
    // `..."unityTime":F3}` — JSON.parse threw → message dropped to
    // Unknown → ArReady-style messages with the same trailing pattern
    // would also be lost. Strategy: replace non-numeric tokens that
    // appear in number positions with null, then retry. Field-level
    // typeof checks below already coerce null → default value, so we
    // recover whatever fields are still well-formed.
    //
    // Pattern: ":<TOKEN>[,}]" where TOKEN is not a valid JSON number
    // and not a quoted string. Limited to common Unity-IL2CPP literals
    // to avoid corrupting legitimate text content.
    const repaired = json.replace(
      /:\s*(F\d+|NaN|-?Inf(?:inity)?)(?=\s*[,}\]])/g,
      ': null'
    );
    if (repaired !== json) {
      try {
        data = JSON.parse(repaired);
        // OTA #181: smoking-gun proof the parser fix is firing. Counts of
        // parse:recovered vs parse:fail-* tell us exactly how prevalent
        // the IL2CPP string.Format bug is across all messages.
        // OTA #183: throttle to 1/sec per name. ArFrame at 10Hz would
        // otherwise produce 150 breadcrumbs in 15s and overwrite the
        // mount/init diagnostics in the ring buffer.
        const now = Date.now();
        const last = parseRecoveredLastLog[name] ?? 0;
        if (now - last >= 1000) {
          parseRecoveredLastLog[name] = now;
          crashLogger.breadcrumb(
            `unity-bridge:parse:recovered name=${name} bytes=${json.length}`
          );
        }
      } catch {
        crashLogger.breadcrumb(
          `unity-bridge:parse:fail-after-repair name=${name} raw=${json.slice(0, 80)}`
        );
        return { kind: 'Unknown', raw };
      }
    } else {
      // Regex didn't match — corruption pattern is something else
      // (not the IL2CPP F3/NaN/Inf leak). Worth surfacing so we can
      // identify a new failure mode.
      crashLogger.breadcrumb(
        `unity-bridge:parse:fail-no-repair-needed name=${name} raw=${json.slice(0, 80)}`
      );
      return { kind: 'Unknown', raw };
    }
  }

  switch (name) {
    case 'ArReady':
      return { kind: 'ArReady', unityVersion: data.unityVersion ?? '', arSession: data.arSession ?? '' };
    case 'ArFrame':
      return {
        kind: 'ArFrame',
        px: typeof data.px === 'number' ? data.px : 0,
        py: typeof data.py === 'number' ? data.py : 0,
        pz: typeof data.pz === 'number' ? data.pz : 0,
        fx: typeof data.fx === 'number' ? data.fx : 0,
        fy: typeof data.fy === 'number' ? data.fy : 1,
        fz: typeof data.fz === 'number' ? data.fz : 0,
      };
    case 'PlaneDetected':
      return {
        kind: 'PlaneDetected',
        x: typeof data.x === 'number' ? data.x : 0,
        y: typeof data.y === 'number' ? data.y : 0,
        z: typeof data.z === 'number' ? data.z : 0,
        area: typeof data.area === 'number' ? data.area : 0,
      };
    case 'ArSessionState':
      return { kind: 'ArSessionState', state: String(data.state ?? '') };
    case 'Pong':
      return {
        kind: 'Pong',
        token: String(data.token ?? ''),
        unityTime: typeof data.unityTime === 'number' ? data.unityTime : 0,
      };
    case 'XRDiag':
      // Unity-side enumeration of active XR loaders. Sent once at Start().
      // If managerNull=true OR loaderCount=0, ARKit subsystem is not active
      // at runtime regardless of editor-time YAML config — smoking gun for
      // "loader registered in YAML but not loaded into XRManagerSettings".
      return {
        kind: 'XRDiag',
        phase: String(data.phase ?? ''),
        managerNull: typeof data.managerNull === 'boolean' ? data.managerNull : undefined,
        loaderCount: typeof data.loaderCount === 'number' ? data.loaderCount : undefined,
        loaders: typeof data.loaders === 'string' ? data.loaders : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
      };
    case 'ARBgDiag':
      // Unity-side ARCameraBackground component state. Sent once at Start().
      // present=false means the AR Camera GameObject lacks ARCameraBackground
      // → camera feed will never composite → screen stays black.
      // enabled=false means the component exists but is disabled.
      return {
        kind: 'ARBgDiag',
        phase: String(data.phase ?? ''),
        present: typeof data.present === 'boolean' ? data.present : undefined,
        enabled: typeof data.enabled === 'boolean' ? data.enabled : undefined,
        useCustomMaterial: typeof data.useCustomMaterial === 'boolean' ? data.useCustomMaterial : undefined,
        materialNull: typeof data.materialNull === 'boolean' ? data.materialNull : undefined,
        error: typeof data.error === 'string' ? data.error : undefined,
      };
    case 'ARStateStall':
      // One-shot watchdog from Unity: at 10s post-Awake, if ARSession.state
      // hasn't advanced past initial states. Disambiguates "XR loader present
      // but subsystem silently failed" from "XR loader missing" — without
      // this, both look like absence of ArSessionState events.
      return {
        kind: 'ARStateStall',
        state: String(data.state ?? ''),
        elapsedSec: String(data.elapsedSec ?? ''),
        activeLoaders: String(data.activeLoaders ?? ''),
      };
    case 'A1State': {
      // v0.2.3 Stage 4 — GroundYResolver A1 FSM transition
      // (UNLOCKED/ARMED/LOCKED/FROZEN). Routed into useArOriginStore so
      // the Plant button enable rule can react. Validate enum here so
      // downstream consumers get a narrow union, not just `string`.
      const s = String(data.state ?? '');
      const valid = (s === 'UNLOCKED' || s === 'ARMED' || s === 'LOCKED' || s === 'FROZEN') ? s : 'UNLOCKED';
      return {
        kind: 'A1State',
        state: valid as 'UNLOCKED' | 'ARMED' | 'LOCKED' | 'FROZEN',
        prev: typeof data.prev === 'string' ? data.prev : undefined,
        a11: typeof data.a11 === 'boolean' ? data.a11 : undefined,
      };
    }
    case 'SpawnRejected': {
      // v0.2.3 Branch B — PortalSpawner / MultiSpawner could not find a
      // valid Floor plane (or anchor attach failed). Caller (UnityAROverlay)
      // removes id from spawnedIdsRef so next ArFrame can retry.
      const id = String(data.id ?? '');
      const reason = String(data.reason ?? 'unknown');
      return { kind: 'SpawnRejected', id, reason };
    }
    // v0.2.4 Block A: ray-hit 触发后状态机转换事件
    case 'v22-ACQUIRE-STATE':
      return {
        kind: 'AcquireState',
        markerId: String(data.markerId ?? ''),
        from: String(data.from ?? ''),
        to: String(data.to ?? ''),
        dist: typeof data.dist === 'number' ? data.dist : -1,
        tInAcquire: typeof data.tInAcquire === 'number' ? data.tInAcquire : 0,
      };
    // v0.2.4 Block C: 引导文案级别(给 AcquireGuidance.tsx)
    case 'guidance':
      return {
        kind: 'AcquireGuidance',
        markerId: String(data.markerId ?? ''),
        level: typeof data.level === 'number' ? data.level : 0,
        elapsed: typeof data.elapsed === 'number' ? data.elapsed : 0,
      };
    default:
      return { kind: 'Unknown', raw };
  }
}
