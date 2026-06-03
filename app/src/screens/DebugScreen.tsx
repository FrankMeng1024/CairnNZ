/**
 * DebugScreen — list of debug sessions + telemetry controls.
 *
 * Visible only when Settings → debugMode === true (5-tap on Version text).
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
import { useNavigation } from '@react-navigation/native';

import { Colors, Spacing, FontSize, Radius } from '../components/tokens';
import { Icon } from '../components/Icon';
import { BackButton } from '../components/BackButton';
import { useSettingsStore } from '../store/useSettingsStore';
import { debugLogger } from '../services/debugLogger';
import { telemetryUploader } from '../services/telemetryUploader';
import type { SessionMetadata } from '../types/debugLog';

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
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleUpload(s: SessionMetadata) {
    setBusyId(s.session_id);
    const r = await telemetryUploader.upload(s.session_id);
    setBusyId(null);
    Alert.alert(
      r.ok ? 'Uploaded ✓' : 'Upload failed',
      r.ok ? `Sent ${r.bytes} bytes.` : (r.error || 'Unknown error'),
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
        Alert.alert('Export failed', 'Session file not found.');
        return;
      }
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert('Sharing unavailable', 'This platform does not support sharing.');
        return;
      }
      await Sharing.shareAsync(path, {
        mimeType: 'application/x-ndjson',
        dialogTitle: `Cairn session ${s.session_id}`,
      });
    } catch (err) {
      Alert.alert('Export failed', String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(s: SessionMetadata) {
    Alert.alert(
      'Delete session?',
      `Session ${s.session_id} (${s.events_count} events). This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await debugLogger.deleteSession(s.session_id);
            refresh();
          },
        },
      ],
    );
  }

  async function handleClearAll() {
    Alert.alert(
      'Clear all sessions?',
      'This deletes all stored debug logs. The current active session (if any) is kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: async () => {
            await debugLogger.clearAllSessions();
            refresh();
          },
        },
      ],
    );
  }

  async function handleRetryAll() {
    setLoading(true);
    const results = await telemetryUploader.retryAll();
    setLoading(false);
    const okCount = results.filter((r) => r.ok).length;
    Alert.alert(
      'Upload finished',
      `${okCount} / ${results.length} sessions uploaded successfully.`,
    );
    refresh();
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <BackButton onPress={() => nav.goBack()} />
          <Text style={styles.title}>Debug</Text>
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          {/* Status */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>STATUS</Text>
            <View style={styles.statusBox}>
              <Text style={styles.statusLine}>
                Debug mode: {debugMode ? 'ON' : 'OFF'}
              </Text>
              <Text style={styles.statusLine}>
                Stored sessions: {sessions.length}
              </Text>
              <Text style={styles.statusLine}>
                Total events: {stats.totalEvents.toLocaleString()}
              </Text>
              <Text style={styles.statusLine}>
                Storage used: {(stats.totalSize / 1024).toFixed(1)} KB
              </Text>
              <Text style={styles.statusLine}>
                Buffer (in-memory, current session): {bufferSize}
              </Text>
              <Text style={styles.statusLine}>
                Dropped events (overflow): {debugLogger.getDroppedEventsCount()}
              </Text>
            </View>
          </View>

          {/* Telemetry */}
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>TELEMETRY UPLOAD</Text>
            <Row label="Auto-upload sessions">
              <Switch
                value={telemetryUploadEnabled}
                onValueChange={(v) => updateSetting('telemetryUploadEnabled', v)}
              />
            </Row>
            <Row label="WiFi-only">
              <Switch
                value={telemetryWifiOnly}
                onValueChange={(v) => updateSetting('telemetryWifiOnly', v)}
              />
            </Row>
            <Row label="Show annotation FAB">
              <Switch
                value={debugAnnotationFabVisible}
                onValueChange={(v) => updateSetting('debugAnnotationFabVisible', v)}
              />
            </Row>

            <Text style={styles.fieldLabel}>Backend URL</Text>
            <TextInput
              style={styles.input}
              value={telemetryBackendUrl}
              onChangeText={(t) => updateSetting('telemetryBackendUrl', t)}
              placeholder={(process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://your.server') + '  (default)'}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.fieldHint}>
              Leave blank to use the app&apos;s default backend.
            </Text>

            <TouchableOpacity style={styles.actionBtn} onPress={handleRetryAll}>
              <Icon name="ArrowUp" size={16} color={Colors.primary} />
              <Text style={styles.actionBtnText}>Retry all pending uploads</Text>
            </TouchableOpacity>
          </View>

          {/* Session list */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeader}>SESSIONS ({sessions.length})</Text>
              {loading && <ActivityIndicator size="small" color={Colors.textMuted} />}
            </View>

            {sessions.length === 0 && !loading && (
              <Text style={styles.empty}>
                No sessions yet. Start tracking with debug mode on.
              </Text>
            )}

            {sessions.map((s) => (
              <View key={s.session_id} style={styles.sessionCard}>
                <View style={styles.sessionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionTitle}>
                      {new Date(s.started_at).toLocaleString()}
                    </Text>
                    <Text style={styles.sessionMeta}>
                      {s.activity_mode ?? 'session'} ·{' '}
                      {s.ended_at ? formatDuration(s.ended_at - s.started_at) : 'active'} ·{' '}
                      {(s.events_count ?? 0).toLocaleString()} events ·{' '}
                      {((s.raw_size_bytes ?? 0) / 1024).toFixed(1)} KB
                    </Text>
                    <Text style={styles.sessionId}>{s.session_id}</Text>
                  </View>
                  <View style={styles.uploadBadge}>
                    {s.uploaded ? (
                      <Text style={styles.uploadedText}>✓ Uploaded</Text>
                    ) : (
                      <Text style={styles.notUploadedText}>
                        Pending {s.upload_attempts > 0 ? `(${s.upload_attempts})` : ''}
                      </Text>
                    )}
                  </View>
                </View>

                {s.upload_last_error && (
                  <Text style={styles.errorText}>{s.upload_last_error}</Text>
                )}

                <View style={styles.actionRow}>
                  <ActionPill
                    label={s.uploaded ? 'Re-upload' : 'Upload now'}
                    onPress={() => handleUpload(s)}
                    busy={busyId === s.session_id}
                  />
                  <ActionPill
                    label="Export"
                    onPress={() => handleExport(s)}
                    busy={busyId === s.session_id}
                  />
                  <ActionPill
                    label="Delete"
                    onPress={() => handleDelete(s)}
                    danger
                  />
                </View>
              </View>
            ))}

            {sessions.length > 0 && (
              <TouchableOpacity style={styles.clearAllBtn} onPress={handleClearAll}>
                <Text style={styles.clearAllText}>Clear all sessions</Text>
              </TouchableOpacity>
            )}
          </View>
        </ScrollView>
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
