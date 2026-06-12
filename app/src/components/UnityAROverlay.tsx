/**
 * UnityAROverlay — drop-in replacement for ViroAROverlay using Unity 6 +
 * AR Foundation via @azesmway/react-native-unity.
 *
 * Architecture per research report findings:
 *   - Unity full-screen, mounted as RN subview (UnityView fills screen).
 *   - This overlay does NOT itself render UI; RN UI (PlantSheet,
 *     CairnEdgeArrows etc.) layers on top in ARScreen.
 *   - We keep UnityView always mounted while flag enabled (do NOT
 *     conditional-render — react-native-unity 1.0.11 has a singleton
 *     and remount triggers Unity reload, expensive).
 *
 * Phase 1 Spike scope:
 *   - Just mount UnityView, listen for AR events from Unity's CairnBridge.
 *   - Forward Unity logs to RN crashLogger for telemetry.
 *   - cairns array is empty (Phase 2 will compute world positions).
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View, Platform, UIManager } from 'react-native';
import UnityView from '@azesmway/react-native-unity';
import { sendToUnity, parseUnityMessage, resetParseRecoveredThrottle } from '../services/unityBridge';
import { crashLogger } from '../services/crashLogger';
import { API_BASE_URL } from '../config/api';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '../store/storage';
import { useArOriginStore, type A1State as A4_A1State } from '../store/useArOriginStore';
import {
  buildSpawnRequest,
  type UnitySpawnRequest,
} from '../services/unityCairnSpawn';

const UNITY_CHECKPOINT_KEY = 'cairn_unity_init_step_js';

const TAG = 'unity-overlay';

type Marker = {
  id: string;
  type: string;
  lat: number;
  lng: number;
  alt?: number | null;
  note?: string;   // v187 — forwarded to Unity for the 3D mark text above each cairn
};

type CameraInfo = {
  position: [number, number, number];
  forward: [number, number, number];
};

type ArOriginInfo = { lat: number; lng: number; alt: number | null } | null;

type CairnWorldPos = {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  dist: number;
};

export type UnityAROverlayProps = {
  markers: Marker[];
  userPos: { lat: number; lng: number; alt: number | null } | null;
  /**
   * v196.1: optional persistent AR origin from useMarkerStore. When set,
   * bulk-spawn at ArReady uses this anchor instead of live userPos —
   * keeps marker positions stable across re-entries that would otherwise
   * accumulate GPS noise. If null/undefined, falls back to userPos
   * (legacy behavior).
   */
  arOrigin?: { lat: number; lng: number; alt: number | null } | null;
  userHeading: number | null;
  onStatus?: (s: { glReady: boolean; cairnCount: number }) => void;
  onArFrame?: (info: {
    camera: CameraInfo;
    cairns: CairnWorldPos[];
    origin: ArOriginInfo;
    groundY: number | null;
  }) => void;
  beamingId?: string | null;
  onCairnPress?: (id: string) => void;
};

/**
 * Imperative handle exposed to ARScreen so it can push individual cairn spawns
 * (called immediately on plant) without going through the props/render cycle.
 *
 * Why imperative: plant happens *after* the marker is persisted by addMarker,
 * which causes the markers prop to update on the next render. By then the
 * user is already wondering "did it work?" — going via prop change adds an
 * extra render frame of latency. Calling spawnCairn() directly on plant
 * sends the postMessage in the same tick the user gets the haptic.
 *
 * Bulk spawn (spawnAllMarkers) is the "user re-entered AR screen with N
 * existing cairns" path — UnityAROverlay calls it itself when it receives
 * ArReady (so we don't depend on ARScreen knowing the lifecycle).
 */
export interface UnityAROverlayHandle {
  /** Spawn one cairn now. Caller is responsible for building the request
   *  (so the caller can use its already-computed ARKit world coordinates
   *  from the plant hit-test, instead of round-tripping through GPS). */
  spawnCairn(req: UnitySpawnRequest): void;
  /** Convenience: re-spawn all current markers. Used after ArReady when
   *  origin has just been established. */
  spawnMarkers(
    markers: Marker[],
    origin: { lat: number; lng: number } | null,
    groundY: number | null,
  ): void;
  /** Tell Unity to despawn everything (e.g. AR screen unmount). */
  clearAll(): void;
  /** v186: set an OTA-tunable shader global. See unityGlobals.ts.
   *  Silent no-op if Unity not ready. */
  setGlobal(name: string, value: number): void;
}

