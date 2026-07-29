/**
 * SimWalkerOverlay — v441 with settings modal
 *
 * v441 UX:
 *   - 3 buttons above joystick (⚙ settings / ↶ undo / 🏠 reset)
 *   - Settings modal lets user tune: step distance (m), emit interval
 *     (ms), undo count. Defaults chosen from real GPS analysis.
 *   - Joystick anchored bottom-right; button column stacked directly
 *     above joystick so they never overlap other UI (recenter icon
 *     is bottom-right too, on the OTHER side; we live on left side).
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Animated, TouchableOpacity,
  Platform, Modal, TextInput, Pressable,
} from 'react-native';
import { useTrackingStore } from '../../store/useTrackingStore';
import { gpsInjector, DEFAULT_STEP_CONFIG, type StepConfig } from './gpsInjector';
import { useSimWalkerStore } from './useSimWalkerStore';
import { log } from '../../services/appLog';

const JOY_SIZE = 130;
const JOY_STICK = 50;
const JOY_MAX = 45;

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const c = s1 * s1 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * s2 * s2;
  return 2 * R * Math.atan2(Math.sqrt(c), Math.sqrt(1 - c));
}

function StartAnchorHint() {
  const anchor = useSimWalkerStore((s) => s.startAnchor);
  const [distM, setDistM] = useState(0);
  useEffect(() => {
    if (!anchor) return;
    const tick = () => {
      const cur = useTrackingStore.getState().lastCoordinate;
      if (cur) setDistM(haversineM(anchor, cur));
    };
    tick();
    const h = setInterval(tick, 500);
    return () => clearInterval(h);
  }, [anchor]);
  if (!anchor) return null;
  return (
    <Text style={styles.anchorHint}>
      Walked {distM < 1000 ? `${Math.round(distM)}m` : `${(distM/1000).toFixed(1)}km`}
    </Text>
  );
}

export function SimWalkerOverlay() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<StepConfig>(DEFAULT_STEP_CONFIG);
  const [draft, setDraft] = useState<{ step_m: string; emit_ms: string; undo_count: string }>({
    step_m: String(DEFAULT_STEP_CONFIG.step_m),
    emit_ms: String(DEFAULT_STEP_CONFIG.emit_ms),
    undo_count: String(DEFAULT_STEP_CONFIG.undo_count),
  });

  useEffect(() => {
    const cur = useTrackingStore.getState().lastCoordinate;
    log('v441.overlay.mount', {
      has_last_coord: cur !== null,
      lat: cur ? Number(cur.lat.toFixed(6)) : null,
      lng: cur ? Number(cur.lng.toFixed(6)) : null,
    });
    if (cur) {
      gpsInjector.setStartPosition(cur.lat, cur.lng);
      useSimWalkerStore.getState().setStartAnchor({ lat: cur.lat, lng: cur.lng });
    }
    gpsInjector.start();
    return () => {
      log('v441.overlay.unmount', {});
      gpsInjector.stop();
      useSimWalkerStore.getState().setStartAnchor(null);
    };
  }, []);

  const openSettings = () => {
    const cur = gpsInjector.getConfig();
    log('v441.overlay.open_settings', { config: cur });
    setDraft({
      step_m: String(cur.step_m),
      emit_ms: String(cur.emit_ms),
      undo_count: String(cur.undo_count),
    });
    setConfig(cur);
    setSettingsOpen(true);
  };

  const saveSettings = () => {
    const next: Partial<StepConfig> = {
      step_m: parseFloat(draft.step_m),
      emit_ms: parseFloat(draft.emit_ms),
      undo_count: parseInt(draft.undo_count, 10),
    };
    log('v441.overlay.save_settings', { draft, parsed: next });
    // O7 (2026-07-26): close modal FIRST so a downstream throw in
    // setStepConfig cannot strand the user inside the settings modal.
    // Was the underlying Bug 4 root cause per user 2026-07-26 report
    // (two save_settings logs at 09:06:05 = user tapped 确定 twice
    // because first tap didn't visibly close the modal).
    setSettingsOpen(false);
    try {
      gpsInjector.setStepConfig(next);
      setConfig(gpsInjector.getConfig());
    } catch (err) {
      log('v441.overlay.save_settings_err', { err: String(err) });
    }
  };

  const doUndo = () => {
    log('v441.overlay.undo_tap', { will_undo: config.undo_count });
    gpsInjector.undoSteps();
  };

  const doReset = async () => {
    // v447: ⟲ 语义是"把地图中心当作新的当前位置"。
    // Old semantics (回到 startAnchor) was wrong per user 2026-07-24.
    // Query the current map viewport center via the provider registered
    // by HikingScreen, then teleport injector.currentPos to it.
    // Also clears lastCoordinate inside setStartPosition to defuse any
    // teleport gates further downstream.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCurrentMapCenter } = require('./mapCenterProvider');
    const center = await getCurrentMapCenter();
    log('v447.overlay.reset_tap', {
      has_center: !!center,
      lat: center ? Number(center.lat.toFixed(6)) : null,
      lng: center ? Number(center.lng.toFixed(6)) : null,
    });
    if (center) {
      gpsInjector.setStartPosition(center.lat, center.lng);
      useSimWalkerStore.getState().setStartAnchor({ lat: center.lat, lng: center.lng });
    } else {
      // Fallback: if map isn't ready, fall back to lastCoordinate.
      const cur = useTrackingStore.getState().lastCoordinate;
      if (cur) {
        gpsInjector.setStartPosition(cur.lat, cur.lng);
        useSimWalkerStore.getState().setStartAnchor({ lat: cur.lat, lng: cur.lng });
      }
    }
  };

  // 360° joystick
  const stickX = useRef(new Animated.Value(0)).current;
  const stickY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        log('v441.overlay.joy_grant', {});
        stickX.setValue(0);
        stickY.setValue(0);
      },
      onPanResponderMove: (_evt, gs) => {
        const dx = gs.dx;
        const dy = gs.dy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampScale = dist > JOY_MAX ? JOY_MAX / dist : 1;
        const cx = dx * clampScale;
        const cy = dy * clampScale;
        stickX.setValue(cx);
        stickY.setValue(cy);
        const bearingRad = Math.atan2(cx, -cy);
        const strength = Math.min(1, dist / JOY_MAX);
        gpsInjector.setJoystick(bearingRad, strength);
      },
      onPanResponderRelease: () => {
        log('v441.overlay.joy_release', {});
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
      onPanResponderTerminate: () => {
        log('v441.overlay.joy_terminate', {});
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Left side: joystick + 3 buttons above it. Right side stays free. */}
      <View style={styles.column} pointerEvents="auto">
        {/* Row of 3 buttons, above joystick */}
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={openSettings} activeOpacity={0.7}>
            <Text style={styles.btnIcon}>⚙</Text>
            <Text style={styles.btnLabel}>设置</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={doUndo} activeOpacity={0.7}>
            <Text style={styles.btnIcon}>↶</Text>
            <Text style={styles.btnLabel}>撤销 {config.undo_count}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={doReset} activeOpacity={0.7}>
            <Text style={styles.btnIcon}>⟲</Text>
            <Text style={styles.btnLabel}>定位</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.joyRoot} {...panResponder.panHandlers}>
          <View style={styles.joyBase} />
          <Animated.View
            style={[
              styles.joyStick,
              { transform: [{ translateX: stickX }, { translateY: stickY }] },
            ]}
          />
          <Text style={styles.joyLabel}>拖动走 · {config.step_m}m/{Math.round(config.emit_ms/100)/10}s</Text>
        </View>
        <StartAnchorHint />
      </View>

      {/* Settings modal */}
      <Modal visible={settingsOpen} transparent animationType="fade" onRequestClose={() => setSettingsOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSettingsOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>模拟行走设置</Text>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowLabel}>每步距离(米)</Text>
              <TextInput
                style={styles.modalRowInput}
                value={draft.step_m}
                onChangeText={(v) => setDraft((d) => ({ ...d, step_m: v }))}
                keyboardType="decimal-pad"
              />
            </View>
            <Text style={styles.modalRowHint}>推荐 5。越大跑得越快</Text>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowLabel}>每步间隔(毫秒)</Text>
              <TextInput
                style={styles.modalRowInput}
                value={draft.emit_ms}
                onChangeText={(v) => setDraft((d) => ({ ...d, emit_ms: v }))}
                keyboardType="number-pad"
              />
            </View>
            <Text style={styles.modalRowHint}>推荐 1000(1 秒)。越小越快</Text>

            <View style={styles.modalRow}>
              <Text style={styles.modalRowLabel}>撤销步数</Text>
              <TextInput
                style={styles.modalRowInput}
                value={draft.undo_count}
                onChangeText={(v) => setDraft((d) => ({ ...d, undo_count: v }))}
                keyboardType="number-pad"
              />
            </View>
            <Text style={styles.modalRowHint}>撤销按钮一次退多少步</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setSettingsOpen(false)}>
                <Text style={styles.modalCancelText}>取消</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalOk} onPress={saveSettings}>
                <Text style={styles.modalOkText}>确定</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    ...(Platform.OS === 'web' ? { zIndex: 9999 as unknown as number } : null),
  },
  column: {
    position: 'absolute',
    bottom: 30,
    left: 12,
    alignItems: 'center',
  },
  btnRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  btn: {
    width: 56,
    height: 44,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#5d7c46',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  btnIcon: {
    fontSize: 15,
    color: '#5d7c46',
    lineHeight: 17,
  },
  btnLabel: {
    fontSize: 9,
    color: '#5d7c46',
    fontWeight: '600',
    marginTop: 1,
  },
  joyRoot: {
    width: JOY_SIZE,
    height: JOY_SIZE,
    borderRadius: JOY_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius: 6,
    elevation: 5,
  },
  joyBase: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: JOY_SIZE / 2,
    borderWidth: 2,
    borderColor: '#999',
    borderStyle: 'dashed',
  },
  joyStick: {
    width: JOY_STICK,
    height: JOY_STICK,
    borderRadius: JOY_STICK / 2,
    backgroundColor: '#5d7c46',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  joyLabel: {
    position: 'absolute',
    top: -22,
    fontSize: 10,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    fontWeight: '600',
  },
  anchorHint: {
    marginTop: 8,
    fontSize: 10,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.94)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    fontWeight: '600',
    alignSelf: 'flex-start',
  },
  // Settings modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111',
    marginBottom: 14,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  modalRowLabel: {
    flex: 1,
    fontSize: 14,
    color: '#333',
  },
  modalRowInput: {
    width: 80,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    fontSize: 14,
    color: '#111',
    textAlign: 'right',
  },
  modalRowHint: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    marginLeft: 4,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  modalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalCancelText: {
    fontSize: 14,
    color: '#666',
  },
  modalOk: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#5d7c46',
  },
  modalOkText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '700',
  },
});
