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
import { activitySimulatorEngine, SIMULATOR_JOYSTICK_DEAD_ZONE } from './activitySimulatorEngine';
import { getSimulatorMapCenter } from './simulatorMapBridge';
import { appendSimulatorLog, clearSimulatorLogs, readSimulatorDiagnostics } from './simulatorLog';
import { hydrateActivitySimulatorForUser, simulatorAccuracyMeters, useActivitySimulatorStore } from './useActivitySimulatorStore';
import {
  SIMULATOR_TIME_SCALES,
  type SimulatorAccuracyPreset,
  type SimulatorAltitudeMode,
  type SimulatorSpeedPreset,
  type SimulatorTimeScale,
} from './types';

const JOYSTICK_SIZE = 116;
const JOYSTICK_KNOB = 44;
const JOYSTICK_TRAVEL = 38;

function TinyButton({ label, active, danger, disabled, onPress }: {
  label: string;
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
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
  const clientActivityId = useTrackingStore(state => state.sessionId);
  const currentSegmentId = useTrackingStore(state => state.currentSegmentId);
  const enabled = useActivitySimulatorStore(state => state.enabled);
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
  const mapSelection = useActivitySimulatorStore(state => state.mapSelection);
  const waypoints = useActivitySimulatorStore(state => state.waypoints);
  const autopilotActive = useActivitySimulatorStore(state => state.autopilotActive);
  const lastDecision = useActivitySimulatorStore(state => state.lastDecision);
  const lastFailure = useActivitySimulatorStore(state => state.lastFailure);
  const simulatorSessionId = useActivitySimulatorStore(state => state.simulatorSessionId);
  const latestActivityClientId = useActivitySimulatorStore(state => state.latestActivityClientId);
  const latestSyncState = useSessionStore(state => {
    const identity = clientActivityId ?? latestActivityClientId;
    const session = identity
      ? state.sessions.find(item => item.id === identity || item.clientActivityId === identity)
      : null;
    return session?.syncState ?? (clientActivityId ? 'recording' : '—');
  });
  const actions = useActivitySimulatorStore.getState();
  const [networkState, setNetworkState] = useState(networkMonitor.getState()?.state ?? 'unknown');
  const [latDraft, setLatDraft] = useState(String(current.lat));
  const [lngDraft, setLngDraft] = useState(String(current.lng));
  const [altDraft, setAltDraft] = useState(String(altitudeM));
  const [speedDraft, setSpeedDraft] = useState(String(speedKmh));
  const [verticalDraft, setVerticalDraft] = useState(String(verticalRateMPerHour));
  const [accuracyDraft, setAccuracyDraft] = useState(String(customAccuracyM ?? simulatorAccuracyMeters()));

  useEffect(() => {
    if (!userId) return;
    // AppRoot owns account hydration. Only recover here when the panel is
    // mounted in isolation; re-reading the same user's disk snapshot could
    // overwrite a just-enabled in-memory toggle before its coalesced write.
    if (useActivitySimulatorStore.getState().hydratedUserId !== String(userId)) {
      void hydrateActivitySimulatorForUser(String(userId));
    }
    activitySimulatorEngine.startRuntime();
    void networkMonitor.start();
    const unsubscribe = networkMonitor.onChange(next => setNetworkState(next.state));
    return () => {
      unsubscribe();
      useActivitySimulatorStore.getState().releaseJoystick();
    };
  }, [userId]);

  useEffect(() => {
    setLatDraft(current.lat.toFixed(6));
    setLngDraft(current.lng.toFixed(6));
  }, [origin.lat, origin.lng]);

  const stickX = useRef(new Animated.Value(0)).current;
  const stickY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      useActivitySimulatorStore.getState().stopAutopilot();
      appendSimulatorLog('SIM_INPUT', 'joystick_granted');
    },
    onPanResponderMove: (_event, gesture) => {
      const distance = Math.sqrt(gesture.dx ** 2 + gesture.dy ** 2);
      const scale = distance > JOYSTICK_TRAVEL ? JOYSTICK_TRAVEL / distance : 1;
      const x = gesture.dx * scale;
      const y = gesture.dy * scale;
      stickX.setValue(x);
      stickY.setValue(y);
      const bearingDegrees = ((Math.atan2(x, -y) * 180 / Math.PI) + 360) % 360;
      const magnitude = Math.min(1, distance / JOYSTICK_TRAVEL);
      useActivitySimulatorStore.getState().setJoystick(bearingDegrees, magnitude);
    },
    onPanResponderRelease: () => {
      useActivitySimulatorStore.getState().releaseJoystick();
      appendSimulatorLog('SIM_INPUT', 'joystick_released');
      Animated.spring(stickX, { toValue: 0, useNativeDriver: true, tension: 150, friction: 8 }).start();
      Animated.spring(stickY, { toValue: 0, useNativeDriver: true, tension: 150, friction: 8 }).start();
    },
    onPanResponderTerminate: () => {
      useActivitySimulatorStore.getState().releaseJoystick();
      Animated.spring(stickX, { toValue: 0, useNativeDriver: true }).start();
      Animated.spring(stickY, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  if (!enabled) return null;

  const applyManualStart = () => {
    if (status !== 'idle') {
      actions.setLastFailure('Manual Start here is available only before Activity Start.');
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
    if (status !== 'idle') {
      actions.setLastFailure('Set from map center is available only before Activity Start.');
      return;
    }
    const center = await getSimulatorMapCenter();
    if (!center) {
      actions.setLastFailure('Map center is not available yet.');
      return;
    }
    actions.setOrigin(center);
    setLatDraft(center.lat.toFixed(6));
    setLngDraft(center.lng.toFixed(6));
    appendSimulatorLog('SIM_INPUT', 'map_center_start_location_set', { lat: center.lat, lng: center.lng });
  };

  const useSelectedAsStart = () => {
    if (!mapSelection || status !== 'idle') return;
    actions.setOrigin(mapSelection);
    setLatDraft(mapSelection.lat.toFixed(6));
    setLngDraft(mapSelection.lng.toFixed(6));
    appendSimulatorLog('SIM_INPUT', 'map_selection_start_here', { lat: mapSelection.lat, lng: mapSelection.lng });
  };

  const moveToSelection = (queue: boolean) => {
    if (!mapSelection) return;
    const ok = queue ? actions.enqueueWaypoint(mapSelection) : actions.moveToWaypoint(mapSelection);
    if (ok) {
      appendSimulatorLog('SIM_INPUT', queue ? 'waypoint_queued' : 'autopilot_move_here', {
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

  const setAltitudeModel = (mode: SimulatorAltitudeMode) => {
    actions.setAltitudeMode(mode);
    setVerticalDraft(String(useActivitySimulatorStore.getState().verticalRateMPerHour));
    appendSimulatorLog('SIM_INPUT', 'altitude_model_set', { mode });
  };

  const setAccuracy = (preset: SimulatorAccuracyPreset) => {
    actions.setAccuracyPreset(preset);
    setAccuracyDraft(String(simulatorAccuracyMeters(useActivitySimulatorStore.getState())));
    appendSimulatorLog('SIM_INPUT', 'accuracy_preset_set', { preset, accuracyM: simulatorAccuracyMeters(useActivitySimulatorStore.getState()) });
  };

  const setTimeScale = (next: SimulatorTimeScale) => {
    if (!actions.setTimeScale(next)) return;
    appendSimulatorLog('SIM_INPUT', 'time_scale_set', {
      timeScale: next,
      effectiveVirtualElapsed: useActivitySimulatorStore.getState().effectiveVirtualElapsedMs,
    });
  };

  const toggleSignal = () => {
    const next = signal === 'normal' ? 'lost' : 'normal';
    actions.setSignal(next);
    appendSimulatorLog(next === 'lost' ? 'GPS_GAP' : 'SIM_INPUT', next === 'lost' ? 'simulator_gps_lost' : 'simulator_gps_restored', {
      hiddenMovementAllowed: true,
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
    try {
      const text = await readSimulatorDiagnostics(String(userId));
      const Clipboard = await import('expo-clipboard');
      await Clipboard.setStringAsync(text || 'No Simulator log events recorded.');
      actions.setLastFailure(null);
      Alert.alert('Simulator diagnostics copied', `${text.split('\n').filter(Boolean).length} JSONL events copied to the clipboard.`);
    } catch (error) {
      actions.setLastFailure(`Diagnostics export failed: ${String(error).slice(0, 100)}`);
    }
  };

  const addDistanceWaypoint = (distanceM: number, eventName: string) => {
    const target = destinationPoint(current, 0, distanceM);
    actions.moveToWaypoint(target);
    appendSimulatorLog('SIM_INPUT', eventName, { mode: activityMode, distanceM, target });
  };

  if (!expanded) {
    return (
      <TouchableOpacity
        testID="activity-simulator-collapsed"
        style={[styles.collapsed, { backgroundColor: theme.surfaceElevated, borderColor: signal === 'lost' ? Colors.danger : theme.border }]}
        activeOpacity={0.84}
        onPress={() => actions.setExpanded(true)}
      >
        <Text style={[styles.collapsedTitle, { color: theme.foreground }]}>SIM</Text>
        <Text style={[styles.collapsedMeta, { color: theme.foregroundSecondary }]}>{speedKmh.toFixed(1)} km/h · {timeScale}×</Text>
        <Text style={[styles.collapsedMeta, { color: signal === 'lost' ? Colors.danger : theme.foregroundSecondary }]}>
          {signal === 'lost' ? 'GPS LOST' : `GPS ±${Math.round(simulatorAccuracyMeters())}m`} · {Math.round(altitudeM)}m
        </Text>
        {lastFailure ? <Text numberOfLines={1} style={styles.collapsedFailure}>{lastFailure}</Text> : null}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.expanded, { backgroundColor: theme.surfaceElevated, borderColor: theme.border }]} testID="activity-simulator-expanded">
      <View style={styles.headerRow}>
        <View>
          <Text style={[styles.title, { color: theme.foreground }]}>Activity Simulator</Text>
          <Text style={[styles.meta, { color: theme.foregroundSecondary }]}>LOCAL QA · {networkState.toUpperCase()} · {timeScale}× clock</Text>
        </View>
        <TouchableOpacity onPress={() => actions.setExpanded(false)} style={styles.collapseButton}>
          <Text style={[styles.collapseText, { color: theme.foreground }]}>Collapse</Text>
        </TouchableOpacity>
      </View>

      {lastFailure ? <View style={styles.failureBanner}><Text style={styles.failureText}>{lastFailure}</Text></View> : null}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <Text style={[styles.diagnostic, { color: theme.foregroundSecondary }]}>
          {current.lat.toFixed(6)}, {current.lng.toFixed(6)} · {Math.round(altitudeM)}m{`\n`}
         {activityMode.toUpperCase()} · {status.toUpperCase()} · seg {currentSegmentId?.slice(-8) ?? '—'} · act {clientActivityId?.slice(-8) ?? '—'}{`\n`}
          clock {timeScale}× · {Math.floor(effectiveVirtualElapsedMs / 60_000)}m {Math.floor((effectiveVirtualElapsedMs % 60_000) / 1_000)}s simulated · {clockLimitReached ? 'LIMIT REACHED' : `${timeScale} simulated sec/real sec`}{`\n`}
         sample {lastDecision?.sequence ?? 0}: {lastDecision ? (lastDecision.accepted ? 'ACCEPTED' : `REJECTED · ${lastDecision.reason}`) : 'waiting'} · log {simulatorSessionId?.slice(-8) ?? '—'}{`\n`}
          Memory {lastDecision?.memoryCommitted ? 'COMMITTED' : lastDecision?.memoryDeduplicated ? 'DEDUPED' : lastDecision ? 'NO CHANGE' : 'waiting'} · sync {String(latestSyncState).toUpperCase()}
        </Text>

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Start / destination</Text>
        <View style={styles.inputRow}>
          <TextInput value={latDraft} onChangeText={setLatDraft} style={styles.input} keyboardType="numbers-and-punctuation" placeholder="Latitude" />
          <TextInput value={lngDraft} onChangeText={setLngDraft} style={styles.input} keyboardType="numbers-and-punctuation" placeholder="Longitude" />
        </View>
        <View style={styles.buttonRow}>
          <TinyButton label="Start here" disabled={status !== 'idle'} onPress={applyManualStart} />
          <TinyButton label="Use map center" disabled={status !== 'idle'} onPress={() => { void setFromMapCenter(); }} />
        </View>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>Long-press the map to select a point. Coordinates work worldwide.</Text>
        {mapSelection ? (
          <View style={[styles.selectionBox, { borderColor: theme.border }]}>
            <Text style={[styles.selectionText, { color: theme.foreground }]}>{mapSelection.lat.toFixed(6)}, {mapSelection.lng.toFixed(6)}</Text>
            <View style={styles.buttonRow}>
              {status === 'idle' ? <TinyButton label="Start here" onPress={useSelectedAsStart} /> : null}
              {status !== 'idle' ? <TinyButton label="Move here" onPress={() => moveToSelection(false)} /> : null}
              {status !== 'idle' ? <TinyButton label="Queue" onPress={() => moveToSelection(true)} /> : null}
              <TinyButton label="Clear" onPress={() => actions.setMapSelection(null)} />
            </View>
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Movement · north-up screen frame</Text>
        <View style={styles.movementRow}>
          <View style={styles.joystick} {...panResponder.panHandlers}>
            <View style={styles.deadZone} />
            <Animated.View style={[styles.knob, { transform: [{ translateX: stickX }, { translateY: stickY }] }]} />
            <Text style={styles.northLabel}>N</Text>
          </View>
          <View style={styles.movementControls}>
            <Text style={[styles.valueText, { color: theme.foreground }]}>{speedKmh.toFixed(1)} km/h</Text>
            <View style={styles.buttonRowWrap}>
              {(['walk', 'hike', 'run', 'custom'] as SimulatorSpeedPreset[]).map(preset => (
                <TinyButton key={preset} label={preset.toUpperCase()} active={speedPreset === preset} onPress={() => setSpeed(preset)} />
              ))}
            </View>
            <View style={styles.inputActionRow}>
              <TextInput value={speedDraft} onChangeText={setSpeedDraft} style={styles.smallInput} keyboardType="decimal-pad" />
              <TinyButton label="Set km/h" onPress={() => actions.setCustomSpeed(Number(speedDraft))} />
            </View>
            <View style={styles.buttonRowWrap}>
              <TinyButton label="10m too short" onPress={() => addDistanceWaypoint(10, 'too_short_distance_preset')} />
              <TinyButton label="20m boundary" onPress={() => addDistanceWaypoint(20, 'save_boundary_distance_preset')} />
              <TinyButton label="Move 1km" onPress={() => addDistanceWaypoint(1_000, 'one_kilometre_north_preset')} />
            </View>
            {autopilotActive || waypoints.length > 0
              ? <TinyButton label={`Stop autopilot (${waypoints.length})`} danger onPress={() => actions.stopAutopilot()} />
              : null}
          </View>
        </View>
       <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>Dead zone {Math.round(SIMULATOR_JOYSTICK_DEAD_ZONE * 100)}%. Joystick immediately interrupts autopilot. Reverse movement records a real return path.</Text>

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Time scale</Text>
        <View style={styles.buttonRowWrap}>
          {SIMULATOR_TIME_SCALES.map(scale => (
            <TinyButton
              key={scale}
              label={`${scale}×`}
              active={timeScale === scale}
              disabled={status !== 'idle'}
              onPress={() => setTimeScale(scale)}
            />
          ))}
        </View>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>
          Speed remains physical speed: {speedKmh.toFixed(1)} km/h at {timeScale}× represents {timeScale} Activity seconds per real second. Accelerated Activities use a bounded historical QA clock and never future timestamps.
        </Text>

       <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Altitude</Text>
        <View style={styles.buttonRowWrap}>
          {(['flat', 'climb', 'descend', 'custom'] as SimulatorAltitudeMode[]).map(mode => (
            <TinyButton key={mode} label={mode.toUpperCase()} active={altitudeMode === mode} onPress={() => setAltitudeModel(mode)} />
          ))}
        </View>
        <View style={styles.inputActionRow}>
          <TextInput value={altDraft} onChangeText={setAltDraft} style={styles.smallInput} keyboardType="numbers-and-punctuation" />
          <TinyButton label="Set altitude m" disabled={status !== 'idle'} onPress={() => actions.setAltitude(Number(altDraft))} />
          <TextInput value={verticalDraft} onChangeText={setVerticalDraft} style={styles.smallInput} keyboardType="numbers-and-punctuation" />
          <TinyButton label="Set m/h" onPress={() => actions.setVerticalRate(Number(verticalDraft))} />
        </View>

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>GPS evidence</Text>
        <View style={styles.buttonRowWrap}>
          {(['good', 'normal', 'poor'] as SimulatorAccuracyPreset[]).map(preset => (
            <TinyButton key={preset} label={preset.toUpperCase()} active={accuracyPreset === preset && customAccuracyM === null} onPress={() => setAccuracy(preset)} />
          ))}
          <TinyButton label={signal === 'lost' ? 'Restore GPS' : 'Lose GPS'} danger={signal === 'lost'} onPress={toggleSignal} />
        </View>
        <View style={styles.inputActionRow}>
          <TextInput value={accuracyDraft} onChangeText={setAccuracyDraft} style={styles.smallInput} keyboardType="decimal-pad" />
          <TinyButton label="Custom ±m" onPress={() => actions.setCustomAccuracy(Number(accuracyDraft))} />
        </View>
        {signal === 'lost' && status !== 'idle' ? (
          <View style={styles.buttonRowWrap}>
            <TinyButton label="Reposition to manual coords" onPress={() => actions.setCurrent({ lat: Number(latDraft), lng: Number(lngDraft) })} />
          </View>
        ) : null}

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Lifecycle / QA</Text>
        <View style={styles.buttonRowWrap}>
          <TinyButton label="Simulate recording interruption" danger disabled={status !== 'tracking'} onPress={() => { void forceInterruption(); }} />
          <TinyButton label="Poor GPS preset" onPress={() => setAccuracy('poor')} />
          <TinyButton label="Climb preset" onPress={() => setAltitudeModel('climb')} />
        </View>
        <Text style={[styles.hint, { color: theme.foregroundSecondary }]}>Pause/Resume/Finish remain the real Activity controls. A forced interruption parks the Activity for real Resume and a new segment.</Text>

        <Text style={[styles.sectionTitle, { color: theme.foreground }]}>Diagnostics / cleanup</Text>
        <View style={styles.buttonRowWrap}>
          <TinyButton label="Copy JSONL diagnostics" onPress={() => { void copyDiagnostics(); }} />
          <TinyButton label="Clear QA logs" disabled={status !== 'idle'} onPress={() => {
            if (userId) void clearSimulatorLogs(String(userId));
          }} />
          <TinyButton label="Reset Simulator" danger disabled={status !== 'idle'} onPress={() => actions.resetWhenIdle()} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  collapsed: {
    position: 'absolute',
    right: 10,
    top: 118,
    zIndex: 230,
    minWidth: 126,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: Radius.md,
    ...Shadow.card,
  },
  collapsedTitle: { fontSize: 12, fontWeight: '900', letterSpacing: 1 },
  collapsedMeta: { fontSize: 10, lineHeight: 14, fontWeight: '600' },
  collapsedFailure: { fontSize: 10, lineHeight: 14, color: Colors.danger, maxWidth: 220 },
  expanded: {
    position: 'absolute',
    top: 84,
    left: 8,
    right: 8,
    bottom: 106,
    zIndex: 240,
    borderWidth: 1,
    borderRadius: Radius.cardLg,
    padding: Spacing.md,
    ...Shadow.overlay,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  title: { fontSize: FontSize.h3, fontWeight: '800' },
  meta: { fontSize: 10, fontWeight: '700', marginTop: 2 },
  collapseButton: { paddingHorizontal: 10, paddingVertical: 8 },
  collapseText: { fontSize: 12, fontWeight: '700' },
  failureBanner: { backgroundColor: '#FDE9E7', borderColor: '#D06B61', borderWidth: 1, borderRadius: 8, padding: 8, marginTop: 8 },
  failureText: { color: '#8A2E27', fontSize: 11, fontWeight: '700' },
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
  movementRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  movementControls: { flex: 1, gap: 6 },
  valueText: { fontSize: 14, fontWeight: '800' },
  joystick: { width: JOYSTICK_SIZE, height: JOYSTICK_SIZE, borderRadius: JOYSTICK_SIZE / 2, backgroundColor: 'rgba(62,95,58,0.10)', borderWidth: 2, borderStyle: 'dashed', borderColor: '#668063', alignItems: 'center', justifyContent: 'center' },
  deadZone: { position: 'absolute', width: JOYSTICK_TRAVEL * 2 * SIMULATOR_JOYSTICK_DEAD_ZONE + JOYSTICK_KNOB, height: JOYSTICK_TRAVEL * 2 * SIMULATOR_JOYSTICK_DEAD_ZONE + JOYSTICK_KNOB, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(62,95,58,0.28)' },
  knob: { width: JOYSTICK_KNOB, height: JOYSTICK_KNOB, borderRadius: JOYSTICK_KNOB / 2, backgroundColor: '#3E5F3A' },
  northLabel: { position: 'absolute', top: 4, color: '#3E5F3A', fontSize: 9, fontWeight: '900' },
});
