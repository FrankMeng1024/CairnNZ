import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  type AppStateStatus,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import * as Battery from 'expo-battery';
import {
  SUNNY_MOTION_DEBUG_MULTIPLIER,
  SUNNY_MOTION_DEV_MODE,
  type SunnyMotionDevMode,
} from '../../config/homeVisual';

const CLOUD_LAYER = require('../../../assets/home/motion/sunny/cloud-motion-layer.webp');
const WATER_LAYER = require('../../../assets/home/motion/sunny/water-motion-layer.webp');
const VEGETATION_LAYER = require('../../../assets/home/motion/sunny/vegetation-motion-layer.webp');

type MotionChannel = 'cloud' | 'water' | 'vegetation';
type MotionChannelState = 'NOT_LOADED' | 'LOADED' | 'RUNNING' | 'PAUSED' | 'ERROR';

export type SunnyMotionDiagnosticState = {
  enabled: boolean;
  homeFocused: boolean;
  appActive: boolean;
  reduceMotion: boolean | null;
  lowPowerMode: boolean | null;
  cloud: MotionChannelState;
  water: MotionChannelState;
  vegetation: MotionChannelState;
  mode: 'STATIC' | 'NORMAL' | 'DEBUG';
};

declare global {
  // DEV-only inspection hook for deterministic browser/native debugging.
  // eslint-disable-next-line no-var
  var __sunnyMotionDiagnostics: SunnyMotionDiagnosticState | undefined;
}

function devLog(message: string) {
  if (__DEV__) console.info(`[SunnyMotion] ${message}`);
}

function resolveDevMode(): SunnyMotionDevMode {
  if (!__DEV__) return 'normal';

  if (Platform.OS === 'web') {
    try {
      const search = (globalThis as typeof globalThis & {
        location?: { search?: string };
      }).location?.search;
      const value = new URLSearchParams(search ?? '').get('homeMotion');
      if (value === 'off' || value === 'static') return 'static';
      if (value === 'normal' || value === 'debug') return value;
    } catch {
      // The source-level DEV mode remains the deterministic fallback.
    }
  }

  return SUNNY_MOTION_DEV_MODE;
}

function timing(value: Animated.Value, toValue: number, duration: number) {
  return Animated.timing(value, {
    toValue,
    duration,
    useNativeDriver: true,
    isInteraction: false,
  });
}

function amplified(base: number, target: number, multiplier: number) {
  return base + (target - base) * multiplier;
}

function amplifiedOpacity(base: number, target: number, multiplier: number) {
  return Math.max(0, Math.min(1, amplified(base, target, multiplier)));
}

class StaticFallbackBoundary extends React.Component<
  React.PropsWithChildren,
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    devLog(`overlayError=${error.message}`);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Gate A1 Sunny ambient life.
 *
 * The approved static image remains canonical. These three sparse alpha
 * overlays repeat localized pixels from that composition, so initialization
 * failure, Reduce Motion, low-power mode, or a disabled feature always
 * resolves to the complete approved still rather than a partial scene.
 */
