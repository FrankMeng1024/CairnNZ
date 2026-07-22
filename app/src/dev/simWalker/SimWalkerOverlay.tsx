/**
 * SPIKE-006 sim-walker — SimWalkerOverlay
 *
 * Floating dev-only overlay mounted on HikingScreen. Provides:
 *   - Point A / Point B pickers (source: current known GPS location
 *     via useTrackingStore.lastCoordinate, or manual lng/lat text)
 *   - "Plan route" button — hits Mapbox Directions /walking
 *   - Compact HUD (progress / speed / phase / ticks emitted)
 *   - Vertical joystick (PanResponder) — pushed up = forward, down =
 *     backward, released = zero.
 *
 * The overlay is unconditionally gated by isSimMode in HikingScreen —
 * Hermes DCE strips this file entirely from production bundles.
 *
 * Design deviation from spike: the spike used map long-press to set
 * A/B. HikingMap does not expose a long-press handler and we
 * intentionally do not want to inject dev touch handlers into a
 * production component, so we source A/B either from the current
 * tracked position (recommended) or manual coordinate entry.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  PanResponder,
  Animated,
  Platform,
} from 'react-native';
import { useTrackingStore } from '../../store/useTrackingStore';
import { gpsInjector, type InjectorSnapshot } from './gpsInjector';
import { planWalkingRoute, type PlannedRoute } from './routePlanner';

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || '';

const JOY_SIZE = 140;
const JOY_STICK = 50;
const JOY_MAX = 50; // px travel from center

type Status = 'idle' | 'planning' | 'ready' | 'error';

function parseLngLat(s: string): { lng: number; lat: number } | null {
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lng, lat };
}

function fmtLL(p: { lng: number; lat: number } | null): string {
  if (!p) return '—';
  return `${p.lng.toFixed(5)}, ${p.lat.toFixed(5)}`;
}

export function SimWalkerOverlay() {
  const [ptA, setPtA] = useState<{ lng: number; lat: number } | null>(null);
  const [ptB, setPtB] = useState<{ lng: number; lat: number } | null>(null);
  const [route, setRoute] = useState<PlannedRoute | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errMsg, setErrMsg] = useState<string>('');
  const [manualA, setManualA] = useState<string>('');
  const [manualB, setManualB] = useState<string>('');
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [snap, setSnap] = useState<InjectorSnapshot>(() =>
    gpsInjector.getSnapshot(),
  );

  // Start the tick loop when overlay mounts; stop on unmount.
  useEffect(() => {
    gpsInjector.start();
    const unsub = gpsInjector.subscribe(setSnap);
    return () => {
      unsub();
      gpsInjector.stop();
      gpsInjector.clearRoute();
    };
  }, []);

  const useCurrentFor = (which: 'A' | 'B') => {
    const cur = useTrackingStore.getState().lastCoordinate;
    if (!cur) {
      setErrMsg('No current location yet — start GPS or type coords.');
      return;
    }
    const p = { lng: cur.lng, lat: cur.lat };
    if (which === 'A') setPtA(p);
    else setPtB(p);
    setErrMsg('');
  };

  const useManualFor = (which: 'A' | 'B') => {
    const raw = which === 'A' ? manualA : manualB;
    const parsed = parseLngLat(raw);
    if (!parsed) {
      setErrMsg(`Invalid coords for ${which}. Format: lng, lat`);
      return;
    }
    if (which === 'A') setPtA(parsed);
    else setPtB(parsed);
    setErrMsg('');
  };

  const plan = async () => {
    if (!ptA || !ptB) {
      setErrMsg('Set both A and B first.');
      return;
    }
    setStatus('planning');
    setErrMsg('');
    try {
      const r = await planWalkingRoute(ptA, ptB, MAPBOX_TOKEN);
      setRoute(r);
      gpsInjector.setRoute(r);
      setStatus('ready');
    } catch (err) {
      setStatus('error');
      setErrMsg((err as Error).message);
    }
  };

  const resetAll = () => {
    setPtA(null);
    setPtB(null);
    setRoute(null);
    setStatus('idle');
    setErrMsg('');
    gpsInjector.clearRoute();
  };

  // ── Joystick — vertical PanResponder ─────────────────────────────
  const stickY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        stickY.setValue(0);
      },
      onPanResponderMove: (_evt, gs) => {
        const clamped = Math.max(-JOY_MAX, Math.min(JOY_MAX, gs.dy));
        stickY.setValue(clamped);
        // negative dy (finger up) = forward
        gpsInjector.setJoystick(-clamped / JOY_MAX);
      },
      onPanResponderRelease: () => {
        gpsInjector.releaseJoystick();
        Animated.spring(stickY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 140,
          friction: 8,
        }).start();
      },
      onPanResponderTerminate: () => {
        gpsInjector.releaseJoystick();
        Animated.spring(stickY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 140,
          friction: 8,
        }).start();
      },
    }),
  ).current;

  // ── Render ───────────────────────────────────────────────────────
  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Top-left HUD + controls */}
      <View style={styles.hud}>
        <View style={styles.hudHeaderRow}>
          <Text style={styles.hudTitle}>sim-walker · dev</Text>
          <TouchableOpacity
            onPress={() => setCollapsed((c) => !c)}
            style={styles.collapseBtn}
          >
            <Text style={styles.collapseBtnText}>{collapsed ? '+' : '−'}</Text>
          </TouchableOpacity>
        </View>

        {!collapsed && (
          <>
            <Text style={styles.hudRow}>
              A: <Text style={styles.hudMono}>{fmtLL(ptA)}</Text>
            </Text>
            <Text style={styles.hudRow}>
              B: <Text style={styles.hudMono}>{fmtLL(ptB)}</Text>
            </Text>
            <Text style={styles.hudRow}>
              Progress:{' '}
              <Text style={styles.hudMono}>
                {snap.progressM.toFixed(0)} / {snap.totalM.toFixed(0)} m
              </Text>
            </Text>
            <Text style={styles.hudRow}>
              Speed:{' '}
              <Text style={styles.hudMono}>
                {Math.abs(snap.speedMs).toFixed(2)} m/s
              </Text>
            </Text>
            <Text style={styles.hudRow}>
              Phase: <Text style={styles.hudMono}>{snap.phase}</Text>
            </Text>
            <Text style={styles.hudRow}>
              Emits: <Text style={styles.hudMono}>{snap.ticksEmitted}</Text>
            </Text>
            {errMsg ? <Text style={styles.errMsg}>{errMsg}</Text> : null}

            {/* A picker */}
            <View style={styles.pickerRow}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => useCurrentFor('A')}
              >
                <Text style={styles.btnText}>A ← here</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="lng, lat"
                placeholderTextColor="#999"
                value={manualA}
                onChangeText={setManualA}
                onSubmitEditing={() => useManualFor('A')}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            {/* B picker */}
            <View style={styles.pickerRow}>
              <TouchableOpacity
                style={styles.btn}
                onPress={() => useCurrentFor('B')}
              >
                <Text style={styles.btnText}>B ← here</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.input}
                placeholder="lng, lat"
                placeholderTextColor="#999"
                value={manualB}
                onChangeText={setManualB}
                onSubmitEditing={() => useManualFor('B')}
                autoCorrect={false}
                autoCapitalize="none"
              />
            </View>

            {/* Plan / Reset */}
            <View style={styles.pickerRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={plan}
                disabled={status === 'planning'}
              >
                <Text style={[styles.btnText, styles.btnTextPrimary]}>
                  {status === 'planning' ? 'Planning…' : 'Plan route'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.btn} onPress={resetAll}>
                <Text style={styles.btnText}>Reset</Text>
              </TouchableOpacity>
            </View>

            {route ? (
              <Text style={styles.hudSubtle}>
                {route.totalM.toFixed(0)} m · {route.coords.length} vertices
              </Text>
            ) : null}
          </>
        )}
      </View>

      {/* Bottom-right joystick */}
      <View
        style={styles.joyRoot}
        {...panResponder.panHandlers}
        pointerEvents="auto"
      >
        <View style={styles.joyBase} />
        <Animated.View
          style={[
            styles.joyStick,
            { transform: [{ translateY: stickY }] },
          ]}
        />
        <Text style={styles.joyLabel}>Push ↑ forward · ↓ back</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    // z-order: on iOS/Android, later children in HikingScreen render on
    // top by default; overlay is mounted last so this is enough. On
    // web zIndex helps.
    ...(Platform.OS === 'web' ? { zIndex: 9999 as unknown as number } : null),
  },
  hud: {
    position: 'absolute',
    top: 80,
    left: 12,
    backgroundColor: 'rgba(255,255,255,0.94)',
    padding: 10,
    borderRadius: 10,
    minWidth: 240,
    maxWidth: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  hudHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  hudTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5d7c46',
    letterSpacing: 0.5,
  },
  collapseBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#f2ede2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapseBtnText: {
    fontSize: 14,
    color: '#5d7c46',
    fontWeight: '700',
    lineHeight: 16,
  },
  hudRow: {
    fontSize: 11,
    color: '#333',
    marginTop: 2,
  },
  hudMono: {
    fontFamily: Platform.select({
      ios: 'Menlo',
      android: 'monospace',
      default: 'monospace',
    }),
    color: '#111',
  },
  hudSubtle: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
  },
  errMsg: {
    fontSize: 11,
    color: '#b13a3a',
    marginTop: 4,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  btn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ccc',
    backgroundColor: '#fff',
  },
  btnPrimary: {
    backgroundColor: '#5d7c46',
    borderColor: '#5d7c46',
  },
  btnText: {
    fontSize: 11,
    color: '#333',
  },
  btnTextPrimary: {
    color: '#fff',
    fontWeight: '600',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    fontSize: 11,
    color: '#111',
    backgroundColor: '#fff',
  },
  // ── Joystick ──
  joyRoot: {
    position: 'absolute',
    bottom: 20,
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
