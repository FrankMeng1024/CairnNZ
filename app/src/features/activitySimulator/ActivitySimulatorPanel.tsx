import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppStore } from '../../store/useAppStore';
import { useSessionStore } from '../../store/useSessionStore';
import { useTrackingStore } from '../../store/useTrackingStore';
import networkMonitor from '../../services/networkMonitor';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../../components/tokens';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { destinationPoint } from './geodesy';
import { SIMULATOR_JOYSTICK_DEAD_ZONE } from './activitySimulatorEngine';
import { getSimulatorMapCenter } from './simulatorMapBridge';
import { selectedActivityLocationSource } from './activityLocationProvider';
import { appendSimulatorLog, clearSimulatorLogs, readSimulatorDiagnostics } from './simulatorLog';
import { hydrateActivitySimulatorForUser, simulatorAccuracyMeters, useActivitySimulatorStore } from './useActivitySimulatorStore';
import {
  type SimulatorAccuracyPreset,
  type SimulatorAltitudeMode,
  type SimulatorSpeedPreset,
  type SimulatorTimeScale,
  type SimulatorSignal,
} from './types';
import {
  joystickVectorFromLocalPoint,
  SIMULATOR_JOYSTICK_SIZE,
  SIMULATOR_JOYSTICK_TRAVEL,
} from './joystickInput';
import { fetchSimulatorWalkingRoute } from './simulatorWalkingRoute';

const JOYSTICK_SIZE = SIMULATOR_JOYSTICK_SIZE;
const JOYSTICK_KNOB = 44;
const JOYSTICK_TRAVEL = SIMULATOR_JOYSTICK_TRAVEL;