function SunnyMotionLayerImpl() {
  const isFocused = useIsFocused();
  const mode = useMemo(resolveDevMode, []);
  const multiplier = mode === 'debug' ? SUNNY_MOTION_DEBUG_MULTIPLIER : 1;
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [lowPowerMode, setLowPowerMode] = useState<boolean | null>(null);
  const [loaded, setLoaded] = useState<Record<MotionChannel, boolean>>({
    cloud: false,
    water: false,
    vegetation: false,
  });
  const [failed, setFailed] = useState<Record<MotionChannel, boolean>>({
    cloud: false,
    water: false,
    vegetation: false,
  });

  const cloudX = useRef(new Animated.Value(-1.1)).current;
  const cloudY = useRef(new Animated.Value(0.05)).current;
  const cloudOpacity = useRef(new Animated.Value(0.082)).current;
  const waterX = useRef(new Animated.Value(-0.65)).current;
  const waterY = useRef(new Animated.Value(0)).current;
  const waterOpacity = useRef(new Animated.Value(0.1)).current;
  const vegetationX = useRef(new Animated.Value(0)).current;
  const vegetationY = useRef(new Animated.Value(0)).current;
  const vegetationOpacity = useRef(new Animated.Value(0.044)).current;
  const hasStarted = useRef(false);
  const lastEligibilityLog = useRef<string | null>(null);
  const loadedRef = useRef<Record<MotionChannel, boolean>>({
    cloud: false,
    water: false,
    vegetation: false,
  });
  const failedRef = useRef<Record<MotionChannel, boolean>>({
    cloud: false,
    water: false,
    vegetation: false,
  });

  const enabled = mode !== 'static';
  const appActive = appState === 'active';
  const preferencesKnown = reduceMotion !== null && lowPowerMode !== null;
  const allowedByPreferences = reduceMotion === false && lowPowerMode === false;
  const shouldRenderOverlays = enabled && preferencesKnown && allowedByPreferences;
  const shouldAnimate = shouldRenderOverlays && isFocused && appActive;

  useEffect(() => {
    devLog('mounted');
    return () => {
      devLog('unmounted');
      if (__DEV__) globalThis.__sunnyMotionDiagnostics = undefined;
    };
  }, []);

  useEffect(() => devLog(`enabled=${enabled}`), [enabled]);
  useEffect(() => devLog(`homeFocused=${isFocused}`), [isFocused]);
  useEffect(() => devLog(`appState=${appState}`), [appState]);
  useEffect(() => {
    if (reduceMotion !== null) devLog(`reduceMotion=${reduceMotion}`);
  }, [reduceMotion]);
  useEffect(() => {
    if (lowPowerMode !== null) devLog(`lowPowerMode=${lowPowerMode}`);
  }, [lowPowerMode]);

  useEffect(() => {
    const appStateSubscription = AppState.addEventListener('change', setAppState);
    const reduceMotionSubscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );
    let lowPowerSubscription: { remove: () => void } | null = null;

    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduceMotion)
      .catch(() => setReduceMotion(true));

    if (Platform.OS === 'web') {
      // Expo Battery intentionally has no web event emitter. Native iOS and
      // Android use the production Low Power Mode gate below.
      setLowPowerMode(false);
    } else {
      Battery.isLowPowerModeEnabledAsync()
        .then(setLowPowerMode)
        .catch(() => setLowPowerMode(true));
      try {
        lowPowerSubscription = Battery.addLowPowerModeListener(({ lowPowerMode: next }) => {
          setLowPowerMode(next);
        });
      } catch {
        // Fail safely to the canonical static scene on unsupported runtimes.
        setLowPowerMode(true);
      }
    }

    return () => {
      appStateSubscription.remove();
      reduceMotionSubscription.remove();
      lowPowerSubscription?.remove();
    };
  }, []);

  const markLoaded = useCallback((channel: MotionChannel) => {
    if (loadedRef.current[channel]) return;
    loadedRef.current[channel] = true;
    setLoaded(current => ({ ...current, [channel]: true }));
    devLog(`${channel}Loaded=true`);
  }, []);

  const markFailed = useCallback((channel: MotionChannel) => {
    if (failedRef.current[channel]) return;
    failedRef.current[channel] = true;
    setFailed(current => ({ ...current, [channel]: true }));
    devLog(`${channel}Loaded=false`);
  }, []);

  useEffect(() => {
    let message: string | null = null;
    if (reduceMotion === true) message = 'disabled reason=reduce-motion';
    else if (lowPowerMode === true) message = 'disabled reason=low-power';
    else if (preferencesKnown && !isFocused) message = 'paused reason=home-hidden';
    else if (preferencesKnown && !appActive) message = 'paused reason=app-background';

    if (message && message !== lastEligibilityLog.current) {
      devLog(message);
      lastEligibilityLog.current = message;
    } else if (!message) {
      lastEligibilityLog.current = null;
    }
  }, [appActive, isFocused, lowPowerMode, mode, preferencesKnown, reduceMotion]);

  useEffect(() => {
    if (!shouldAnimate) return;

    const cloud = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          timing(cloudX, amplified(-1.1, 1, multiplier), 9870),
          timing(cloudX, amplified(-1.1, 3.1, multiplier), 11130),
          timing(cloudX, amplified(-1.1, 1, multiplier), 11130),
          timing(cloudX, -1.1, 9870),
        ]),
        Animated.sequence([
          timing(cloudY, amplified(0.05, -0.08, multiplier), 9870),
          timing(cloudY, amplified(0.05, 0.04, multiplier), 11130),
          timing(cloudY, amplified(0.05, -0.08, multiplier), 11130),
          timing(cloudY, 0.05, 9870),
        ]),
        Animated.sequence([
          timing(cloudOpacity, amplifiedOpacity(0.082, 0.098, multiplier), 9870),
          timing(cloudOpacity, amplifiedOpacity(0.082, 0.088, multiplier), 11130),
          timing(cloudOpacity, amplifiedOpacity(0.082, 0.098, multiplier), 11130),
          timing(cloudOpacity, 0.082, 9870),
        ]),
      ]),
    );

    const water = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          timing(waterX, amplified(-0.65, 0.85, multiplier), 1270),
          timing(waterX, amplified(-0.65, 1.45, multiplier), 2210),
          timing(waterX, amplified(-0.65, -0.18, multiplier), 1740),
          timing(waterX, -0.65, 1480),
        ]),
        Animated.sequence([
          timing(waterY, amplified(0, 0.1, multiplier), 1270),
          timing(waterY, amplified(0, -0.08, multiplier), 2210),
          timing(waterY, amplified(0, 0.08, multiplier), 1740),
          timing(waterY, 0, 1480),
        ]),
        Animated.sequence([
          timing(waterOpacity, amplifiedOpacity(0.1, 0.24, multiplier), 1270),
          timing(waterOpacity, amplifiedOpacity(0.1, 0.145, multiplier), 2210),
          timing(waterOpacity, amplifiedOpacity(0.1, 0.245, multiplier), 1740),
          timing(waterOpacity, 0.1, 1480),
        ]),
      ]),
    );

    const vegetation = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          timing(vegetationX, amplified(0, 0.22, multiplier), 3940),
          timing(vegetationX, amplified(0, 0.04, multiplier), 1020),
          Animated.delay(3680),
          timing(vegetationX, amplified(0, -0.24, multiplier), 1020),
          timing(vegetationX, 0, 3040),
        ]),
        Animated.sequence([
          timing(vegetationY, amplified(0, -0.06, multiplier), 3940),
          timing(vegetationY, 0, 1020),
          Animated.delay(3680),
          timing(vegetationY, amplified(0, 0.04, multiplier), 1020),
          timing(vegetationY, 0, 3040),
        ]),
        Animated.sequence([
          timing(vegetationOpacity, amplifiedOpacity(0.044, 0.054, multiplier), 3940),
          timing(vegetationOpacity, amplifiedOpacity(0.044, 0.047, multiplier), 1020),
          Animated.delay(3680),
          timing(vegetationOpacity, amplifiedOpacity(0.044, 0.056, multiplier), 1020),
          timing(vegetationOpacity, 0.044, 3040),
        ]),
      ]),
    );

    cloud.start();
    water.start();
    vegetation.start();

    if (hasStarted.current) devLog('resumed');
    else {
      devLog('animationsStarted');
      hasStarted.current = true;
    }

    return () => {
      // stop() preserves the current native Animated values. A later resume
      // continues naturally from the paused state instead of resetting all
      // overlays and visibly restarting their loops.
      cloud.stop();
      water.stop();
      vegetation.stop();
    };
  }, [
    cloudOpacity,
    cloudX,
    cloudY,
    multiplier,
    shouldAnimate,
    vegetationOpacity,
    vegetationX,
    vegetationY,
    waterOpacity,
    waterX,
    waterY,
  ]);

  const channelState = useCallback((channel: MotionChannel): MotionChannelState => {
    if (failed[channel]) return 'ERROR';
    if (!loaded[channel]) return 'NOT_LOADED';
    return shouldAnimate ? 'RUNNING' : 'PAUSED';
  }, [failed, loaded, shouldAnimate]);

  const diagnostics: SunnyMotionDiagnosticState = {
    enabled,
    homeFocused: isFocused,
    appActive,
    reduceMotion,
    lowPowerMode,
    cloud: channelState('cloud'),
    water: channelState('water'),
    vegetation: channelState('vegetation'),
    mode: mode.toUpperCase() as SunnyMotionDiagnosticState['mode'],
  };

  useEffect(() => {
    if (__DEV__) globalThis.__sunnyMotionDiagnostics = diagnostics;
  }, [
    diagnostics.appActive,
    diagnostics.cloud,
    diagnostics.enabled,
    diagnostics.homeFocused,
    diagnostics.lowPowerMode,
    diagnostics.mode,
    diagnostics.reduceMotion,
    diagnostics.vegetation,
    diagnostics.water,
  ]);

  if (!shouldRenderOverlays) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={StyleSheet.absoluteFill}
      testID="sunny-motion-layer"
    >
      <Animated.Image
        source={CLOUD_LAYER}
        onLoad={() => markLoaded('cloud')}
        onError={() => markFailed('cloud')}
        resizeMode="stretch"
        style={[
          styles.cloudLayer,
          {
            opacity: cloudOpacity,
            transform: [
              { translateX: cloudX },
              { translateY: cloudY },
              { scale: 1.003 },
            ],
          },
        ]}
        testID="sunny-motion-cloud"
      />
      <Animated.Image
        source={WATER_LAYER}
        onLoad={() => markLoaded('water')}
        onError={() => markFailed('water')}
        resizeMode="stretch"
        style={[
          styles.waterLayer,
          {
            opacity: waterOpacity,
            transform: [
              { translateX: waterX },
              { translateY: waterY },
              { scale: 1.0015 },
            ],
          },
        ]}
        testID="sunny-motion-water"
      />
      <Animated.Image
        source={VEGETATION_LAYER}
        onLoad={() => markLoaded('vegetation')}
        onError={() => markFailed('vegetation')}
        resizeMode="stretch"
        style={[
          styles.vegetationLayer,
          {
            opacity: vegetationOpacity,
            transform: [
              { translateX: vegetationX },
              { translateY: vegetationY },
            ],
          },
        ]}
        testID="sunny-motion-vegetation"
      />
    </View>
  );
}

export function SunnyMotionLayer() {
  return (
    <StaticFallbackBoundary>
      <SunnyMotionLayerImpl />
    </StaticFallbackBoundary>
  );
}

const styles = StyleSheet.create({
  // Coordinates are normalized to the fixed 375×812 production canvas from
  // the approved composition. A same-composition higher-resolution base can
  // replace the JPEG without changing this architecture or these regions.
  cloudLayer: {
    position: 'absolute',
    left: 0,
    top: 7.03,
    width: 375,
    height: 374.52,
  },
  waterLayer: {
    position: 'absolute',
    left: 0,
    top: 363.87,
    width: 271.13,
    height: 152.1,
  },
  vegetationLayer: {
    position: 'absolute',
    left: 241.2,
    top: 226.75,
    width: 133.8,
    height: 271.52,
  },
});
