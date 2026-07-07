/**
 * Sprint 72 STORY-00551 — Unfinished session resume banner.
 *
 * Rendered at the top of HomeScreen (and any other post-hydrate landing
 * surface) when useAppStore.pendingSessionResume is non-null. Offers the
 * user two choices:
 *   - Continue: resume tracking in the existing session
 *   - End: mark session ended (uses last known GPS point as endpoint)
 *
 * Detection happens in useAppStore.hydrate(). This component is only
 * responsible for the user-facing choice + wiring the outcome back to
 * the tracking store.
 */
import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useAppStore } from '../../store/useAppStore';
import { useTrackingStore } from '../../store/useTrackingStore';
import { crashLogger } from '../../services/crashLogger';

function fmtAge(ms: number | undefined): string {
  if (!ms || ms <= 0) return 'earlier';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

export function UnfinishedSessionBanner({ authMode = false }: { authMode?: boolean } = {}) {
  const pending = useAppStore(s => s.pendingSessionResume);
  const setPending = useAppStore(s => s.setPendingSessionResume);
  const trackingStatus = useTrackingStore(s => s.status);

  const ageLabel = useMemo(() => fmtAge(pending?.ageMs), [pending?.ageMs]);

  const clearActiveMarker = useCallback(async () => {
    try {
      const AsyncStorageMod = await import('@react-native-async-storage/async-storage');
      const AsyncStorage = AsyncStorageMod.default ?? AsyncStorageMod;
      await AsyncStorage.removeItem('cairn_bg_active_session_id');
    } catch { /* ignore */ }
  }, []);

  const onContinue = useCallback(async () => {
    if (!pending) return;
    crashLogger.breadcrumb(`unfinished_session:resume_tapped id=${pending.sessionId}`);

    // v409 fix #11: 真实现 resumeSession —— 之前 fallback 到 startTracking
    // 就直接新起 session,老数据成孤儿(见 194 session 事故)。
    // 现在: 读 cairn-hike-tracks/active/{sid}.jsonl → 恢复 store state
    // (sessionId, remoteSessionId, trackPoints, startedAt) → reactivate GPS。
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { readActiveHikeTail, listActiveHikes } = require('../../services/hikeTrackWriter');
      const points = await readActiveHikeTail(pending.sessionId);
      const metas = await listActiveHikes();
      const meta = metas.find((m: { session_id: string }) => m.session_id === pending.sessionId);

      if (points.length > 0 && meta) {
        crashLogger.breadcrumb(`v409:resume_replay pts=${points.length} sid=${pending.sessionId}`);
        // Restore useTrackingStore state
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useTrackingStore } = require('../../store/useTrackingStore');
        const trackPoints = points.map((p: { lat: number; lng: number; t: number; alt?: number | null; acc?: number | null }) => ({
          lat: p.lat, lng: p.lng, t: p.t,
          alt: p.alt ?? null, accuracy: p.acc ?? null,
        }));
        // 累计 distance (简单 haversine)
        let distanceM = 0;
        for (let i = 1; i < trackPoints.length; i++) {
          const p0 = trackPoints[i-1], p1 = trackPoints[i];
          const R = 6371000;
          const dLat = (p1.lat - p0.lat) * Math.PI / 180;
          const dLng = (p1.lng - p0.lng) * Math.PI / 180;
          const a = Math.sin(dLat/2) ** 2 + Math.cos(p0.lat * Math.PI/180) * Math.cos(p1.lat * Math.PI/180) * Math.sin(dLng/2) ** 2;
          distanceM += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        }
        useTrackingStore.setState({
          status: 'tracking',
          activityMode: meta.activity_mode ?? 'hiking',
          sessionId: pending.sessionId,
          remoteSessionId: meta.remote_id ?? null,
          startedAt: meta.started_at,
          trackPoints,
          trackPointsSmoothed: trackPoints,
          trackPointsRaw: trackPoints,
          distanceM,
          durationS: Math.floor((Date.now() - meta.started_at) / 1000),
        });
        // v409 audit-v2 fix: GPS watcher 重启 —— 必须显式调 startTracking。
        // 之前空 if 只 setState status='tracking',GPS subscription 不会 auto-activate,
        // 用户看到旧点但**新走的路不记录**。
        // startTracking 会 reset 一些 state 但保留 sessionId (我们刚 setState 的),
        // 通过 pauseTracking + resumeTracking 组合更安全: pauseTracking 不 reset
        // trackPoints,只 clear lastCoordinate; resumeTracking 走 activateForegroundSource。
        //
        // 但简化: 直接调 resumeTracking (它会 activateForegroundSource + 重启 durationInterval)
        // — resumeTracking 假设 status='paused',不会 clear trackPoints (那是 pauseTracking 做的)
        const ts = useTrackingStore.getState() as unknown as {
          resumeTracking?: () => Promise<void>;
          startTracking?: () => Promise<void>;
        };
        // Flip status to 'paused' first so resumeTracking's status transition works cleanly
        useTrackingStore.setState({ status: 'paused' });
        if (typeof ts.resumeTracking === 'function') {
          await ts.resumeTracking();
          crashLogger.breadcrumb(`v409:resume_replay_gps_reactivated sid=${pending.sessionId}`);
        } else if (typeof ts.startTracking === 'function') {
          // Fallback (never should hit): startTracking reset store, 我们的 replay 会丢
          await ts.startTracking();
          crashLogger.breadcrumb(`v409:resume_replay_gps_fallback_startTracking sid=${pending.sessionId}`);
        }
      } else {
        crashLogger.breadcrumb(`v409:resume_replay_empty sid=${pending.sessionId} pts=${points.length}`);
        // 磁盘无数据 → fallback 全新 startTracking (老逻辑)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useTrackingStore } = require('../../store/useTrackingStore');
        const ts = useTrackingStore.getState() as unknown as { startTracking?: () => Promise<void> };
        if (typeof ts.startTracking === 'function') await ts.startTracking();
      }
      setPending(null);
    } catch (err) {
      crashLogger.breadcrumb(`unfinished_session:resume_failed err=${String(err).slice(0, 100)}`);
      Alert.alert('Could not resume', 'Please start a new hike from the Hiking tab.');
      setPending(null);
      await clearActiveMarker();
    }
  }, [pending, setPending, clearActiveMarker]);

  const onDiscard = useCallback(async () => {
    if (!pending) return;
    crashLogger.breadcrumb(`unfinished_session:discard_tapped id=${pending.sessionId} reason=user_end`);
    await clearActiveMarker();
    setPending(null);
  }, [pending, setPending, clearActiveMarker]);

  // Hide banner if tracking is already active (the user has resumed some
  // other way, or startTracking picked up the session automatically).
  if (!pending) return null;
  if (trackingStatus === 'tracking' || trackingStatus === 'paused') return null;

  // v407 fix #4: AuthScreen mode — 用户未登录冷启时,pendingSessionResume
  // 已被 hydrate 检测出来但 HomeScreen 不 mount。此时在 AuthScreen 顶部
  // 显示只读版 banner (Sprint 72 STORY-00551 原意 "屏幕最上方立刻看到")。
  // 不提供 Continue (需要 tracking store,未登录用不了),只提供 End & save
  // (清 marker,避免登录后 banner 又跳出来吓用户)。
  if (authMode) {
    return (
      <View style={styles.banner} testID="unfinished-session-banner-auth">
        <View style={styles.textCol}>
          <Text style={styles.title}>You have an unfinished hike</Text>
          <Text style={styles.subtitle}>Started {ageLabel}. Sign in to continue, or dismiss to save & clear.</Text>
        </View>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            testID="unfinished-session-dismiss-auth"
            style={[styles.btn, styles.btnSecondary]}
            onPress={onDiscard}
          >
            <Text style={styles.btnSecondaryText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.banner} testID="unfinished-session-banner">
      <View style={styles.textCol}>
        <Text style={styles.title}>You have an unfinished hike</Text>
        <Text style={styles.subtitle}>Started {ageLabel}. Continue tracking or end and save?</Text>
      </View>
      <View style={styles.buttonRow}>
        <TouchableOpacity
          testID="unfinished-session-continue"
          style={[styles.btn, styles.btnPrimary]}
          onPress={onContinue}
        >
          <Text style={styles.btnPrimaryText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity
          testID="unfinished-session-end"
          style={[styles.btn, styles.btnSecondary]}
          onPress={onDiscard}
        >
          <Text style={styles.btnSecondaryText}>End &amp; save</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#FEF7E0',
    borderWidth: 1,
    borderColor: '#F1D68C',
    flexDirection: 'column',
    gap: 10,
  },
  textCol: { flexDirection: 'column' },
  title: { fontSize: 15, fontWeight: '600', color: '#5A3E00' },
  subtitle: { fontSize: 13, color: '#7A5A1A', marginTop: 2 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  btn: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: '#3E7C5C' },
  btnPrimaryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  btnSecondary: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D0C5A8' },
  btnSecondaryText: { color: '#5A3E00', fontWeight: '600', fontSize: 14 },
});
