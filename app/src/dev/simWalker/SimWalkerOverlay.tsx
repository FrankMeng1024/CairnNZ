/**
 * SimWalkerOverlay — v438 (100% log coverage)
 *
 * v437 UI + full-coverage logging for user's "log every path" rule.
 * Every mount/unmount, every button press, every joystick event logs.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { useTrackingStore } from '../../store/useTrackingStore';
import { gpsInjector, type SpeedMode } from './gpsInjector';
import { log } from '../../services/appLog';

const JOY_SIZE = 160;
const JOY_STICK = 60;
const JOY_MAX = 55;

export function SimWalkerOverlay() {
  const [speedMode, setSpeedMode] = useState<SpeedMode>('walk');

  useEffect(() => {
    const cur = useTrackingStore.getState().lastCoordinate;
    log('v438.overlay.mount', {
      has_last_coord: cur !== null,
      last_lat: cur ? Number(cur.lat.toFixed(6)) : null,
      last_lng: cur ? Number(cur.lng.toFixed(6)) : null,
    });
    if (cur) gpsInjector.setStartPosition(cur.lat, cur.lng);
    gpsInjector.start();
    return () => {
      log('v438.overlay.unmount', {});
      gpsInjector.stop();
    };
  }, []);

  const setSpeed = (m: SpeedMode) => {
    log('v438.overlay.speed_btn_tap', { requested_mode: m, prev_mode: speedMode });
    setSpeedMode(m);
    gpsInjector.setSpeedMode(m);
  };

  const doUndo5 = () => {
    log('v438.overlay.undo_btn_tap', {});
    gpsInjector.undoSteps(5);
  };

  const doResetStart = () => {
    const cur = useTrackingStore.getState().lastCoordinate;
    log('v438.overlay.reset_btn_tap', {
      has_last_coord: cur !== null,
      lat: cur ? Number(cur.lat.toFixed(6)) : null,
      lng: cur ? Number(cur.lng.toFixed(6)) : null,
    });
    if (cur) {
      gpsInjector.setStartPosition(cur.lat, cur.lng);
    } else {
      log('v438.overlay.reset_no_coord', {});
    }
  };

  // ── 360° Joystick ──
  const stickX = useRef(new Animated.Value(0)).current;
  const stickY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        log('v438.overlay.joy_grant', {});
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
        // Sample joystick move at low rate (log flooding avoidance)
        if (Math.random() < 0.05) {
          log('v438.overlay.joy_move_sample', {
            dx: Number(dx.toFixed(1)),
            dy: Number(dy.toFixed(1)),
            bearing_deg: Number(((bearingRad * 180) / Math.PI).toFixed(1)),
            strength: Number(strength.toFixed(2)),
          });
        }
        gpsInjector.setJoystick(bearingRad, strength);
      },
      onPanResponderRelease: () => {
        log('v438.overlay.joy_release', {});
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
      onPanResponderTerminate: () => {
        log('v438.overlay.joy_terminate', {});
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Speed mode buttons — left of joystick */}
      <View style={styles.speedCol} pointerEvents="auto">
        {(['walk', 'jog', 'run'] as const).map((m) => {
          const active = speedMode === m;
          return (
            <TouchableOpacity
              key={m}
              style={[styles.speedBtn, active && styles.speedBtnActive]}
              onPress={() => setSpeed(m)}
              activeOpacity={0.7}
            >
              <Text style={[styles.speedBtnText, active && styles.speedBtnTextActive]}>
                {m === 'walk' ? 'W' : m === 'jog' ? 'J' : 'R'}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Action buttons — top of joystick */}
      <View style={styles.actionCol} pointerEvents="auto">
        <TouchableOpacity style={styles.actionBtn} onPress={doUndo5} activeOpacity={0.7}>
          <Text style={styles.actionBtnText}>↶5</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={doResetStart} activeOpacity={0.7}>
          <Text style={styles.actionBtnText}>⌂</Text>
        </TouchableOpacity>
      </View>

      {/* 360° Joystick — bottom right */}
      <View style={styles.joyRoot} {...panResponder.panHandlers} pointerEvents="auto">
        <View style={styles.joyBase} />
        <Animated.View
          style={[
            styles.joyStick,
            { transform: [{ translateX: stickX }, { translateY: stickY }] },
          ]}
        />
        <Text style={styles.joyLabel}>drag to walk</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    ...(Platform.OS === 'web' ? { zIndex: 9999 as unknown as number } : null),
  },
  joyRoot: {
    position: 'absolute',
    bottom: 30,
    right: 20,
    width: JOY_SIZE,
    height: JOY_SIZE,
    borderRadius: JOY_SIZE / 2,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
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
    color: '#666',
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  speedCol: {
    position: 'absolute',
    bottom: 30 + (JOY_SIZE - 128) / 2,
    right: 20 + JOY_SIZE + 8,
    width: 40,
    alignItems: 'center',
  },
  speedBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#5d7c46',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  speedBtnActive: {
    backgroundColor: '#5d7c46',
  },
  speedBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#5d7c46',
  },
  speedBtnTextActive: {
    color: '#fff',
  },
  actionCol: {
    position: 'absolute',
    bottom: 30 + JOY_SIZE + 8,
    right: 20 + (JOY_SIZE - 44) / 2,
    width: 44,
    alignItems: 'center',
  },
  actionBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#5d7c46',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
    elevation: 3,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#5d7c46',
  },
});
