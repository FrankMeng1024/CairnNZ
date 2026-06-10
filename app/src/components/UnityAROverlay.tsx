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
            if (msg.area >= MIN_AREA) {
              recentPlanesRef.current.push({ y: msg.y, area: msg.area, t: now });
              // Pick the largest-area plane in the rolling buffer.
              let best = recentPlanesRef.current[0];
              for (const p of recentPlanesRef.current) {
                if (p.area > best.area) best = p;
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
            // Choose projection origin: prefer persisted arOrigin (V118),
            // fall back to live userPos for new users with no anchor yet.
            const persisted = props.arOrigin
              ? { lat: props.arOrigin.lat, lng: props.arOrigin.lng }
              : null;
            const live = { lat: props.userPos.lat, lng: props.userPos.lng };
            const projOrigin = persisted ?? live;
            // Compute offset (live - persisted). When persisted is null,
            // offset is 0 (live IS the projection origin). When persisted
            // exists, offset = how far user has moved since lock.
            let offsetN = 0;
            let offsetE = 0;
            if (persisted) {
              const cosLat = Math.cos((persisted.lat * Math.PI) / 180);
              offsetN = (live.lat - persisted.lat) * 111000;
              offsetE = (live.lng - persisted.lng) * 111000 * cosLat;
            }
            // ARKit GravityAndHeading: +X=East, +Y=Up, -Z=North.
            // sessionOffset Vector3 = (offsetE, 0, -offsetN).
            // v206 A2 — re-send when projOrigin changes (lat/lng equality).
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
            // Then bulk-spawn (one-shot) using projOrigin.
            let dispatched = 0;
            if (props.markers.length > 0) {
              for (const m of props.markers) {
                if (spawnedIdsRef.current.has(m.id)) continue;
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
            const hasMarkers = props.markers.length > 0;
            const allCovered = hasMarkers && props.markers.every(m => spawnedIdsRef.current.has(m.id));
            if (dispatched > 0 || allCovered) {
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