function TinyButton({ label, active, danger, disabled, onPress, testID }: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.tinyButton,
        active && styles.tinyButtonActive,
        danger && styles.tinyButtonDanger,
        disabled && styles.disabled,
      ]}
      activeOpacity={0.78}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={[styles.tinyButtonText, (active || danger) && styles.tinyButtonTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ActivitySimulatorPanel() {
  const theme = useVisualTheme();
  const userId = useAppStore(state => state.user?.id ?? null);
  const status = useTrackingStore(state => state.status);
  const activityMode = useTrackingStore(state => state.activityMode);
  const locationProviderSource = useTrackingStore(state => state.locationProviderSource);
  const clientActivityId = useTrackingStore(state => state.sessionId);
  const currentSegmentId = useTrackingStore(state => state.currentSegmentId);
  const ownerGeneration = useTrackingStore(state => state.liveOwnerGeneration);
  const committedPosition = useTrackingStore(state => state.lastCoordinate);
  const committedPointCount = useTrackingStore(state => state.trackPoints.length);
  const enabled = useActivitySimulatorStore(state => state.enabled);
  const startConfigured = useActivitySimulatorStore(state => state.startConfigured);
  const expanded = useActivitySimulatorStore(state => state.expanded);
  const current = useActivitySimulatorStore(state => state.current);
  const origin = useActivitySimulatorStore(state => state.origin);
  const altitudeM = useActivitySimulatorStore(state => state.altitudeM);
  const altitudeMode = useActivitySimulatorStore(state => state.altitudeMode);
  const verticalRateMPerHour = useActivitySimulatorStore(state => state.verticalRateMPerHour);
  const speedPreset = useActivitySimulatorStore(state => state.speedPreset);
  const speedKmh = useActivitySimulatorStore(state => state.speedKmh);
  const accuracyPreset = useActivitySimulatorStore(state => state.accuracyPreset);
  const customAccuracyM = useActivitySimulatorStore(state => state.customAccuracyM);
  const signal = useActivitySimulatorStore(state => state.signal);
  const timeScale = useActivitySimulatorStore(state => state.timeScale);
  const effectiveVirtualElapsedMs = useActivitySimulatorStore(state => state.effectiveVirtualElapsedMs);
  const clockLimitReached = useActivitySimulatorStore(state => state.clockLimitReached);
  const pickerMode = useActivitySimulatorStore(state => state.pickerMode);
  const mapSelection = useActivitySimulatorStore(state => state.mapSelection);
  const waypoints = useActivitySimulatorStore(state => state.waypoints);
  const autopilotActive = useActivitySimulatorStore(state => state.autopilotActive);
  const joystickActive = useActivitySimulatorStore(state => state.joystickActive);
  const joystickBearingDegrees = useActivitySimulatorStore(state => state.joystickBearingDegrees);
  const joystickMagnitude = useActivitySimulatorStore(state => state.joystickMagnitude);
  const lastGeneratedSample = useActivitySimulatorStore(state => state.lastGeneratedSample);
  const lastAcceptedSample = useActivitySimulatorStore(state => state.lastAcceptedSample);
  const lastRejectionReason = useActivitySimulatorStore(state => state.lastRejectionReason);
  const mapDiagnostics = useActivitySimulatorStore(state => state.mapDiagnostics);
  const lastDecision = useActivitySimulatorStore(state => state.lastDecision);
  const lastFailure = useActivitySimulatorStore(state => state.lastFailure);
  const simulatorSessionId = useActivitySimulatorStore(state => state.simulatorSessionId);
  const qaSessionId = useActivitySimulatorStore(state => state.qaSessionId);
  const latestActivityClientId = useActivitySimulatorStore(state => state.latestActivityClientId);
  const latestSyncState = useSessionStore(state => {
    const identity = clientActivityId ?? latestActivityClientId;
    const session = identity
      ? state.sessions.find(item => item.id === identity || item.clientActivityId === identity)
      : null;
    return session?.syncState ?? (clientActivityId ? 'recording' : '—');
  });
  const actions = useActivitySimulatorStore.getState();
  const selectedProviderSource = selectedActivityLocationSource();
  const [networkState, setNetworkState] = useState(networkMonitor.getState()?.state ?? 'unknown');
  const [latDraft, setLatDraft] = useState(String(current.lat));
  const [lngDraft, setLngDraft] = useState(String(current.lng));
  const [altDraft, setAltDraft] = useState(String(altitudeM));
  const [speedDraft, setSpeedDraft] = useState(String(speedKmh));
  const [verticalDraft, setVerticalDraft] = useState(String(verticalRateMPerHour));
  const [accuracyDraft, setAccuracyDraft] = useState(String(customAccuracyM ?? simulatorAccuracyMeters()));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const straightLinePickerRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    // AppRoot owns account hydration. Only recover here when the panel is
    // mounted in isolation; re-reading the same user's disk snapshot could
    // overwrite a just-enabled in-memory toggle before its coalesced write.
    let cancelled = false;
    void (async () => {
      if (useActivitySimulatorStore.getState().hydratedUserId !== String(userId)) {
        await hydrateActivitySimulatorForUser(String(userId));
      }
      if (cancelled) return;
      const qaId = useActivitySimulatorStore.getState().beginQaSession(String(userId));
      appendSimulatorLog('SCREEN', 'simulator_panel_mounted', {
        startConfigured: useActivitySimulatorStore.getState().startConfigured,
      }, { userId: String(userId), qaSessionId: qaId, coordinateSource: 'none' });
    })();
    void networkMonitor.start();
    const unsubscribe = networkMonitor.onChange(next => setNetworkState(next.state));
    return () => {
      cancelled = true;
      appendSimulatorLog('SCREEN', 'simulator_panel_unmounted', {}, { coordinateSource: 'none' });
      unsubscribe();
      useActivitySimulatorStore.getState().releaseJoystick();
      useActivitySimulatorStore.getState().setPickerMode(null);
    };
  }, [userId]);

  useEffect(() => {
    appendSimulatorLog('SIM_INPUT', expanded ? 'simulator_panel_opened' : 'simulator_panel_closed', {
      startConfigured,
    }, { coordinateSource: 'none' });
  }, [expanded]);

  useEffect(() => {
    setLatDraft(current.lat.toFixed(6));
    setLngDraft(current.lng.toFixed(6));
  }, [origin.lat, origin.lng]);

  const stickX = useRef(new Animated.Value(0)).current;
  const stickY = useRef(new Animated.Value(0)).current;
  const lastJoystickLogMs = useRef(0);
  const applyJoystickPoint = (locationX: number, locationY: number) => {
    const { x, y, bearingDegrees, magnitude } = joystickVectorFromLocalPoint(locationX, locationY);
    stickX.setValue(x);
    stickY.setValue(y);
    useActivitySimulatorStore.getState().setJoystick(bearingDegrees, magnitude);
    const now = Date.now();
    if (now - lastJoystickLogMs.current >= 500) {
      lastJoystickLogMs.current = now;
      appendSimulatorLog('SIM_INPUT', 'joystick_updated', {
        joystickActive: true,
        bearingDegrees,
        magnitude,
        normalizedVectorX: x / JOYSTICK_TRAVEL,
        normalizedVectorY: y / JOYSTICK_TRAVEL,
        touchLocationX: locationX,
        touchLocationY: locationY,
      });
    }
  };
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => {
      appendSimulatorLog('SIM_INPUT', 'joystick_termination_requested', {
        decision: 'retain-simulator-responder',
      }, { coordinateSource: 'none' });
      return false;
    },
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: (event) => {
      useActivitySimulatorStore.getState().stopAutopilot();
      useActivitySimulatorStore.getState().setJoystickActive(true);
      applyJoystickPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
      appendSimulatorLog('SIM_INPUT', 'joystick_granted', {
        joystickActive: true,
        locationX: event.nativeEvent.locationX,
        locationY: event.nativeEvent.locationY,
      });
    },
    onPanResponderMove: (event) => {
      applyJoystickPoint(event.nativeEvent.locationX, event.nativeEvent.locationY);
    },
    onPanResponderRelease: () => {
      useActivitySimulatorStore.getState().releaseJoystick();
      appendSimulatorLog('SIM_INPUT', 'joystick_released');
      Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 150, friction: 8 }).start();
      Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 150, friction: 8 }).start();
    },
    onPanResponderTerminate: () => {
      useActivitySimulatorStore.getState().releaseJoystick();
      appendSimulatorLog('SIM_INPUT', 'joystick_terminated', {
        rejectionReason: 'native-responder-terminated',
      });
      Animated.spring(stickX, { toValue: 0, useNativeDriver: true }).start();
      Animated.spring(stickY, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  if (!enabled) return null;

  const applyManualStart = () => {
    appendSimulatorLog('SIM_INPUT', 'manual_start_location_tapped', {
      trackingStatus: status,
      startConfigured,
    }, { coordinateSource: 'simulator' });
    if (status !== 'idle') {
      actions.setLastFailure('Manual Start here is available only before Activity Start.');
      appendSimulatorLog('SIM_INPUT', 'manual_start_location_rejected', {
        rejectionReason: `tracking-status-${status}`,
      }, { coordinateSource: 'none' });
      return;
    }
    if (actions.setOrigin({ lat: Number(latDraft), lng: Number(lngDraft) })) {
      appendSimulatorLog('SIM_INPUT', 'manual_start_location_set', {
        lat: Number(latDraft), lng: Number(lngDraft), altitude: Number(altDraft),
      });
      actions.setAltitude(Number(altDraft));
    }
  };

  const setFromMapCenter = async () => {
    appendSimulatorLog('SIM_INPUT', 'use_map_center_tapped', {
      trackingStatus: status,
      mapMounted: mapDiagnostics.mounted,
      mapReady: mapDiagnostics.mapReady,
      mapLoadState: mapDiagnostics.loadState,
    }, { coordinateSource: 'none' });
    if (status !== 'idle') {
      actions.setLastFailure('Set from map center is available only before Activity Start.');
      appendSimulatorLog('SIM_INPUT', 'use_map_center_rejected', {
        rejectionReason: `tracking-status-${status}`,
      }, { coordinateSource: 'none' });
      return;
    }
    const center = await getSimulatorMapCenter();
    if (!center) {
      actions.setLastFailure('Map center is not available yet.');
      appendSimulatorLog('SIM_INPUT', 'use_map_center_rejected', {
        rejectionReason: 'map-center-ref-unavailable',
        mapMounted: mapDiagnostics.mounted,
        mapReady: mapDiagnostics.mapReady,
      }, { coordinateSource: 'none' });
      return;
    }
    actions.setOrigin(center);
    setLatDraft(center.lat.toFixed(6));
    setLngDraft(center.lng.toFixed(6));
    appendSimulatorLog('SIM_INPUT', 'map_center_start_location_set', { lat: center.lat, lng: center.lng }, { coordinateSource: 'simulator' });
  };

  const readPickerCenter = async () => {
    const center = await getSimulatorMapCenter();
    return center ?? useActivitySimulatorStore.getState().mapSelection;
  };

  const confirmVirtualOrigin = async () => {
    const center = await readPickerCenter();
    if (!center) {
      actions.setLastFailure('地图中心尚未可用');
      appendSimulatorLog('SIM_INPUT', 'virtual_origin_selection_rejected', {
        rejectionReason: 'map-center-ref-unavailable',
      }, { coordinateSource: 'none' });
      return;
    }
    if (!actions.setOrigin(center)) return;
    appendSimulatorLog('SIM_INPUT', 'virtual_origin_selected', {
      lat: center.lat,
      lng: center.lng,
      firstActivityPointPending: true,
    }, { coordinateSource: 'simulator' });
  };

  const confirmRuntimePicker = async () => {
    const center = await readPickerCenter();
    if (!center) {
      actions.setLastFailure('地图中心尚未可用');
      return;
    }
    if (pickerMode === 'reacquire') {
      const ok = await useTrackingStore.getState().reacquireSimulatorAt(center);
      if (ok) actions.setPickerMode(null);
      return;
    }
    if (pickerMode === 'destination') {
      if (straightLinePickerRef.current) {
        straightLinePickerRef.current = false;
        if (actions.moveToWaypoint(center)) {
          appendSimulatorLog('SIM_INPUT', 'simulator_advanced_straight_line_move', { ...center }, {
            coordinateSource: 'simulator',
          });
          actions.setPickerMode(null);
        }
        return;
      }
      const tracking = useTrackingStore.getState();
      const simulator = useActivitySimulatorStore.getState();
      const routeOrigin = tracking.lastCoordinate ?? simulator.current;
      actions.setLastFailure(null);
      appendSimulatorLog('SIM_INPUT', 'simulator_walking_route_requested', {
        destination: center,
        networkState,
      }, { coordinateSource: 'simulator' });
      const result = await fetchSimulatorWalkingRoute(routeOrigin, center, {
        isOnline: networkState === 'online',
      });
      if (!result.ok) {
        actions.setLastFailure('无法获取步行路径，请使用摇杆');
        appendSimulatorLog('SIM_INPUT', 'simulator_walking_route_failed', {
          reason: result.reason,
        }, { coordinateSource: 'none' });
        return;
      }
      actions.replaceWaypoints(result.points.map((point, index) => ({
        id: `walk-${Date.now().toString(36)}-${index}`,
        ...point,
      })));
      appendSimulatorLog('SIM_INPUT', 'simulator_walking_route_ready', {
        destination: center,
        geometryPointCount: result.points.length,
        walkingDistanceM: result.distanceM,
      }, { coordinateSource: 'simulator' });
      actions.setPickerMode(null);
    }
  };

  const setGpsState = async (next: SimulatorSignal) => {
    if (next === signal) return;
    const continuityWasUnknown = signal === 'lost' || signal === 'frozen';
    const feedReturns = next !== 'lost';
    if (
      status === 'tracking'
      && locationProviderSource === 'simulator'
      && continuityWasUnknown
      && feedReturns
    ) {
      const restored = await useTrackingStore.getState().reacquireSimulatorAt(current, next);
      if (!restored) {
        actions.setLastFailure('无法恢复模拟 GPS，请保持当前状态后重试');
        return;
      }
    } else {
      actions.setSignal(next);
    }
    if (next !== 'lost' && pickerMode === 'reacquire') actions.setPickerMode(null);
    appendSimulatorLog(next === 'lost' ? 'GPS_GAP' : 'SIM_INPUT', 'simulator_gps_state_changed', {
      previousState: signal,
      gpsState: next,
      hiddenMovementAllowed: next === 'lost' || next === 'frozen',
      sampleEmission: next !== 'lost',
    }, { coordinateSource: 'none' });
  };

  const rollback = async (distanceM: number) => {
    const result = await useTrackingStore.getState().rollbackSimulatorTail(distanceM);
    actions.setLastFailure(result.ok
      ? `已回退 ${result.actualDistanceM.toFixed(1)}m（${result.removedPointCount} 点）`
      : `无法回退：${result.reason ?? '路线不足'}`);
  };

  const useSelectedAsStart = () => {
    appendSimulatorLog('SIM_INPUT', 'map_selection_start_here_tapped', {
      trackingStatus: status,
      hasMapSelection: Boolean(mapSelection),
    }, { coordinateSource: 'none' });
    if (!mapSelection || status !== 'idle') {
      actions.setLastFailure(!mapSelection
        ? 'Long-press the map to select a Simulator start first.'
        : 'Start here is available only before Activity Start.');
      appendSimulatorLog('SIM_INPUT', 'map_selection_start_here_rejected', {
        rejectionReason: !mapSelection ? 'no-map-selection' : `tracking-status-${status}`,
      }, { coordinateSource: 'none' });
      return;
    }
    actions.setOrigin(mapSelection);
    setLatDraft(mapSelection.lat.toFixed(6));
    setLngDraft(mapSelection.lng.toFixed(6));
    appendSimulatorLog('SIM_INPUT', 'map_selection_start_here', { lat: mapSelection.lat, lng: mapSelection.lng }, { coordinateSource: 'simulator' });
  };

  const moveToSelection = (queue: boolean) => {
    if (!mapSelection) return;
    const ok = queue ? actions.enqueueWaypoint(mapSelection) : actions.moveToWaypoint(mapSelection);
    if (ok) {
      appendSimulatorLog('SIM_INPUT', queue
        ? 'waypoint_queued'
        : status === 'idle' ? 'destination_set' : 'autopilot_move_here', {
        lat: mapSelection.lat,
        lng: mapSelection.lng,
        queueLength: useActivitySimulatorStore.getState().waypoints.length,
      });
      actions.setMapSelection(null);
    }
  };

  const setSpeed = (preset: SimulatorSpeedPreset) => {
    actions.setSpeedPreset(preset);
    const next = useActivitySimulatorStore.getState().speedKmh;
    setSpeedDraft(String(next));
    appendSimulatorLog('SIM_INPUT', 'speed_preset_set', { preset, speedKmh: next });
  };

  const setCustomSpeed = () => {
    const value = Number(speedDraft);
    const accepted = actions.setCustomSpeed(value);
    appendSimulatorLog('SIM_INPUT', accepted ? 'custom_speed_set' : 'custom_speed_rejected', {
      speedKmh: Number.isFinite(value) ? value : null,
      rejectionReason: accepted ? null : useActivitySimulatorStore.getState().lastFailure,
    }, { coordinateSource: 'none' });
  };

  const setAltitudeModel = (mode: SimulatorAltitudeMode) => {
    actions.setAltitudeMode(mode);
    setVerticalDraft(String(useActivitySimulatorStore.getState().verticalRateMPerHour));
    appendSimulatorLog('SIM_INPUT', 'altitude_model_set', { mode });
  };

  const setManualAltitude = () => {
    const value = Number(altDraft);
    const accepted = actions.setAltitude(value);
    appendSimulatorLog('SIM_INPUT', accepted ? 'altitude_set' : 'altitude_rejected', {
      altitudeM: Number.isFinite(value) ? value : null,
      rejectionReason: accepted ? null : useActivitySimulatorStore.getState().lastFailure,
    }, { coordinateSource: 'none' });
  };

  const setManualVirtualPosition = () => {
    const coordinate = { lat: Number(latDraft), lng: Number(lngDraft) };
    const accepted = status !== 'idle' && actions.setCurrent(coordinate);
    appendSimulatorLog('SIM_INPUT', accepted
      ? 'simulator_manual_virtual_position_set'
      : 'simulator_manual_virtual_position_rejected', {
      lat: Number.isFinite(coordinate.lat) ? coordinate.lat : null,
      lng: Number.isFinite(coordinate.lng) ? coordinate.lng : null,
      rejectionReason: accepted ? null : status === 'idle' ? 'activity-not-started' : useActivitySimulatorStore.getState().lastFailure,
    }, { coordinateSource: accepted ? 'simulator' : 'none' });
  };

  const setCustomVerticalRate = () => {
    const value = Number(verticalDraft);
    const accepted = actions.setVerticalRate(value);
    appendSimulatorLog('SIM_INPUT', accepted ? 'vertical_rate_set' : 'vertical_rate_rejected', {
      verticalRateMPerHour: Number.isFinite(value) ? value : null,
      rejectionReason: accepted ? null : useActivitySimulatorStore.getState().lastFailure,
    }, { coordinateSource: 'none' });
  };

  const setAccuracy = (preset: SimulatorAccuracyPreset) => {
    actions.setAccuracyPreset(preset);
    setAccuracyDraft(String(simulatorAccuracyMeters(useActivitySimulatorStore.getState())));
    appendSimulatorLog('SIM_INPUT', 'accuracy_preset_set', { preset, accuracyM: simulatorAccuracyMeters(useActivitySimulatorStore.getState()) });
  };

  const setCustomAccuracy = () => {
    const value = Number(accuracyDraft);
    const accepted = actions.setCustomAccuracy(value);
    appendSimulatorLog('SIM_INPUT', accepted ? 'custom_accuracy_set' : 'custom_accuracy_rejected', {
      accuracyM: Number.isFinite(value) ? value : null,
      rejectionReason: accepted ? null : useActivitySimulatorStore.getState().lastFailure,
    }, { coordinateSource: 'none' });
  };

  const setTimeScale = (next: SimulatorTimeScale) => {
    if (!actions.setTimeScale(next)) return;
    appendSimulatorLog('SIM_INPUT', 'time_scale_set', {
      timeScale: next,
      effectiveVirtualElapsed: useActivitySimulatorStore.getState().effectiveVirtualElapsedMs,
    });
  };

  const forceInterruption = async () => {
    const store = useTrackingStore.getState() as any;
    if (store.status !== 'tracking' || typeof store.simulateRecordingInterruption !== 'function') {
      actions.setLastFailure('Start or resume an Activity before simulating interruption.');
      return;
    }
    await store.simulateRecordingInterruption();
  };

  const copyDiagnostics = async () => {
    if (!userId) return;
    appendSimulatorLog('SIM_INPUT', 'diagnostics_copy_tapped', {}, { coordinateSource: 'none' });
    try {
      const text = await readSimulatorDiagnostics(String(userId));
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text || 'No Simulator log events recorded.');
      actions.setLastFailure(null);
      Alert.alert('Simulator diagnostics copied', `${text.split('\n').filter(Boolean).length} JSONL events copied to the clipboard.`);
      appendSimulatorLog('SIM_INPUT', 'diagnostics_copy_completed', {
        eventCount: text.split('\n').filter(Boolean).length,
      }, { coordinateSource: 'none' });
    } catch (error) {
      actions.setLastFailure(`Diagnostics export failed: ${String(error).slice(0, 100)}`);
      appendSimulatorLog('ERROR', 'diagnostics_copy_failed', {
        error: String(error).slice(0, 120),
      }, { coordinateSource: 'none' });
    }
  };

  const addDistanceWaypoint = (distanceM: number, eventName: string) => {
    const target = destinationPoint(current, 0, distanceM);
    actions.moveToWaypoint(target);
    appendSimulatorLog('SIM_INPUT', eventName, { mode: activityMode, distanceM, target });
  };

  const joystick = status !== 'idle' ? (
    <View
      testID="activity-simulator-joystick"
      style={[styles.joystickDock, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}
      accessibilityLabel="Simulator movement joystick"
    >
      <Text style={[styles.joystickLabel, { color: theme.foregroundSecondary }]}>移动</Text>
      <View style={styles.joystick} pointerEvents="box-only" {...panResponder.panHandlers}>
        <View style={styles.deadZone} />
        <Animated.View style={[styles.knob, { transform: [{ translateX: stickX }, { translateY: stickY }] }]} />
        <Text style={styles.northLabel}>N</Text>
      </View>
    </View>
  ) : null;

  const pickerCoordinate = mapSelection ?? (startConfigured ? origin : null);

  if (status === 'idle') {
    return <View style={styles.overlayHost} pointerEvents="box-none" testID="activity-simulator-overlay-host">
      <View style={[styles.preStartCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.foreground }]}>模拟起点</Text>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>移动地图，让中心标记对准任意位置</Text>
        <Text style={[styles.selectionText, { color: theme.foreground }]}>
          {pickerCoordinate ? pickerCoordinate.lat.toFixed(6) + ', ' + pickerCoordinate.lng.toFixed(6) : '地图中心'}
        </Text>
        {lastFailure ? <Text style={styles.failureText}>{lastFailure}</Text> : null}
        <TouchableOpacity
          testID="activity-simulator-start-here"
          style={styles.primaryButton}
          onPress={() => { void confirmVirtualOrigin(); }}
          accessibilityRole="button"
          accessibilityLabel="从这里开始"
        >
          <Text style={styles.primaryButtonText}>从这里开始</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowAdvanced(value => !value)} style={styles.advancedLink}>
          <Text style={[styles.collapseText, { color: theme.foregroundSecondary }]}>更多</Text>
        </TouchableOpacity>
        {showAdvanced ? <View style={styles.inputActionRow}>
          <TextInput value={latDraft} onChangeText={setLatDraft} style={styles.input} keyboardType="numbers-and-punctuation" placeholder="纬度" />
          <TextInput value={lngDraft} onChangeText={setLngDraft} style={styles.input} keyboardType="numbers-and-punctuation" placeholder="经度" />
          <TinyButton label="使用坐标" onPress={applyManualStart} />
        </View> : null}
      </View>
    </View>;
  }

  if (pickerMode) {
    return <View style={styles.overlayHost} pointerEvents="box-none" testID="activity-simulator-overlay-host">
      <View style={[styles.preStartCard, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]}>
        <Text style={[styles.title, { color: theme.foreground }]}>{pickerMode === 'reacquire' ? '重新定位' : '选择目的地'}</Text>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>移动地图到目标位置</Text>
        <Text style={[styles.selectionText, { color: theme.foreground }]}>
          {mapSelection ? mapSelection.lat.toFixed(6) + ', ' + mapSelection.lng.toFixed(6) : '地图中心'}
        </Text>
        <View style={styles.buttonRow}>
          <TinyButton label={pickerMode === 'reacquire' ? '从这里继续' : '自动前往'} onPress={() => { void confirmRuntimePicker(); }} />
          <TinyButton label="取消" onPress={() => { straightLinePickerRef.current = false; actions.setPickerMode(null); }} />
        </View>
      </View>
    </View>;
  }

  if (!expanded) {
    return <View style={styles.overlayHost} pointerEvents="box-none" testID="activity-simulator-overlay-host">
      <TouchableOpacity
        testID="activity-simulator-collapsed"
        style={[styles.collapsed, styles.collapsedActive, { backgroundColor: theme.surfaceElevated, borderColor: signal === 'lost' ? Colors.danger : signal === 'poor' || signal === 'frozen' ? Colors.severityWarning : theme.border }]}
        activeOpacity={0.84}
        onPress={() => actions.setExpanded(true)}
        accessibilityRole="button"
        accessibilityLabel={`打开模拟行走，当前 ${timeScale} 倍，GPS ${signal}`}
      >
        <Text style={[styles.collapsedTitle, { color: theme.foreground }]}>SIM · {timeScale}×</Text>
      </TouchableOpacity>
      {status === 'tracking' ? joystick : null}
    </View>;
  }

  const speedLabels: Record<string, string> = { slow: '慢走', walk: '徒步', brisk: '快走', run: '跑步', custom: '自定义' };
  const gpsLabels: Record<SimulatorSignal, string> = { normal: '正常', poor: '较差', lost: '丢失', frozen: '卡住' };
  const terrainLabels: Record<string, string> = { flat: '平地', climb: '上坡', descend: '下坡' };

  return <View style={styles.overlayHost} pointerEvents="box-none" testID="activity-simulator-overlay-host">
    <View style={[styles.expanded, styles.expandedRuntime, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]} testID="activity-simulator-expanded">
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: theme.foreground }]}>模拟行走</Text>
          <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>{speedKmh.toFixed(1)} km/h · {timeScale}× · {gpsLabels[signal]}</Text>
        </View>
        <TouchableOpacity onPress={() => actions.setExpanded(false)} style={styles.collapseButton}>
          <Text style={[styles.collapseText, { color: theme.foreground }]}>收起</Text>
        </TouchableOpacity>
      </View>
      <ScrollView testID="activity-simulator-settings-scroll" style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="always" nestedScrollEnabled>
        {lastFailure ? <View style={styles.failureBanner}><Text style={styles.failureText}>{lastFailure}</Text></View> : null}
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>移动速度 · {speedKmh.toFixed(1)} km/h</Text>
        <View style={styles.buttonRowWrap} testID="activity-simulator-speed-controls">
          {(['slow', 'walk', 'brisk', 'run', 'custom'] as SimulatorSpeedPreset[]).map(preset => <TinyButton key={preset} label={speedLabels[preset]} active={speedPreset === preset || (preset === 'walk' && speedPreset === 'hike')} onPress={() => setSpeed(preset)} />)}
        </View>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>时间倍率</Text>
        <View style={styles.buttonRowWrap} testID="activity-simulator-time-scale-controls">
          {([1, 5, 10, 30, 60, 120] as SimulatorTimeScale[]).map(scale => <TinyButton key={scale} label={String(scale) + '×'} active={timeScale === scale} onPress={() => setTimeScale(scale)} />)}
        </View>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>GPS 状态</Text>
        <View style={styles.buttonRowWrap}>
          {(['normal', 'poor', 'lost', 'frozen'] as SimulatorSignal[]).map(item => <TinyButton key={item} label={gpsLabels[item]} active={signal === item} danger={item === 'lost' && signal === item} onPress={() => { void setGpsState(item); }} />)}
        </View>
        {signal === 'lost' ? <TinyButton label="重新定位" onPress={() => { actions.setMapSelection(null); actions.setPickerMode('reacquire'); }} /> : null}
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>地形</Text>
        <View style={styles.buttonRowWrap}>
          {(['flat', 'climb', 'descend'] as SimulatorAltitudeMode[]).map(mode => <TinyButton key={mode} label={terrainLabels[mode]} active={altitudeMode === mode} onPress={() => setAltitudeModel(mode)} />)}
        </View>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>自动移动</Text>
        <View style={styles.buttonRowWrap}>
          <TinyButton label="自动前往" onPress={() => { straightLinePickerRef.current = false; actions.setMapSelection(null); actions.setPickerMode('destination'); }} />
          {autopilotActive ? <TinyButton label="停止" danger onPress={() => actions.stopAutopilot()} /> : null}
        </View>
        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>路线纠正</Text>
        <View style={styles.buttonRowWrap}>
          {[10, 25, 50, 100].map(metres => <TinyButton key={metres} label={'回退 ' + metres + 'm'} onPress={() => { void rollback(metres); }} />)}
        </View>
        <TouchableOpacity onPress={() => setShowAdvanced(value => !value)} style={styles.advancedLink}>
          <Text style={[styles.collapseText, { color: theme.foregroundSecondary }]}>更多</Text>
        </TouchableOpacity>
        {showAdvanced ? <>
          <Text style={[styles.diagnostic, { color: theme.foregroundSecondary }]}>虚拟位置 {current.lat.toFixed(6)}, {current.lng.toFixed(6)}</Text>
          <View style={styles.inputActionRow}>
            <TextInput value={latDraft} onChangeText={setLatDraft} style={styles.smallInput} keyboardType="numbers-and-punctuation" placeholder="纬度" />
            <TextInput value={lngDraft} onChangeText={setLngDraft} style={styles.smallInput} keyboardType="numbers-and-punctuation" placeholder="经度" />
            <TinyButton label="设置虚拟位置" onPress={setManualVirtualPosition} />
          </View>
          <View style={styles.inputActionRow}>
            <TextInput value={speedDraft} onChangeText={setSpeedDraft} style={styles.smallInput} keyboardType="decimal-pad" />
            <TinyButton label="自定义 km/h" onPress={setCustomSpeed} />
            <TinyButton label="2×" active={timeScale === 2} onPress={() => setTimeScale(2)} />
          </View>
          <View style={styles.inputActionRow}>
            <TextInput value={accuracyDraft} onChangeText={setAccuracyDraft} style={styles.smallInput} keyboardType="decimal-pad" />
            <TinyButton label="精度 ±m" onPress={setCustomAccuracy} />
            <TextInput value={verticalDraft} onChangeText={setVerticalDraft} style={styles.smallInput} keyboardType="numbers-and-punctuation" />
            <TinyButton label="高度 m/h" onPress={setCustomVerticalRate} />
          </View>
          <View style={styles.buttonRowWrap}>
            <TinyButton label="直线移动" onPress={() => {
              straightLinePickerRef.current = true;
              actions.setMapSelection(null);
              actions.setPickerMode('destination');
            }} />
          </View>
          <Text testID="activity-simulator-native-diagnostics" style={[styles.diagnostic, { color: theme.foregroundSecondary }]}>
            QA {qaSessionId ?? '…'}{'\n'}map {mapDiagnostics.mountId ?? '—'} · style {mapDiagnostics.styleLoaded ? 'YES' : 'NO'} · ready {mapDiagnostics.mapReady ? 'YES' : 'NO'}{'\n'}provider {locationProviderSource.toUpperCase()} · owner {ownerGeneration?.slice(-8) ?? '—'} · seg {currentSegmentId?.slice(-8) ?? '—'}{'\n'}generated #{lastGeneratedSample?.sequence ?? 0} {lastGeneratedSample ? `${lastGeneratedSample.lat.toFixed(6)},${lastGeneratedSample.lng.toFixed(6)}` : '—'}{'\n'}accepted #{lastAcceptedSample?.sequence ?? 0} {lastAcceptedSample?.lat != null && lastAcceptedSample?.lng != null ? `${lastAcceptedSample.lat.toFixed(6)},${lastAcceptedSample.lng.toFixed(6)}` : '—'} · rejected {lastRejectionReason ?? '—'}{'\n'}committed {committedPointCount} {committedPosition ? `${committedPosition.lat.toFixed(6)},${committedPosition.lng.toFixed(6)}` : '—'} · sync {String(latestSyncState).toUpperCase()} · network {networkState.toUpperCase()}
          </Text>
          <View style={styles.buttonRowWrap}>
            <TinyButton label="Copy JSONL" onPress={() => { void copyDiagnostics(); }} />
            <TinyButton label="强制中断" danger disabled={status !== 'tracking'} onPress={() => { void forceInterruption(); }} />
          </View>
        </> : null}
      </ScrollView>
    </View>
    {status === 'tracking' ? joystick : null}
  </View>;
}

