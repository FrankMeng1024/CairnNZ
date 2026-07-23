/**
 * SimWalkerOverlay — v434 free-walk mode
 *
 * v434 rewrite. Removed:
 *   - Left-top HUD with A/B pickers, coord inputs, Plan/Reset buttons
 *   - Route planning (Mapbox Directions call) — no snap-to-road
 *   - All progress/phase/speed readouts
 *
 * What remains: a single 360° joystick anchored bottom-right of the
 * screen. Drag the thumb in any direction → user's simulated GPS
 * advances in that bearing at "1 step per 500 ms" (0.7 m per step at
 * full push, scaled by push distance). Release → stops.
 *
 * The injector uses whatever the user's current tracked position is
 * as the starting point when the overlay mounts (or updates whenever
 * the real GPS emits a fix before the user takes control).
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Animated,
  Platform,
} from 'react-native';
import { useTrackingStore } from '../../store/useTrackingStore';
import { gpsInjector } from './gpsInjector';

const JOY_SIZE = 160;
const JOY_STICK = 60;
const JOY_MAX = 55; // px thumb travel from centre

export function SimWalkerOverlay() {
  // Seed injector with the current known position at mount.
  useEffect(() => {
    const cur = useTrackingStore.getState().lastCoordinate;
    if (cur) {
      gpsInjector.setStartPosition(cur.lat, cur.lng);
    }
    gpsInjector.start();
    return () => {
      gpsInjector.stop();
    };
  }, []);

  // ── Joystick — 2D PanResponder ────────────────────────────────────
  const stickX = useRef(new Animated.Value(0)).current;
  const stickY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        stickX.setValue(0);
        stickY.setValue(0);
      },
      onPanResponderMove: (_evt, gs) => {
        // Clamp thumb to a circle of radius JOY_MAX.
        const dx = gs.dx;
        const dy = gs.dy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const clampScale = dist > JOY_MAX ? JOY_MAX / dist : 1;
        const cx = dx * clampScale;
        const cy = dy * clampScale;
        stickX.setValue(cx);
        stickY.setValue(cy);

        // Convert (cx, cy) → bearing (0 = north, clockwise, radians)
        //   In screen coords: +y is down.
        //   "North" in screen = up = -y.
        //   Bearing = atan2( +x, -y ).
        const bearingRad = Math.atan2(cx, -cy);
        const strength = Math.min(1, dist / JOY_MAX);
        gpsInjector.setJoystick(bearingRad, strength);
      },
      onPanResponderRelease: () => {
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
      onPanResponderTerminate: () => {
        gpsInjector.releaseJoystick();
        Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
        Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 140, friction: 8 }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Bottom-right joystick (360°) */}
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
});
