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
        crashLogger.breadcrumb(
          `unity-bridge:parse:recovered name=${name} bytes=${json.length}`
        );
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
    default:
      return { kind: 'Unknown', raw };
  }
}