const styles = StyleSheet.create({
  overlayHost: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 230,
    elevation: 230,
  },
  preStartCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 108,
    zIndex: 240,
    borderWidth: 1,
    borderRadius: Radius.cardLg,
    padding: Spacing.md,
    ...Shadow.card,
  },
  primaryButton: {
    marginTop: Spacing.sm,
    minHeight: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#3E5F3A',
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  advancedLink: { alignSelf: 'flex-start', paddingVertical: 8, paddingRight: 12 },
  collapsed: {
    position: 'absolute',
    left: 10,
    zIndex: 230,
    minWidth: 48,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 9,
    borderWidth: 1,
    borderRadius: 22,
    ...Shadow.card,
  },
  collapsedIdle: { bottom: 165 },
  collapsedActive: { bottom: 100 },
  collapsedNeedsStart: { minWidth: 94 },
  collapsedTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  collapsedSetup: { color: Colors.danger, fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.4 },
  expanded: {
    position: 'absolute',
    top: 118,
    left: 10,
    right: 58,
    zIndex: 240,
    borderWidth: 1,
    borderRadius: Radius.cardLg,
    padding: Spacing.md,
    ...Shadow.overlay,
  },
  // Before Activity Start, restore the original screen-bounded viewport so
  // every configuration section is reachable. Active tracking keeps the
  // compact panel clear of the right-side joystick.
  expandedIdle: { bottom: 106 },
  expandedActive: { height: 210 },
  expandedRuntime: { height: 430 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { fontSize: FontSize.h3, fontWeight: '800' },
  meta: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  collapseButton: { paddingHorizontal: 10, paddingVertical: 8 },
  collapseText: { fontSize: 12, fontWeight: '700' },
  failureBanner: { backgroundColor: '#FDE9E7', borderColor: '#D06B61', borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 },
  failureText: { color: '#8A2E27', fontSize: 11, fontWeight: '700' },
  setupBanner: { backgroundColor: '#FFF4E5', borderColor: '#D49A43', borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 },
  setupTitle: { color: '#70450E', fontSize: 11, fontWeight: '800' },
  setupText: { color: '#70450E', fontSize: 10, lineHeight: 14, marginTop: 2 },
  scroll: { flex: 1, marginTop: 6 },
  scrollContent: { paddingBottom: 18 },
  diagnostic: { fontSize: 10, lineHeight: 15, fontVariant: ['tabular-nums'], marginBottom: 4 },
  sectionTitle: { fontSize: 12, fontWeight: '800', marginTop: 12, marginBottom: 6 },
  inputRow: { flexDirection: 'row', gap: 6 },
  input: { flex: 1, height: 36, borderRadius: 8, borderWidth: 1, borderColor: '#B9B6AE', backgroundColor: '#FFFFFF', color: '#1E2A24', paddingHorizontal: 8, fontSize: 12 },
  smallInput: { width: 70, height: 34, borderRadius: 8, borderWidth: 1, borderColor: '#B9B6AE', backgroundColor: '#FFFFFF', color: '#1E2A24', paddingHorizontal: 8, fontSize: 12 },
  buttonRow: { flexDirection: 'row', gap: 6, marginTop: 6 },
  buttonRowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  inputActionRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  tinyButton: { minHeight: 32, justifyContent: 'center', borderRadius: 8, borderWidth: 1, borderColor: '#8F978B', backgroundColor: '#F8F6F0', paddingHorizontal: 9, paddingVertical: 6 },
  tinyButtonActive: { backgroundColor: '#3E5F3A', borderColor: '#3E5F3A' },
  tinyButtonDanger: { backgroundColor: '#A7473D', borderColor: '#A7473D' },
  tinyButtonText: { color: '#304331', fontSize: 10, fontWeight: '800' },
  tinyButtonTextActive: { color: '#FFFFFF' },
  disabled: { opacity: 0.38 },
  hint: { fontSize: 10, lineHeight: 14, marginTop: 5 },
  selectionBox: { borderWidth: 1, borderRadius: 8, padding: 7, marginTop: 6 },
  selectionText: { fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] },
  movementControls: { gap: 6 },
  valueText: { fontSize: 14, fontWeight: '800' },
  joystickDock: { position: 'absolute', right: 10, bottom: 112, zIndex: 235, width: 124, paddingTop: 5, paddingBottom: 7, borderWidth: 1, borderRadius: Radius.cardLg, alignItems: 'center', ...Shadow.card },
  joystickLabel: { fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.8, marginBottom: 3 },
  joystick: { width: JOYSTICK_SIZE, height: JOYSTICK_SIZE, borderRadius: JOYSTICK_SIZE / 2, backgroundColor: 'rgba(62,95,58,0.10)', borderWidth: 2, borderStyle: 'dashed', borderColor: '#668063', alignItems: 'center', justifyContent: 'center' },
  deadZone: { position: 'absolute', width: JOYSTICK_TRAVEL * 2 * SIMULATOR_JOYSTICK_DEAD_ZONE + JOYSTICK_KNOB, height: JOYSTICK_TRAVEL * 2 * SIMULATOR_JOYSTICK_DEAD_ZONE + JOYSTICK_KNOB, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(62,95,58,0.28)' },
  knob: { width: JOYSTICK_KNOB, height: JOYSTICK_KNOB, borderRadius: JOYSTICK_KNOB / 2, backgroundColor: '#3E5F3A' },
  northLabel: { position: 'absolute', top: 4, color: '#3E5F3A', fontSize: 9, fontWeight: '900' },
});
