/**
 * DebugScreen — list of debug sessions + telemetry controls.
 *
 * Available only from an internal simulator-capable or development build.
 * This screen owns QA authorization; normal Settings never exposes it.
 *
 * Features:
 *   - List most recent 10 sessions: time / duration / events / upload status
 *   - Per-session actions: Re-upload / Export (share sheet) / Delete
 *   - Global actions: Clear all / Backend URL / API Key / Toggle WiFi-only / FAB visibility
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useNavigation } from '@react-navigation/native';

import { Colors, Spacing, FontSize, Radius } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { ModalCard, ModalCardHeader } from '../components/ModalCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { useSettingsStore } from '../store/useSettingsStore';
import { debugLogger } from '../services/debugLogger';
import { telemetryUploader } from '../services/telemetryUploader';
import type { SessionMetadata } from '../types/debugLog';
import {
  ALMOST_DONE_CLONE_V1_ROUTE,
} from '../features/activity/almostDoneCloneV1';
import { activitySimulatorBuildCapable } from '../features/activitySimulator/capability';
import { useActivitySimulatorStore } from '../features/activitySimulator/useActivitySimulatorStore';
import { resolveSimulatorContinuityLock } from '../features/activitySimulator/simulatorContinuity';
import { useTrackingStore } from '../store/useTrackingStore';
import { useAppStore } from '../store/useAppStore';
import {
  clearSnapLabRealmForOwner,
  listSnapLabActivities,
  type SnapLabActivityRecord,
} from '../features/activitySimulator/snapLabActivityStore';
import {
  clearRouteDrawingTraces,
  exportRouteDrawingTrace,
  isRouteDrawingDiagnosticsEnabled,
  listRouteDrawingTraces,
  setRouteDrawingDiagnosticsEnabled,
  type RouteDrawingTrace,
} from '../features/routeDrawing/routeDrawingTrace';
import { cairnText, formatCairnDate, formatCairnNumber } from '../i18n/runtime';

export function DebugScreen() {
  const nav = useNavigation();
  const settings = useSettingsStore();
  const {
    debugMode, telemetryUploadEnabled, telemetryWifiOnly,
    telemetryBackendUrl, telemetryApiKey, debugAnnotationFabVisible,
    updateSetting,
  } = settings;

  const [sessions, setSessions] = useState<SessionMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalEvents: 0, totalSize: 0 });
  const [bufferSize, setBufferSize] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<SessionMetadata | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [clearSnapLabOpen, setClearSnapLabOpen] = useState(false);
  const [destructiveBusy, setDestructiveBusy] = useState(false);
  const [snapLabActivities, setSnapLabActivities] = useState<SnapLabActivityRecord[]>([]);
  const [routeDrawingTraces, setRouteDrawingTraces] = useState<RouteDrawingTrace[]>([]);
  const [routeDrawingArmed, setRouteDrawingArmed] = useState(isRouteDrawingDiagnosticsEnabled());
  const ownerUserId = String(useAppStore(state => state.user?.id) ?? '');
  const qaToolsAvailable = activitySimulatorBuildCapable || (typeof __DEV__ !== 'undefined' && __DEV__);
  const activitySimulatorEnabled = useActivitySimulatorStore(state => state.enabled);
  const setActivitySimulatorEnabled = useActivitySimulatorStore(state => state.setEnabled);
  const simulatorBoundActivityId = useActivitySimulatorStore(state => state.boundActivityClientId);
  const trackingStatus = useTrackingStore(state => state.status);
  const trackingSessionId = useTrackingStore(state => state.sessionId);
  const trackingProviderSource = useTrackingStore(state => state.locationProviderSource);
  const simulatorContinuity = resolveSimulatorContinuityLock({
    boundActivityClientId: simulatorBoundActivityId,
    trackingStatus,
    trackingSessionId,
    providerSource: trackingProviderSource,
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await debugLogger.listSessions();
      setSessions(list);
      setStats({
        totalEvents: list.reduce((a, s) => a + (s.events_count ?? 0), 0),
        totalSize: list.reduce((a, s) => a + (s.raw_size_bytes ?? 0), 0),
      });
      setBufferSize(debugLogger.getBufferSize());
      setSnapLabActivities(ownerUserId ? await listSnapLabActivities(ownerUserId) : []);
      setRouteDrawingTraces(ownerUserId ? listRouteDrawingTraces(ownerUserId) : []);
    } finally {
      setLoading(false);
    }
  }, [ownerUserId]);

  const setRouteDrawingCapture = useCallback((value: boolean) => {
    setRouteDrawingDiagnosticsEnabled(value);
    setRouteDrawingArmed(value);
  }, []);

  const exportLatestRouteDrawing = useCallback(async () => {
    const latest = listRouteDrawingTraces(ownerUserId)[0];
    if (!latest) {
      Alert.alert(cairnText('debug-screen.no-route-drawing-trace'), cairnText('debug-screen.arm-capture-reproduce-one-drawing-operation-then'));
      return;
    }
    const body = exportRouteDrawingTrace(latest.sessionId, ownerUserId);
    if (!body || !FileSystem.documentDirectory) {
      Alert.alert(cairnText('debug-screen.export-unavailable'), cairnText('debug-screen.the-local-trace-file-could-not-be'));
      return;
    }
    setBusyId(`route:${latest.sessionId}`);
    try {
      const dir = `${FileSystem.documentDirectory}cairn-route-drawing-traces/`;
      const info = await FileSystem.getInfoAsync(dir);
      if (!info.exists) await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
      const path = `${dir}${latest.sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      await FileSystem.writeAsStringAsync(path, body, { encoding: FileSystem.EncodingType.UTF8 });
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert(cairnText('debug-screen.trace-saved-locally'), path);
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/json',
        dialogTitle: cairnText('debug-screen.cairn-route-drawing-trace-value', { sessionId: latest.sessionId }),
      });
    } catch (error) {
      Alert.alert(cairnText('debug-screen.export-failed'), String(error));
    } finally {
      setBusyId(null);
      void refresh();
    }
  }, [ownerUserId, refresh]);

  const openSnapLabRecorder = useCallback((mode: 'Hiking' | 'Running') => {
    if (!debugMode || simulatorContinuity.locked) return;
    setActivitySimulatorEnabled(true);
    (nav as any).navigate(mode);
  }, [debugMode, nav, setActivitySimulatorEnabled, simulatorContinuity.locked]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!debugMode && routeDrawingArmed) setRouteDrawingCapture(false);
  }, [debugMode, routeDrawingArmed, setRouteDrawingCapture]);

  async function handleUpload(s: SessionMetadata) {
    setBusyId(s.session_id);
    const r = await telemetryUploader.upload(s.session_id);
    setBusyId(null);
    Alert.alert(
      r.ok ? cairnText('debug-screen.uploaded') : cairnText('debug-screen.upload-failed'),
      r.ok ? cairnText('debug-screen.sent-value-bytes', { bytes: r.bytes }) : (r.error || cairnText('debug-screen.unknown-error')),
      [{ text: cairnText('debug-screen.ok') }],
    );
    refresh();
  }

  async function handleExport(s: SessionMetadata) {
    setBusyId(s.session_id);
    try {
      // If exporting the active session, flush in-memory buffer first
      if (s.session_id === debugLogger.getCurrentSessionId()) {
        await debugLogger.flush();
      }
      const path = await debugLogger.getSessionFilePath(s.session_id);
      if (!path) {
        Alert.alert(cairnText('debug-screen.export-failed'), cairnText('debug-screen.session-file-not-found'), [{ text: cairnText('debug-screen.ok') }]);
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(cairnText('debug-screen.sharing-unavailable'), cairnText('debug-screen.this-platform-does-not-support-sharing'), [{ text: cairnText('debug-screen.ok') }]);
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/x-ndjson',
        dialogTitle: cairnText('debug-screen.cairn-session-value', { session_id: s.session_id }),
      });
    } catch (err) {
      Alert.alert(cairnText('debug-screen.export-failed'), String(err), [{ text: cairnText('debug-screen.ok') }]);
    } finally {
      setBusyId(null);
    }
  }

  function handleDelete(s: SessionMetadata) {
    setDeleteTarget(s);
  }

  function handleClearAll() {
    setClearAllOpen(true);
  }

  async function confirmDelete() {
    if (!deleteTarget || destructiveBusy) return;
    setDestructiveBusy(true);
    try {
      await debugLogger.deleteSession(deleteTarget.session_id);
      setDeleteTarget(null);
      await refresh();
    } finally {
      setDestructiveBusy(false);
    }
  }

  async function confirmClearAll() {
    if (destructiveBusy) return;
    setDestructiveBusy(true);
    try {
      await debugLogger.clearAllSessions();
      setClearAllOpen(false);
      await refresh();
    } finally {
      setDestructiveBusy(false);
    }
  }

  async function confirmClearSnapLab() {
    if (destructiveBusy || !ownerUserId) return;
    setDestructiveBusy(true);
    try {
      await clearSnapLabRealmForOwner(ownerUserId);
      setClearSnapLabOpen(false);
      await refresh();
      Alert.alert(cairnText('debug-screen.snap-lab-cleared'), cairnText('debug-screen.all-isolated-activities-wal-evidence-diagnostics-and'));
    } catch (error) {
      Alert.alert(
        cairnText('debug-screen.snap-lab-not-fully-cleared'),
        cairnText('debug-screen.cairnnz-could-not-verify-complete-removal-no', { value1: String(error).slice(0, 140) }),
      );
    } finally {
      setDestructiveBusy(false);
    }
  }

  async function handleRetryAll() {
    setLoading(true);
    const results = await telemetryUploader.retryAll();
    setLoading(false);
    const okCount = results.filter((r) => r.ok).length;
    Alert.alert(
      cairnText('debug-screen.upload-finished'),
      cairnText('debug-screen.value-value-sessions-uploaded-successfully', { okCount: okCount, length: results.length }),
      [{ text: cairnText('debug-screen.ok') }],
    );
    refresh();
  }

  // Keep the hook order invariant even in a production build where this
  // route should be unreachable. This is a defense-in-depth screen guard.
  if (!qaToolsAvailable) {
    return (
      <View style={styles.container} testID="debug-unavailable">
        <SafeAreaView style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <BackButton onPress={() => nav.goBack()} />
            <Text style={styles.title}>{cairnText('debug-screen.debug-unavailable')}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <BackButton onPress={() => nav.goBack()} />
          <Text style={styles.title}>{cairnText('debug-screen.debug')}</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Status */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{cairnText('debug-screen.status')}</Text>
            <View style={styles.statusBox}>
              <Row label={cairnText('debug-screen.enable-qa-tools')}>
                <Switch
                  testID="debug-mode-toggle"
                  value={debugMode}
                  onValueChange={(value) => updateSetting('debugMode', value)}
                />
              </Row>
              <Text style={styles.statusLine}>{cairnText('debug-screen.debug-mode-value', { value1: debugMode ? cairnText('debug-screen.on') : cairnText('debug-screen.off') })}</Text>
              <Text style={styles.statusLine}>{cairnText('debug-screen.stored-sessions-value', { length: sessions.length })}</Text>
              <Text style={styles.statusLine}>{cairnText('debug-screen.total-events-value', { value1: formatCairnNumber(stats.totalEvents) })}</Text>
              <Text style={styles.statusLine}>{cairnText('debug-screen.storage-used-value-kb', { value1: (stats.totalSize / 1024).toFixed(1) })}</Text>
              <Text style={styles.statusLine}>{cairnText('debug-screen.buffer-in-memory-current-session-value', { bufferSize: bufferSize })}</Text>
              <Text style={styles.statusLine}>{cairnText('debug-screen.dropped-events-overflow-value', { value1: debugLogger.getDroppedEventsCount() })}</Text>
            </View>
            </View>

            {activitySimulatorBuildCapable ? (
              <View style={styles.section} testID="activity-simulator-owner">
                <Text style={styles.sectionHeader}>{cairnText('debug-screen.activity-simulator')}</Text>
                <Row label={cairnText('debug-screen.activity-simulator-755948c')}>
                  <Switch
                    testID="activity-simulator-toggle"
                    value={activitySimulatorEnabled}
                    disabled={!debugMode || simulatorContinuity.locked}
                    onValueChange={setActivitySimulatorEnabled}
                  />
                </Row>
                <Text style={styles.fieldHint}>
                  {!debugMode
                    ? cairnText('debug-screen.enable-qa-tools-first')
                    : simulatorContinuity.locked
                      ? simulatorContinuity.reason
                      : cairnText('debug-screen.uses-the-explicit-clean-path-or-raw')}
                </Text>
              </View>
            ) : null}

          <View style={styles.section} testID="route-drawing-diagnostics">
            <Text style={styles.sectionHeader}>{cairnText('debug-screen.route-drawing-replay')}</Text>
            <Row label={cairnText('debug-screen.arm-next-local-trace')}>
              <Switch
                testID="route-drawing-trace-toggle"
                value={routeDrawingArmed}
                disabled={!debugMode}
                onValueChange={setRouteDrawingCapture}
              />
            </Row>
            <View style={styles.statusBox}>
              <Text style={styles.statusLine}>{cairnText('debug-screen.local-traces-value-8', { length: routeDrawingTraces.length })}</Text>
              <Text style={styles.fieldHint}>{cairnText('debug-screen.precise-finger-and-route-geometry-stays-in')}</Text>
              <View style={styles.actionRow}>
                <ActionPill
                  label={cairnText('debug-screen.replay-latest')}
                  onPress={() => {
                    const latest = listRouteDrawingTraces(ownerUserId)[0];
                    (nav as any).navigate('RouteDrawingReplay', latest ? { sessionId: latest.sessionId } : { fixtureId: 'flattenV' });
                  }}
                />
                <ActionPill
                  label={cairnText('debug-screen.export-latest')}
                  onPress={() => { void exportLatestRouteDrawing(); }}
                  busy={busyId?.startsWith('route:')}
                />
                <ActionPill
                  label={cairnText('debug-screen.clear-local')}
                  danger
                  onPress={() => {
                    clearRouteDrawingTraces();
                    setRouteDrawingTraces([]);
                    setRouteDrawingArmed(false);
                    setRouteDrawingDiagnosticsEnabled(false);
                  }}
                />
              </View>
            </View>
          </View>

          {activitySimulatorBuildCapable ? (
            <View style={styles.section} testID="snap-lab-shelf">
              <Text style={styles.sectionHeader}>{cairnText('debug-screen.qa-activity-replay-lab')}</Text>
              <View style={styles.statusBox}>
                <Text style={styles.statusLine}>{cairnText('debug-screen.snap-lab-records-value', { length: snapLabActivities.length })}</Text>
                <Text style={styles.fieldHint}>{cairnText('debug-screen.raw-gps-qualification-canonical-isolated-wal-live')}</Text>
                <View style={styles.actionRow}>
                  <ActionPill label={cairnText('debug-screen.record-hike')} onPress={() => openSnapLabRecorder('Hiking')} />
                  <ActionPill label={cairnText('debug-screen.record-run')} onPress={() => openSnapLabRecorder('Running')} />
                </View>
                {snapLabActivities.map(activity => (
                  <TouchableOpacity
                    key={activity.activityId}
                    style={styles.snapLabCard}
                    testID={`snap-lab-record-${activity.activityId}`}
                    onPress={() => (nav as any).navigate('MapHistory', { sessionId: activity.activityId })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sessionTitle}>{activity.session.name}</Text>
                      <Text style={styles.sessionMeta}>{cairnText('debug-screen.value-value-value-value-points', { caseId: activity.context.caseId, profileId: activity.context.profileId, selectedSource: activity.selectedSource, length: activity.selectedFinal.length })}</Text>
                      <Text style={styles.sessionId}>{activity.activityId}</Text>
                    </View>
                    <Icon name="ChevronRight" size={16} color={Colors.textMuted} />
                  </TouchableOpacity>
                ))}
                {snapLabActivities.length > 0 ? (
                  <TouchableOpacity
                    style={styles.clearAllBtn}
                    testID="clear-snap-lab-records"
                    onPress={() => setClearSnapLabOpen(true)}
                  >
                    <Text style={styles.clearAllText}>{cairnText('debug-screen.clear-snap-lab-records')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>
          ) : null}

          {activitySimulatorBuildCapable ? <View style={styles.section} testID="qa-snap-review">
            <Text style={styles.sectionHeader}>{cairnText('debug-screen.qa-snap-review')}</Text>
            <View style={styles.statusBox}>
              <Text style={styles.statusLine}>{cairnText('debug-screen.almost-done-clone-v1')}</Text>
              <Text style={styles.fieldHint}>{cairnText('debug-screen.review-only-activity-detail-it-reads-the')}</Text>
              <TouchableOpacity
                style={styles.actionBtn}
                testID="open-almost-done-clone-v1"
                onPress={() => (nav as any).navigate('MapHistory', { qaReviewClone: ALMOST_DONE_CLONE_V1_ROUTE })}
              >
                <Icon name="Route" size={16} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.actionBtnText}>{cairnText('debug-screen.open-review-clone')}</Text>
              </TouchableOpacity>
            </View>
          </View> : null}

          {/* Telemetry */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>{cairnText('debug-screen.telemetry-upload')}</Text>
            <Row label={cairnText('debug-screen.auto-upload-sessions')}>
              <Switch
                value={telemetryUploadEnabled}
                onValueChange={(v) => updateSetting('telemetryUploadEnabled', v)}
              />
            </Row>
            <Row label={cairnText('debug-screen.wifi-only')}>
              <Switch
                value={telemetryWifiOnly}
                onValueChange={(v) => updateSetting('telemetryWifiOnly', v)}
              />
            </Row>
            <Row label={cairnText('debug-screen.show-annotation-fab')}>
              <Switch
                value={debugAnnotationFabVisible}
                onValueChange={(v) => updateSetting('debugAnnotationFabVisible', v)}
              />
            </Row>

            <Text style={styles.fieldLabel}>{cairnText('debug-screen.backend-url')}</Text>
            <TextInput
              style={styles.input}
              value={telemetryBackendUrl}
              onChangeText={(t) => updateSetting('telemetryBackendUrl', t)}
              placeholder={(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://your.server') + '  (default)'}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldHint}>{cairnText('debug-screen.leave-blank-to-use-the-app-s')}</Text>

            <TouchableOpacity style={styles.actionBtn} onPress={handleRetryAll}>
              <Icon name="ArrowUp" size={16} color={Colors.primary} />
              <Text style={styles.actionBtnText}>{cairnText('debug-screen.retry-all-pending-uploads')}</Text>
            </TouchableOpacity>
          </View>

          {/* Session list */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>{cairnText('debug-screen.sessions-value', { length: sessions.length })}</Text>
              {loading && <ActivityIndicator size="small" color={Colors.textMuted} />}
            </View>

            {sessions.length === 0 && !loading && (
              <Text style={styles.empty}>{cairnText('debug-screen.no-sessions-yet-start-tracking-with-debug')}</Text>
            )}

            {sessions.map((s) => (
              <View key={s.session_id} style={styles.sessionCard}>
                <View style={styles.sessionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionTitle}>
                      {formatCairnDate(new Date(s.started_at), { dateStyle: 'medium', timeStyle: 'short' })}
                    </Text>
                    <Text style={styles.sessionMeta}>{cairnText('debug-screen.value-value-value-value-value-events-value', { value1: s.activity_mode ?? cairnText('debug-screen.session'), value2: ' ', value3: s.ended_at ? formatDuration(s.ended_at - s.started_at) : cairnText('debug-screen.active'), value4: ' ', value5: formatCairnNumber(s.events_count ?? 0), value6: ' ', value7: formatCairnNumber((s.raw_size_bytes ?? 0) / 1024, { maximumFractionDigits: 1, minimumFractionDigits: 1 }) })}</Text>
                    <Text style={styles.sessionId}>{s.session_id}</Text>
                  </View>
                  <View style={styles.uploadBadge}>
                    {s.uploaded ? (
                      <Text style={styles.uploadedText}>{cairnText('debug-screen.uploaded-753101a')}</Text>
                    ) : (
                      <Text style={styles.notUploadedText}>{cairnText('debug-screen.pending-value', { value1: s.upload_attempts > 0 ? cairnText('debug-screen.value', { upload_attempts: s.upload_attempts }) : '' })}</Text>
                    )}
                  </View>
                </View>

                {s.upload_last_error && (
                  <Text style={styles.errorText}>{s.upload_last_error}</Text>
                )}

                <View style={styles.actionRow}>
                  <ActionPill
                    label={s.uploaded ? cairnText('debug-screen.re-upload') : cairnText('debug-screen.upload-now')}
                    onPress={() => handleUpload(s)}
                    busy={busyId === s.session_id}
                  />
                  <ActionPill
                    label={cairnText('debug-screen.export')}
                    onPress={() => handleExport(s)}
                    busy={busyId === s.session_id}
                  />
                  <ActionPill
                    label={cairnText('debug-screen.delete')}
                    onPress={() => handleDelete(s)}
                    danger
                  />
                </View>
              </View>
            ))}

            {sessions.length > 0 && (
              <TouchableOpacity style={styles.clearAllBtn} onPress={handleClearAll}>
                <Text style={styles.clearAllText}>{cairnText('debug-screen.clear-all-sessions')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
        <ModalCard
          visible={clearSnapLabOpen}
          onDismiss={() => !destructiveBusy && setClearSnapLabOpen(false)}
          dismissible={!destructiveBusy}
          testID="snap-lab-clear-confirmation"
        >
          <ModalCardHeader
            title={cairnText('debug-screen.clear-snap-lab-records-17f19c0')}
            body={cairnText('debug-screen.this-deletes-only-this-owner-s-saved')}
          />
          <View style={styles.modalActions}>
            <PrimaryButton label={cairnText('debug-screen.clear-qa-records')} variant="destructive" loading={destructiveBusy} onPress={() => { void confirmClearSnapLab(); }} />
            <PrimaryButton label={cairnText('debug-screen.keep-records')} variant="secondary" disabled={destructiveBusy} onPress={() => setClearSnapLabOpen(false)} />
          </View>
        </ModalCard>
        <ModalCard
          visible={deleteTarget !== null}
          onDismiss={() => !destructiveBusy && setDeleteTarget(null)}
          dismissible={!destructiveBusy}
          testID="debug-delete-session-confirmation"
        >
          <ModalCardHeader
            title={cairnText('debug-screen.delete-debug-session')}
            body={deleteTarget
              ? cairnText('debug-screen.session-value-contains-value-events-this-cannot', { session_id: deleteTarget.session_id, events_count: deleteTarget.events_count })
              : undefined}
          />
          <View style={styles.modalActions}>
            <PrimaryButton label={cairnText('debug-screen.delete-session')} variant="destructive" loading={destructiveBusy} onPress={() => { void confirmDelete(); }} />
            <PrimaryButton label={cairnText('debug-screen.keep-session')} variant="secondary" disabled={destructiveBusy} onPress={() => setDeleteTarget(null)} />
          </View>
        </ModalCard>
        <ModalCard
          visible={clearAllOpen}
          onDismiss={() => !destructiveBusy && setClearAllOpen(false)}
          dismissible={!destructiveBusy}
          testID="debug-clear-sessions-confirmation"
        >
          <ModalCardHeader
            title={cairnText('debug-screen.clear-debug-sessions')}
            body={cairnText('debug-screen.this-deletes-all-stored-debug-logs-the')}
          />
          <View style={styles.modalActions}>
            <PrimaryButton label={cairnText('debug-screen.clear-sessions')} variant="destructive" loading={destructiveBusy} onPress={() => { void confirmClearAll(); }} />
            <PrimaryButton label={cairnText('debug-screen.keep-sessions')} variant="secondary" disabled={destructiveBusy} onPress={() => setClearAllOpen(false)} />
          </View>
        </ModalCard>
      </SafeAreaView>
    </View>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View>{children}</View>
    </View>
  );
}

function ActionPill({
  label,
  onPress,
  busy,
  danger,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.pill, danger && styles.pillDanger]}
      onPress={onPress}
      disabled={busy}
    >
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        <Text style={[styles.pillText, danger && styles.pillTextDanger]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  modalActions: { gap: Spacing.sm },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary, marginLeft: Spacing.sm },
  section: {
    marginHorizontal: Spacing.base,
    marginTop: Spacing.lg,
  },
  sectionHeader: {
    fontSize: FontSize.tiny,
    fontWeight: '700',
    color: Colors.textMuted,
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  statusBox: {
    backgroundColor: '#fff',
    padding: Spacing.base,
    borderRadius: Radius.card,
  },
  statusLine: {
    fontSize: 13,
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fff',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.card,
    marginBottom: Spacing.xs,
  },
  rowLabel: { color: Colors.textPrimary, fontSize: FontSize.body },
  fieldLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: Spacing.sm,
    marginBottom: 4,
  },
  fieldHint: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    marginBottom: Spacing.sm,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#fff',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
    borderRadius: Radius.card,
    fontSize: 14,
    color: Colors.textPrimary,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.base,
    borderRadius: Radius.card,
    marginTop: Spacing.sm,
  },
  actionBtnText: { color: Colors.primary, marginLeft: 6, fontSize: 14, fontWeight: '600' },
  empty: { color: Colors.textMuted, fontSize: 13, paddingVertical: Spacing.sm },
  sessionCard: {
    backgroundColor: '#fff',
    padding: Spacing.base,
    borderRadius: Radius.card,
    marginBottom: Spacing.xs,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  sessionTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  sessionMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  sessionId: { color: '#aaa', fontSize: 10, marginTop: 2, fontFamily: 'monospace' },
  uploadBadge: { marginLeft: Spacing.sm },
  uploadedText: { color: '#2e8c3a', fontSize: 12, fontWeight: '600' },
  notUploadedText: { color: '#b36b00', fontSize: 12 },
  errorText: { color: Colors.danger, fontSize: 11, marginTop: Spacing.xs },
  actionRow: { flexDirection: 'row', marginTop: Spacing.sm, gap: 8 },
  snapLabCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    marginTop: Spacing.sm,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.textMuted,
    minWidth: 70,
    alignItems: 'center',
  },
  pillDanger: {
    borderColor: Colors.danger,
  },
  pillText: { fontSize: 12, color: Colors.textPrimary },
  pillTextDanger: { color: Colors.danger },
  clearAllBtn: {
    paddingVertical: Spacing.sm,
    alignItems: 'center',
    marginTop: Spacing.sm,
  },
  clearAllText: { color: Colors.danger, fontSize: 13 },
});

export default DebugScreen;