export const UnityAROverlay = forwardRef<UnityAROverlayHandle, UnityAROverlayProps>(
  function UnityAROverlay(props, ref) {
  const unityRef     = useRef<UnityView | null>(null);
  const groundYRef   = useRef<number | null>(null);
  // v206 B1 — area-weighted ground tracking. Old code did "last plane wins"
  // regardless of plane area, so a tiny outlier plane (area=0.3) could
  // contaminate a perfectly good 1.9m² stable plane (baseline plant 5
  // got groundY=0.30 from a 0.3-area outlier instead of larger nearby
  // planes). Buffer last 5s of plane events with area>=0.5; pick largest.
  const recentPlanesRef = useRef<Array<{ y: number; area: number; t: number }>>([]);
  // v224 — observed planes ring (separate from accepted planes) for F4
  // bottom-third heuristic. Tracks ALL Y values seen in last 5s, not just
  // accepted ones, so we can pick "is this plane in the bottom 1/3 of
  // observed range" — robust against rooms where multiple tabletops appear
  // before the floor is detected. See subagent#5-D analysis.
  const observedPlaneYsRef = useRef<Array<{ y: number; t: number }>>([]);
  // v220 F4 → v224 F4-tightened — track last camera Y from ArFrame so
  // PlaneDetected can reject tabletops/shelves. v220 used camY-0.5 which
  // failed in production v0.2.2 (let plane y=-0.07 through with camY≈+0.4,
  // i.e. wardrobe top at chest height). v224 tightens to camY-0.8 (camera
  // at chest ≈1.4m → floor ≥1.2m below cam; tabletops ~0.7m below cam get
  // caught). Adds bottom-third heuristic as belt-and-suspenders.
  const lastCameraYRef = useRef<number | null>(null);
  // v208 — REMOVED groundLockedRef (and the v206 B1 lock-Y sniff in UnityLog
  // case). Unity emits "[GroundYResolver] locked Y=..." per-CAIRN, not
  // per-session — accepting any single lock as session-wide ground caused
  // tabletop/ceiling locks to overwrite floor lock → "几次后飞天". Now RN
  // uses area-weighted PlaneDetected buffer only; Unity owns per-cairn
  // refinement.
  const arReadyRef   = useRef(false);
  const lastFrameRef = useRef<number>(Date.now());
  // Track which marker IDs we've already pushed to Unity this session, so
  // markers-prop changes (e.g. server sync adding nearby markers) don't
  // trigger duplicate spawns. Cleared on unmount.
  const spawnedIdsRef = useRef<Set<string>>(new Set());
  // Branch B v3-review-fix: throttle SpawnRejected retries. Per marker:
  // {nextEarliestRetryAt: ms, attemptCount: int}. Without this, a
  // wall/ceiling-classified location pumps 60Hz spawn↔reject pairs that
  // brick the bridge and burn battery.
  const rejectionTrackerRef = useRef<Map<string, { nextRetryAt: number; attempts: number }>>(new Map());
  // v199 review B3 fix — per-session GPS offset gates one-shot.
  // bulkSpawnedRef: has the post-offset bulk-spawn fired?
  const bulkSpawnedRef = useRef<boolean>(false);
  // v206 A2 fix — track last sent origin so we can re-send OnSetSessionOffset
  // when arOrigin transitions null→persisted mid-session (or persisted
  // changes after staleness clear+relock). Replaces the earlier offsetSentRef
  // one-shot which burned on first ArFrame even if arOrigin was still null
  // (which then meant Unity NEVER received a real persisted offset for the
  // entire session — see baseline Q "OnSetSessionOffset cadence").
  const lastSentOriginRef = useRef<{ lat: number; lng: number } | null>(null);
  // v206 A1 fix — count ArFrames received while waiting for markers to
  // populate (lastCoord race or store hydration delay). Logs at frame 30
  // (~3s) and 100 (~10s) to make "AR mounted but markers stayed empty"
  // visible in telemetry. Resets on unmount.
  const emptyMarkerFrameCountRef = useRef(0);
  // OTA #181: one-shot breadcrumb on first ArFrame received. After parser
  // fix, lets us see whether values are real (Unity AR working) or are
  // the parser's null→default fallbacks (Unity still emitting F3 literals).
  // Real working AR: px/py/pz vary, fy≈1, etc. Fallback signature:
  // px=0 py=0 pz=0 fx=0 fy=1.00 fz=0 (parser defaults).
  const firstFrameRef = useRef(true);

  // Internal helper: send an OnSpawnStrand to Unity with all the safety
  // checks (Unity ref live, AR ready, not already spawned). Returns true
  // if the message was actually dispatched.
  const dispatchSpawn = useCallback((req: UnitySpawnRequest): boolean => {
    if (!unityRef.current) {
      crashLogger.breadcrumb(`${TAG}:spawn-skip:no-unityRef id=${req.id}`);
      return false;
    }
    if (!arReadyRef.current) {
      // Don't drop — the caller (typically ArReady handler) is expected
      // to be the gate. If something else races us, log and move on.
      crashLogger.breadcrumb(`${TAG}:spawn-skip:not-ready id=${req.id}`);
      return false;
    }
    if (spawnedIdsRef.current.has(req.id)) {
      // Same-id duplicate — ignore. (Future: support update via despawn+respawn.)
      return false;
    }
    try {
      unityRef.current.postMessage('CairnBridge', 'OnSpawnStrand', JSON.stringify(req));
      spawnedIdsRef.current.add(req.id);
      crashLogger.breadcrumb(
        `${TAG}:spawn id=${req.id} pos=(${req.x.toFixed(2)},${req.y.toFixed(2)},${req.z.toFixed(2)})`
      );
      return true;
    } catch (e: any) {
      crashLogger.breadcrumb(`${TAG}:spawn-error id=${req.id} ${String(e?.message ?? e).slice(0, 80)}`);
      return false;
    }
  }, []);

  // Imperative API for ARScreen.
  useImperativeHandle(
    ref,
    (): UnityAROverlayHandle => ({
      spawnCairn: (req) => {
        dispatchSpawn(req);
      },
      spawnMarkers: (markers, origin, groundY) => {
        if (!origin) {
          crashLogger.breadcrumb(`${TAG}:spawnMarkers-skip:no-origin n=${markers.length}`);
          return;
        }
        let dispatched = 0;
        for (const m of markers) {
          if (spawnedIdsRef.current.has(m.id)) continue;
          const req = buildSpawnRequest(
            { id: m.id, type: m.type, lat: m.lat, lng: m.lng, note: m.note },
            origin,
            groundY,
          );
          if (req && dispatchSpawn(req)) dispatched += 1;
        }
        crashLogger.breadcrumb(
          `${TAG}:spawnMarkers requested=${markers.length} dispatched=${dispatched} alreadySpawned=${spawnedIdsRef.current.size - dispatched}`
        );
      },
      clearAll: () => {
        if (!unityRef.current) return;
        try {
          unityRef.current.postMessage('CairnBridge', 'OnClearAll', '');
          spawnedIdsRef.current.clear();
      // v199 — reset offset/bulk-spawn one-shots so next mount can re-fire.
      // v206 A2 — lastSentOriginRef replaces offsetSentRef.
      // v206 B1 — drop the ground-lock + plane buffer so the next session
      // starts fresh (ARKit world frame may have changed).
      lastSentOriginRef.current = null;
      bulkSpawnedRef.current = false;
      emptyMarkerFrameCountRef.current = 0;
      recentPlanesRef.current = [];
      observedPlaneYsRef.current = [];
      lastCameraYRef.current = null;
          crashLogger.breadcrumb(`${TAG}:clearAll dispatched`);
        } catch (e: any) {
          crashLogger.breadcrumb(`${TAG}:clearAll-error ${String(e?.message ?? e).slice(0, 80)}`);
        }
      },
      setGlobal: (name, value) => {
        if (!unityRef.current) return;
        if (!Number.isFinite(value)) return;
        try {
          unityRef.current.postMessage(
            'CairnBridge', 'OnSetGlobal',
            JSON.stringify({ name, value })
          );
        } catch (e: any) {
          crashLogger.breadcrumb(`${TAG}:setGlobal-error ${name} ${String(e?.message ?? e).slice(0, 80)}`);
        }
      },
    }),
    [dispatchSpawn],
  );

  // Mount lifecycle
  useEffect(() => {
    const mountTs = Date.now();
    crashLogger.breadcrumb(`${TAG}:mount markers=${props.markers.length} platform=${Platform.OS} osVersion=${Platform.Version}`);

    // Reset module-level parse:recovered throttle so a remount (AR screen
    // exited then re-entered) doesn't silently suppress the first recovery
    // breadcrumb of the new session due to stale timestamps from the
    // previous session.
    resetParseRecoveredThrottle();

    // Upload any checkpoint left from a previous crash during Unity init.
    // cairnCheckpoint() in RNUnityView.mm writes to AsyncStorage (via JS) at
    // each init step. If runEmbeddedWithArgc caused a C++ crash, the last
    // written step shows exactly where init died. Cleared after ArReady fires.
    storage.getItem(UNITY_CHECKPOINT_KEY).then((step) => {
      if (step) {
        crashLogger.breadcrumb(`${TAG}:prev-launch-checkpoint=${step} (crash during Unity init?)`);
        crashLogger.uploadDiagnostic(API_BASE_URL, `unity-prev-checkpoint-${step}`).catch(() => undefined);
        // Don't clear yet — keep until ArReady confirms this launch succeeded.
      }
    }).catch(() => undefined);

    // Diagnostic 1: Check if UnityFramework.framework is actually on disk
    // Runs immediately on mount — confirms the IPA embed is accessible at runtime.
    if (Platform.OS === 'ios' && FileSystem.bundleDirectory) {
      const fwPath = FileSystem.bundleDirectory + 'Frameworks/UnityFramework.framework';
      FileSystem.getInfoAsync(fwPath)
        .then((info) => {
          crashLogger.breadcrumb(
            `${TAG}:diag:fwExists=${info.exists} path=${fwPath.slice(-60)}`
          );
        })
        .catch((e: any) => {
          crashLogger.breadcrumb(`${TAG}:diag:fwCheck-error ${String(e?.message ?? e).slice(0, 80)}`);
        });
    } else {
      crashLogger.breadcrumb(`${TAG}:diag:fwCheck-skip platform=${Platform.OS} bundleDir=${FileSystem.bundleDirectory ?? 'null'}`);
    }

    // Diagnostic 2: Check if RNUnityView Fabric component descriptor is registered
    // If getViewManagerConfig returns null, New Arch (Fabric) never registered the component.
    try {
      const cfg = (UIManager as any).getViewManagerConfig?.('RNUnityView');
      crashLogger.breadcrumb(
        `${TAG}:diag:RNUnityView-registered=${cfg != null} keys=${cfg ? Object.keys(cfg).join(',').slice(0, 80) : 'none'}`
      );
    } catch (e: any) {
      crashLogger.breadcrumb(`${TAG}:diag:RNUnityView-registryError ${String(e?.message ?? e).slice(0, 80)}`);
    }

    // Auto-upload diagnostics at 5s if still not ready (Unity silent)
    const t5 = setTimeout(() => {
      if (!arReadyRef.current) {
        crashLogger.breadcrumb(`${TAG}:diag:5s-no-ArReady — uploading`);
        crashLogger.uploadDiagnostic(API_BASE_URL, 'unity-5s-silent').catch(() => undefined);
      }
    }, 5_000);

    // Auto-upload diagnostics at 15s if still not ready
    const t15 = setTimeout(() => {
      if (!arReadyRef.current) {
        crashLogger.breadcrumb(`${TAG}:diag:15s-no-ArReady elapsed=${Date.now() - mountTs}ms`);
        crashLogger.uploadDiagnostic(API_BASE_URL, 'unity-15s-silent').catch(() => undefined);
      }
    }, 15_000);

    return () => {
      clearTimeout(t5);
      clearTimeout(t15);
      // Tell Unity to despawn all strands and reset RN's spawned-set, so
      // re-entering the AR screen starts from a clean slate. Without this,
      // @azesmway/react-native-unity's singleton UnityFramework keeps
      // MultiSpawner._spawned populated across RN remounts → ghost pillars
      // pile up. (Reviewer-flagged MEDIUM concern, OTA-fix #1.)
      if (unityRef.current) {
        try { unityRef.current.postMessage('CairnBridge', 'OnClearAll', ''); } catch {}
      }
      spawnedIdsRef.current.clear();
      // v199 — reset offset/bulk-spawn one-shots so next mount can re-fire.
      // v206 A2 — lastSentOriginRef replaces offsetSentRef
      // v206 B1 — clear plane buffer + ground-lock for next session
      lastSentOriginRef.current = null;
      bulkSpawnedRef.current = false;
      emptyMarkerFrameCountRef.current = 0;
      recentPlanesRef.current = [];
      observedPlaneYsRef.current = [];
      lastCameraYRef.current = null;
      crashLogger.breadcrumb(`${TAG}:unmount glReady=${arReadyRef.current}`);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Heartbeat watchdog: log if no ArFrame in 10s (after AR ready)
  useEffect(() => {
    const id = setInterval(() => {
      if (!arReadyRef.current) return;
      const elapsed = Date.now() - lastFrameRef.current;
      if (elapsed > 10_000) {
        crashLogger.breadcrumb(`${TAG}:warn:no-heartbeat elapsed=${elapsed}ms`);
        lastFrameRef.current = Date.now(); // reset to avoid log spam
      }
    }, 10_000);
    return () => clearInterval(id);
  }, []);

  // v0.2.3 Stage 4 — feed GPS to A4 (useArOriginStore) for distance
  // invalidation (Plan v4 §A1 ⇄ A4 FSM CONTRACT MATRIX, R22). The
  // store handles the haversine + threshold internally; we just push
  // every userPos change. Throttled by upstream geolocation cadence.
  useEffect(() => {
    if (!props.userPos) return;
    useArOriginStore.getState().onGpsFix(props.userPos.lat, props.userPos.lng);
  }, [props.userPos]);

  // Ping Unity at 3s to check if message channel is alive.
  // If Unity is running and the bridge is wired, we'll get a Pong back.
  // If no Pong arrives, bridge is broken (Unity not started or symbol missing).
  useEffect(() => {
    const t = setTimeout(() => {
      const token = `ping-${Date.now()}`;
      crashLogger.breadcrumb(`${TAG}:diag:sending-ping token=${token}`);
      if (unityRef.current) {
        try {
          unityRef.current.postMessage('CairnBridge', 'OnPing', token);
          crashLogger.breadcrumb(`${TAG}:diag:ping-sent`);
        } catch (e: any) {
          crashLogger.breadcrumb(`${TAG}:diag:ping-error ${String(e?.message ?? e).slice(0, 80)}`);
        }
      } else {
        crashLogger.breadcrumb(`${TAG}:diag:ping-skipped unityRef=null`);
      }
    }, 3_000);
    return () => clearTimeout(t);
  }, []);

  // Handle Unity -> RN messages
  const onUnityMessage = useCallback(
    (event: any) => {
      const raw = event?.nativeEvent?.message ?? '';
      const msg = parseUnityMessage(raw);

      switch (msg.kind) {
        case 'UnityLog':
          // Unity logger forwards WARN/ERROR by default (not INFO).
          // crashLogger ring buffer is 500 — guard against flood by tag prefix.
          crashLogger.breadcrumb(`unity-native:${msg.level}:${msg.line.slice(0, 200)}`);
          // v208 — DELETED v206 B1's lock-Y sniffer. The premise was wrong:
          // Unity GroundYResolver emits "locked Y=..." once PER CAIRN, not
          // per session. Indoor users plant cairns at floor + tabletop +
          // shelf — each gets its own lock at a different Y. v207 RN code
          // accepted every lock, last write wins → next spawn used tabletop
          // or ceiling Y as ground → "几次后飞天" with cairns at +2.77m.
          // Unity's per-cairn lerp+lock loop is the correct refinement path;
          // RN was second-guessing it. Now RN only uses area-weighted
          // PlaneDetected buffer for spawn-time ground hint, and Unity
          // settles each cairn to its own correct plane via QueryGroundY.
          break;

        case 'Checkpoint':
          // cairnCheckpoint() in RNUnityView.mm fires at each init step.
          // Persist to AsyncStorage so a C++ crash mid-init is diagnosable on next launch.
          crashLogger.breadcrumb(`${TAG}:checkpoint:${msg.step}`);
          storage.setItem(UNITY_CHECKPOINT_KEY, msg.step).catch(() => undefined);
          break;

        case 'ArReady':
          arReadyRef.current = true;
          // Clear checkpoint — init succeeded, no crash diagnosis needed next launch.
          storage.removeItem(UNITY_CHECKPOINT_KEY).catch(() => undefined);
          crashLogger.breadcrumb(
            `${TAG}:recv:ArReady unityVer=${msg.unityVersion} session=${msg.arSession}`
          );
          crashLogger.uploadDiagnostic(API_BASE_URL, 'unity-ar-ready').catch(() => undefined);
          props.onStatus?.({ glReady: true, cairnCount: props.markers.length });
          // v226 — auto-push "ground-anchored visual defaults" per
          // adversarial subagent diagnosis of v225 telemetry id=783-788
          // user complaint "全部浮空".
          //
          // Diagnosis (verified across 4 user snaps, 4 camY postures):
          //   - Y coordinate is CORRECT (Tier-A locks at -0.04 across
          //     camY 0.5/1.1/1.3/1.5 = consistent floor). Pivot is at
          //     base (PortalSpawnerV199.cs:320 confirmed).
          //   - "浮空" is NOT a Y bug. It's upper-structure dominance:
          //     LikeBadge at 1.6m, FarShaft top at 2.5m, RuneText at
          //     1.3m all sit at face level when user holds phone at
          //     chest height (camY 1.4) and hit-test is close (0.3-1m).
          //     User's gaze axis hits the upper ornaments, not the
          //     pebble base on the floor → reads as floating.
          //
          // OTA mitigation (no EAS rebuild needed):
          //   - Shrink upper ornaments to drop below face level
          //   - Strengthen contact shadow (#1 perceptual cue for
          //     "object on ground")
          //   - All keys go through CairnGlobals.SafeClamp; bad values
          //     are clamped, never invisible
          //
          // Each setGlobal posts to CairnBridge.OnSetGlobal at runtime.
          // CairnGlobals applies clamp + caches; subsequent spawn-time
          // reads see the new values. Cairns spawned BEFORE these
          // dispatches keep their built-time values; the bulk-spawn at
          // first ArFrame happens AFTER ArReady so it picks up these.
          {
            const groundedDefaults: Array<[string, number]> = [
              ['PortalScale', 0.6],          // 1.0 → 0.6 — 40% smaller halo at close range
              ['HeroRibbonHeight', 0.8],     // 1.5 → 0.8 — ribbons at chest, not face
              ['HeroRibbonCount', 3],        // 6 → 3 — less visual mass
              ['WispHeight', 0.7],           // 1.0 → 0.7 — wisps below face
              ['TextHeight', 0.7],           // 1.0 → 0.7 — runes at 0.91m not 1.3m
              ['LikeBadgeFloatHeight', 1.0], // 1.6 → 1.0 — heart badge at chest
              ['ContactShadowAlpha', 0.85],  // 0.55 → 0.85 — strong dark shadow #1 grounding cue
              ['ContactShadowRadiusMul', 1.4], // 1.0 → 1.4 — wider shadow base
              // v227 — DISABLE summon animation. v226 telemetry id=791-792
              // confirmed cairn rises from finalY-0.30 UP to finalY (ease-out
              // cubic, 0.4s). User's report "出现的时候是升上来的 → 感觉浮空"
              // is the animation itself, not a Y bug. SummonEnabled=0 makes
              // the cairn appear instantly at finalY — no rise, no descend.
              // PortalSpawnerV199.cs reads this OTA flag at line 188-191;
              // when false the entire summon coroutine is skipped (cairn
              // settles at finalPos on first frame).
              ['SummonEnabled', 0],          // true → false — no rise animation
              ['SummonRiseDistance', 0.0],   // safety: also zero the magnitude
            ];
            try {
              for (const [name, value] of groundedDefaults) {
                if (unityRef.current) {
                  unityRef.current.postMessage(
                    'CairnBridge', 'OnSetGlobal',
                    JSON.stringify({ name, value })
                  );
                }
              }
              crashLogger.breadcrumb(
                `${TAG}:v226-grounded-defaults pushed=${groundedDefaults.length}`
              );
            } catch (e: any) {
              crashLogger.breadcrumb(
                `${TAG}:v226-grounded-defaults-error ${String(e?.message ?? e).slice(0, 80)}`
              );
            }
          }
          // v199 review B3 fix: per-session GPS offset compensation.
          // ArReady ONLY flips the ref now — bulk-spawn deferred until
          // first ArFrame produces a usable userPos AND arOrigin, then
          // OnSetSessionOffset is sent BEFORE bulk-spawn so Unity has
          // the offset before any cairn renders. Avoids races V2.B5.
          break;

        case 'PlaneDetected':
          {
            // v206 B1 — old code was "last plane wins regardless of area",
            // so a 0.3-m² outlier could overwrite a 1.9-m² stable plane
            // (baseline plant 5 evidence). New policy:
            //   1. If Unity has already broadcast a tier=A/B lock via
            //      UnityLog, ignore PlaneDetected (Unity owns ground now).
            //   2. Otherwise drop tiny planes (area<0.5).
            //   3. Buffer last 5s of valid planes; pick the largest area
            //      as authoritative groundY. Ties → most recent.
            //   4. Keep the >0.5m diagnostic so cross-plane jumps are
            //      still visible in telemetry.
            const prev = groundYRef.current;
            if (prev !== null && Math.abs(msg.y - prev) > 0.5) {
              crashLogger.breadcrumb(
                `${TAG}:ground-jump from=${prev.toFixed(2)} to=${msg.y.toFixed(2)} delta=${(msg.y - prev).toFixed(2)}`
              );
            }
            crashLogger.breadcrumb(
              `${TAG}:recv:PlaneDetected y=${msg.y.toFixed(2)} area=${msg.area.toFixed(1)}`
            );
            // v208 — removed `if (groundLockedRef.current) break` gate.
            // RN no longer trusts Unity's per-cairn lock as session-wide
            // authority (see UnityLog case for rationale). Area-weighted
            // PlaneDetected buffer is now the sole RN-side ground signal.
            const MIN_AREA = 0.5;
            const STALE_MS = 5000;
            const now = Date.now();
            // Drop stale entries.
            recentPlanesRef.current = recentPlanesRef.current.filter(
              p => now - p.t < STALE_MS
            );
            observedPlaneYsRef.current = observedPlaneYsRef.current.filter(
              p => now - p.t < STALE_MS
            );
            // Always record the observation (even if rejected later) so
            // bottom-third heuristic has a full Y range.
            observedPlaneYsRef.current.push({ y: msg.y, t: now });
            // v224 F4-tightened — REJECT planes that are too high (likely
            // tabletop / shelf / bed top, not floor). TWO criteria:
            //
            //   (a) camY-relative: plane.y > camY - 0.8m → reject
            //       v220 used camY-0.5 which empirically failed (let
            //       plane y=-0.07 through with camY≈+0.4 = wardrobe top).
            //       camY-0.8: phone at chest height ≈1.4m AGL → floor at
            //       -1.4 (≥0.8 below cam); tabletops ~0.7m below cam are
            //       caught. Industry-standard hold-height assumption.
            //
            //   (b) bottom-third heuristic: plane must be in bottom 1/3 of
            //       observed Y range over last 5s. Defense for rooms where
            //       multiple tabletops appear before any floor — a tabletop
            //       at y=-0.4 might pass criterion (a) if user crouched
            //       (camY=+0.5 → threshold=-0.3, plane -0.4<-0.3 passes),
            //       but fails (b) because the entire observed range is
            //       still upper-floor.
            //
            // Both must pass. F4 protects bulk-spawn's shared seed value
            // (groundYRef → data.y for ALL N markers in bulk-spawn → Unity
            // Tier-A uses it as 'closest-to-tap-y' tiebreaker). Single-
            // point plant path is cosmetic on RN side (Unity overrides),
            // but bulk path is load-bearing. See subagent#5-D analysis.
            const lastCamY = lastCameraYRef.current;
            const aboveFloorThreshold = lastCamY != null ? lastCamY - 0.8 : null;
            const isAboveCamThreshold =
              aboveFloorThreshold != null && msg.y > aboveFloorThreshold;
            // Bottom-third: only meaningful with at least 3 observations
            // AND a meaningful spread. v224 telemetry showed this rejected
            // real floor (-0.95) when the entire observed cluster was
            // floor-tier (range 0.19m): 34% cutoff demanded plane be in
            // the lowest 0.065m which is tighter than ARKit's plane jitter.
            // v225 fixes: (a) require range >= 0.5m before bot3 can reject
            // (a 0.5m range means there's a clear high-tier above floor —
            // tabletops/beds are typically 0.5-1.5m above floor); (b)
            // absolute-distance floor: plane within 0.20m of minY always
            // passes (typical floor jitter is <0.10m, so 0.20m gives ample
            // margin while still catching obvious tabletops 0.5m+ above).
            let isInBottomThird = true;
            if (observedPlaneYsRef.current.length >= 3) {
              const ys = observedPlaneYsRef.current.map(p => p.y);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const range = maxY - minY;
              // v225 — only apply percentile-cutoff rejection when the
              // observed range is wide enough to confidently distinguish
              // floor from tabletop. Below 0.5m, all observed planes are
              // likely the same physical surface (floor cluster) and any
              // reject is a false positive.
              if (range >= 0.5) {
                const cutoff = minY + range * 0.34;
                // v225 — also accept any plane within 0.20m of the lowest
                // observed plane (absolute distance floor), regardless of
                // percentile. This is the floor-cluster safety net.
                const withinAbsoluteFloorBand = msg.y <= minY + 0.20;
                isInBottomThird = withinAbsoluteFloorBand || msg.y <= cutoff;
              }
            }
            const isLikelyTabletop = isAboveCamThreshold || !isInBottomThird;
            if (isLikelyTabletop) {
              crashLogger.breadcrumb(
                `${TAG}:ground-reject-tabletop y=${msg.y.toFixed(2)} camY=${lastCamY != null ? lastCamY.toFixed(2) : 'null'} threshold=${aboveFloorThreshold != null ? aboveFloorThreshold.toFixed(2) : 'null'} area=${msg.area.toFixed(1)} aboveCam=${isAboveCamThreshold} bot3=${isInBottomThird}`
              );
              break;
            }
            if (msg.area >= MIN_AREA) {
              recentPlanesRef.current.push({ y: msg.y, area: msg.area, t: now });
              // v225 — pick the LOWEST plane among large-enough candidates,
              // not the largest-area. Production v224 telemetry showed the
              // largest-area policy choosing y=-0.06 (small wardrobe top)
              // over y=-0.86 (real floor) because of buffer ordering and
              // plane size noise — area is not a reliable proxy for "is
              // this floor". Lowest-Y in the post-F4-filtered buffer is
              // a stronger signal: anything that survived F4 is plausibly
              // floor-like, and among those the lowest is most likely the
              // actual floor (tabletops/beds always sit ABOVE the floor).
              // F4's reject already screens out clear non-floor.
              let best = recentPlanesRef.current[0];
              for (const p of recentPlanesRef.current) {
                if (p.y < best.y) best = p;
              }
              groundYRef.current = best.y;
            } else if (groundYRef.current === null) {
              // Cold start — no prior plane and this one is too small.
              // Use it temporarily; the next ≥0.5m plane will replace it.
              groundYRef.current = msg.y;
            }
            // else: small plane arrived after a larger one was buffered →
            // ignore (do not overwrite a stronger signal).
          }
          break;

        case 'ArFrame':
          lastFrameRef.current = Date.now();
          // v220 F4 — track latest camera Y for PlaneDetected anti-tabletop rule.
          lastCameraYRef.current = msg.py;
          // OTA #181: one-shot breadcrumb on first ArFrame. Reveals whether
          // pose is real (AR tracking) or parser's null→default fallback
          // (parser recovered from F3 corruption but Unity still broken).
          if (firstFrameRef.current) {
            firstFrameRef.current = false;
            crashLogger.breadcrumb(
              `${TAG}:recv:first-ArFrame px=${msg.px.toFixed(2)} py=${msg.py.toFixed(2)} pz=${msg.pz.toFixed(2)} fx=${msg.fx.toFixed(2)} fy=${msg.fy.toFixed(2)} fz=${msg.fz.toFixed(2)}`
            );
          }
          // v199 review B3 — per-session GPS offset compensation. Once
          // we have userPos AND arOrigin (from props), compute the offset
          // and send OnSetSessionOffset to Unity BEFORE bulk-spawn. Then
          // run bulk-spawn using arOrigin (persisted) as projection origin
          // so cairns land at correct world positions even after walking
          // 100m and re-entering AR.
          //
          // v206 A1+A2 — two changes from v205:
          //   (A1) bulk-spawn one-shot is NO LONGER burned when markers list
          //        is empty. Empty markers means GPS lastCoord race or store
          //        hydration delay — next ArFrame at 10Hz retries until
          //        markers populate. Burning prematurely was the root cause
          //        of "close+reopen AR → all markers gone" (baseline Run B).
          //   (A2) OnSetSessionOffset re-sends when projOrigin transitions
          //        null→persisted or persisted→different (post-staleness
          //        relock). Old offsetSentRef one-shot burned at first frame
          //        with mode=live ox=0 oz=0 even when arOrigin was about to
          //        lock 1s later — so Unity NEVER received a real persisted
          //        offset (baseline Run A: 5/5 OnSetSessionOffset events all
          //        ox=0/oz=0/mode=live).
          if (
            arReadyRef.current &&
            !bulkSpawnedRef.current &&
            props.userPos &&
            unityRef.current
          ) {
            // v211 — REVERT v210 virtualOrigin. v210 was wrong:
            // it computed origin = userPos shifted by camera.pz/111000 each
            // session, treating camera position as if it represented user's
            // GPS displacement. Two compounding errors caused 'cairn 偏到
            // 奶奶家':
            //   1. Unity ARFoundation does NOT set worldAlignment=
            //      GravityAndHeading. ARKit defaults to ARWorldAlignmentGravity
            //      where +X axis = phone-facing direction at session start
            //      (NOT true east). Every "+X=East, -Z=North" comment in
            //      this codebase is aspirational. Cairn directions have
            //      always been wrong; v210 didn't introduce that.
            //   2. v210 baked camera.px/pz into projOrigin EVERY frame,
            //      so ARKit's normal 6m+ camera drift across reopens
            //      shifted virtualOrigin 6m+, then re-projected cairns
            //      to be 6m further off, then walked another step and
            //      compounded. Unbounded error.
            //
            // Viro's working pattern (pre-d3f9e26): lock arOrigin once at
            // first userPos of session, projOrigin = arOrigin always,
            // ARKit SLAM keeps cairn visually stable within a session.
            // GPS only used to establish the anchor at first plant. Cairn
            // lat/lng + GPS-flat-projection → ARKit world coord, no
            // per-frame virtualOrigin recomputation.
            //
            // Compass-direction bug (Error 1) still present after this
            // revert — needs EAS build with native iOS plugin to set
            // worldAlignment=GravityAndHeading. Tracked separately.
            const persisted = props.arOrigin
              ? { lat: props.arOrigin.lat, lng: props.arOrigin.lng }
              : null;
            const live = { lat: props.userPos.lat, lng: props.userPos.lng };
            const projOrigin = persisted ?? live;
            // v0.2.3 — sessionOffset PERMANENTLY HARDCODED TO 0.
            //
            // Product semantics (correct, locked 2026-06-11 by user):
            //   每个 cairn 插下去那一刻 = 永久世界坐标固定 (lat,lng + ARKit
            //   world anchor)。不管用户如何打开 AR / 走多远 / GPS 怎么抖，
            //   cairn 不会移动。最多 GPS 抖几下小范围 (<1-2m) 看起来不动。
            //
            // History — every prior implementation was WRONG:
            //   v210: virtualOrigin per-frame from camera → unbounded drift
            //   v220: (live-persisted)*111000 → cairn pushed to wherever
            //         user walked, breaking absolute world-coord invariant
            //   v228: clamp |offset|>5m → 0 (band-aid on v220's wrong model)
            //   v0.2.3 Stage 2 (this file's prior version): 1-50m three-band
            //         → still pushed cairns at user, just within "reasonable"
            //         distance. ALSO WRONG.
            //
            // The correct invariant: cairn's ARKit world position is set
            // ONCE at spawn from (cairn.lat, cairn.lng, projOrigin.lat,
            // projOrigin.lng) → meters via cosLat projection inside
            // buildSpawnRequest. After spawn, ARKit SLAM keeps cairn
            // visually stable. sessionOffset must NOT translate cairns
            // post-spawn — that was the bug.
            //
            // We still send ox=0 oz=0 ONCE per (projOrigin lat,lng) change
            // so Unity's static _sessionOffsetX/Z is reset cleanly when
            // arOrigin hydrates from MMKV.
            const offsetN = 0;
            const offsetE = 0;
            crashLogger.breadcrumb(
              `[v22-SESSION-OFFSET] decision=zero-locked mode=${persisted ? 'persisted' : 'live'}`
            );
            // ARKit GravityAndHeading: +X=East, -Z=North (Apple right-handed
            // convention). sessionOffset Vector3 = (offsetE, 0, -offsetN).
            const sent = lastSentOriginRef.current;
            const originChanged =
              !sent ||
              sent.lat !== projOrigin.lat ||
              sent.lng !== projOrigin.lng;
            if (originChanged) {
              try {
                unityRef.current.postMessage(
                  'CairnBridge',
                  'OnSetSessionOffset',
                  JSON.stringify({ ox: offsetE, oz: -offsetN }),
                );
                lastSentOriginRef.current = { lat: projOrigin.lat, lng: projOrigin.lng };
                crashLogger.breadcrumb(
                  `${TAG}:OnSetSessionOffset ox=${offsetE.toFixed(2)} oz=${(-offsetN).toFixed(2)} mode=${persisted ? 'persisted' : 'live'}`
                );
              } catch (e) {
                crashLogger.breadcrumb(`${TAG}:OnSetSessionOffset:fail ${String(e).slice(0, 80)}`);
              }
            }
            // Then bulk-spawn (one-shot) using virtualOrigin.
            let dispatched = 0;
            const nowTs = Date.now();
            if (props.markers.length > 0) {
              for (const m of props.markers) {
                if (spawnedIdsRef.current.has(m.id)) continue;
                // Branch B v3-review-fix: respect throttled rejection backoff.
                // If this marker was recently rejected and its next-retry-at is
                // in the future, skip — try next ArFrame iteration.
                const tracker = rejectionTrackerRef.current.get(m.id);
                if (tracker) {
                  if (tracker.attempts > 6) continue;             // blacklisted
                  if (nowTs < tracker.nextRetryAt) continue;       // backoff
                }
                const req = buildSpawnRequest(
                  { id: m.id, type: m.type, lat: m.lat, lng: m.lng, note: m.note },
                  projOrigin,
                  groundYRef.current,
                );
                if (req && dispatchSpawn(req)) dispatched += 1;
              }
              crashLogger.breadcrumb(
                `${TAG}:bulk-spawn requested=${props.markers.length} dispatched=${dispatched} origin=${persisted ? 'persisted' : 'live'}`
              );
            }
            // v206 A1 — only burn the one-shot when we actually
            // accomplished something. Empty marker list does NOT count
            // (markers may be hydrating from MMKV or lastCoord filter
            // may not yet have nearby matches — next ArFrame retries).
            // Branch B v3-review-fix: also keep one-shot OFF when any
            // marker has a pending throttled retry — the bulk-spawn loop
            // needs to fire again at backoff time, not stay locked.
            const hasMarkers = props.markers.length > 0;
            const allCovered = hasMarkers && props.markers.every(m => spawnedIdsRef.current.has(m.id));
            const hasPendingRetry = hasMarkers && props.markers.some(m => {
              const tr = rejectionTrackerRef.current.get(m.id);
              return tr != null && tr.attempts <= 6 && !spawnedIdsRef.current.has(m.id);
            });
            if ((dispatched > 0 || allCovered) && !hasPendingRetry) {
              bulkSpawnedRef.current = true;
            } else if (!hasMarkers) {
              // Telemetry: track how long markers stay empty post-ArReady.
              // Logs at frame 30 (~3s) and 100 (~10s) — bounded so it does
              // not spam. If it ever logs frames=100 with markers=0 +
              // userPos=true, the marker-store hydration likely failed.
              emptyMarkerFrameCountRef.current += 1;
              if (
                emptyMarkerFrameCountRef.current === 30 ||
                emptyMarkerFrameCountRef.current === 100
              ) {
                crashLogger.breadcrumb(
                  `${TAG}:bulk-spawn:waiting-markers frames=${emptyMarkerFrameCountRef.current} userPos=${!!props.userPos} arOrigin=${!!props.arOrigin}`
                );
              }
            }
          }
          // Don't breadcrumb every ArFrame (10Hz would flood ring buffer).
          if (props.onArFrame) {
            props.onArFrame({
              camera: {
                position: [msg.px, msg.py, msg.pz],
                forward: [msg.fx, msg.fy, msg.fz],
              },
              cairns: [], // Phase 1 Spike: empty (RN computes elsewhere)
              origin: props.userPos
                ? { lat: props.userPos.lat, lng: props.userPos.lng, alt: props.userPos.alt }
                : null,
              groundY: groundYRef.current,
            });
          }
          break;

        case 'ArSessionState':
          crashLogger.breadcrumb(`${TAG}:recv:ArSessionState ${msg.state}`);
          break;

        case 'A1State': {
          // v0.2.3 Stage 4 — Unity GroundYResolver A1 FSM transition
          // (UNLOCKED/ARMED/LOCKED/FROZEN). Plumbed into useArOriginStore
          // (A4) so the Plant button enable rule (Plan v4 line 135) can
          // be computed in RN: arOriginLocked && a1State==LOCKED &&
          // (now - lastA1TransitionAt) > 500ms.
          // unityBridge already narrowed msg.state to the 4-value union.
          crashLogger.breadcrumb(
            `${TAG}:recv:A1State next=${msg.state} prev=${msg.prev ?? '?'} a11=${msg.a11 ?? '?'}`
          );
          useArOriginStore.getState().onA1State(msg.state as A4_A1State);
          break;
        }

        case 'Pong':
          crashLogger.breadcrumb(`${TAG}:recv:Pong token=${msg.token}`);
          break;

        case 'XRDiag':
          // The smoking-gun signal for "ARKit Loader not registered at
          // runtime". loaderCount=0 OR managerNull=true means no AR
          // subsystem is loaded → ARSession will never advance →
          // screen black + no ArReady. This is a one-shot per launch.
          crashLogger.breadcrumb(
            `${TAG}:recv:XRDiag phase=${msg.phase} managerNull=${msg.managerNull ?? '?'} loaderCount=${msg.loaderCount ?? '?'} loaders=${msg.loaders ?? '?'}${msg.error ? ' error=' + msg.error : ''}`
          );
          break;

        case 'ARBgDiag':
          // ARCameraBackground component state. If present=false or
          // enabled=false, camera feed won't composite → black screen
          // even when AR session runs. This isolates "AR works but feed
          // hidden" from "AR doesn't work".
          // phase=first-update: state at startup
          // phase=ar-ready: state at SessionTracking — definitive black-feed
          //   detection (LOG-GAP-1). materialNull=true means the bg
          //   shader/material wasn't bound → render outputs nothing.
          crashLogger.breadcrumb(
            `${TAG}:recv:ARBgDiag phase=${msg.phase} present=${msg.present ?? '?'} enabled=${msg.enabled ?? '?'} customMat=${msg.useCustomMaterial ?? '?'} matNull=${msg.materialNull ?? '?'}${msg.error ? ' error=' + msg.error : ''}`
          );
          break;

        case 'ARStateStall':
          // Watchdog: 10s after Unity Awake, ARSession still hasn't advanced.
          // Critical signal — XR loader exists (per XRDiag) but ARKit subsystem
          // is silently failing. activeLoaders count tells us if loader is even
          // claimed-active at this point.
          crashLogger.breadcrumb(
            `${TAG}:recv:ARStateStall state=${msg.state} elapsed=${msg.elapsedSec}s activeLoaders=${msg.activeLoaders}`
          );
          // Force-upload: this is the smoking-gun signal we want server-side immediately.
          crashLogger.uploadDiagnostic(API_BASE_URL, 'ar-state-stall').catch(() => undefined);
          break;

        case 'SpawnRejected': {
          // v0.2.3 Branch B v3-review-fix — throttled retry.
          // Without throttle, wall/ceiling locations create 60Hz retry storm.
          // Strategy: exponential backoff per marker id. Attempt 1 = 0.5s,
          // 2 = 1s, 3 = 2s, 4 = 4s, then capped at 4s. After 6 attempts the
          // marker is blacklisted for the rest of this session (user must
          // reopen AR to retry).
          spawnedIdsRef.current.delete(msg.id);
          const now = Date.now();
          const tracker = rejectionTrackerRef.current.get(msg.id) ?? { nextRetryAt: 0, attempts: 0 };
          tracker.attempts += 1;
          const backoffMs = Math.min(4000, 500 * Math.pow(2, tracker.attempts - 1));
          tracker.nextRetryAt = now + backoffMs;
          rejectionTrackerRef.current.set(msg.id, tracker);
          if (tracker.attempts <= 6) {
            // Within budget — schedule a single retry attempt at backoff time.
            // bulkSpawnedRef stays true; we manage retry per-id, not via the
            // global bulk-spawn one-shot (avoids 60Hz pump).
            crashLogger.breadcrumb(
              `${TAG}:spawn-rejected id=${msg.id} reason=${msg.reason} attempt=${tracker.attempts} retryIn=${backoffMs}ms`
            );
          } else {
            // Blacklist this id for the rest of the session.
            crashLogger.breadcrumb(
              `${TAG}:spawn-rejected id=${msg.id} reason=${msg.reason} BLACKLISTED-after-6-attempts`
            );
          }
          if (typeof (globalThis as any).__cairnPlantRejected === 'function') {
            const userMessage = msg.reason === 'no-floor'
              ? '指向地面再 plant'
              : msg.reason === 'anchor-failed'
              ? 'AR 锚定失败，重试'
              : '种植失败，重试';
            (globalThis as any).__cairnPlantRejected(userMessage);
          }
          break;
        }

        case 'Unknown':
          crashLogger.breadcrumb(
            `${TAG}:recv:unknown raw=${msg.raw.slice(0, 80)}`
          );
          break;
      }
    },
    [props]
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        crashLogger.breadcrumb(`${TAG}:view-layout w=${Math.round(width)} h=${Math.round(height)}`);
      }}
    >
      <UnityView
        ref={unityRef}
        style={StyleSheet.absoluteFill}
        onUnityMessage={onUnityMessage}
        fullScreen={true}
      />
    </View>
  );
});
