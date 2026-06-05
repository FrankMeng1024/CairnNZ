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

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, Platform, UIManager } from 'react-native';
import UnityView from '@azesmway/react-native-unity';
import { sendToUnity, parseUnityMessage } from '../services/unityBridge';
import { crashLogger } from '../services/crashLogger';
import { API_BASE_URL } from '../config/api';
import * as FileSystem from 'expo-file-system/legacy';
import { storage } from '../store/storage';

const UNITY_CHECKPOINT_KEY = 'cairn_unity_init_step_js';

const TAG = 'unity-overlay';

type Marker = {
  id: string;
  type: string;
  lat: number;
  lng: number;
  alt?: number | null;
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

export function UnityAROverlay(props: UnityAROverlayProps) {
  const unityRef     = useRef<UnityView | null>(null);
  const groundYRef   = useRef<number | null>(null);
  const arReadyRef   = useRef(false);
  const lastFrameRef = useRef<number>(Date.now());

  // Mount lifecycle
  useEffect(() => {
    const mountTs = Date.now();
    crashLogger.breadcrumb(`${TAG}:mount markers=${props.markers.length} platform=${Platform.OS} osVersion=${Platform.Version}`);

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
          break;

        case 'PlaneDetected':
          groundYRef.current = msg.y;
          crashLogger.breadcrumb(
            `${TAG}:recv:PlaneDetected y=${msg.y.toFixed(2)} area=${msg.area.toFixed(1)}`
          );
          break;

        case 'ArFrame':
          lastFrameRef.current = Date.now();
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
}
