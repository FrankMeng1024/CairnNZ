/**
 * LikeReportSheet — bottom sheet for AR like/report (v199 §F.2 + V2.C7
 * + V2.C10).
 *
 * Mounted in ARScreen when ARUiState === 'aim-locked' or 'report-reason'.
 * Replaces PlantSheet on those states (§C10 mutual exclusion).
 *
 * Like uses 5s client-side undo toast (canon §一-4 — request never
 * fires if cancelled). Report opens reason picker with mandatory
 * confirm. NO undo per canon.
 */
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from './tokens';
import { GlassPanel } from './GlassPanel';
import { useLikeReport, type ReportReason, type VoteUserPos } from '../hooks/useLikeReport';

interface Props {
  markerId: string;
  markerType: string;
  markerNote?: string;
  distanceM: number;
  /** User's current GPS for /vote body. Required by server-side gate. */
  userPos: VoteUserPos | null;
  /** OTA AimConeRad / ArInteractRangeM passthrough for "get closer" toast. */
  arInteractRangeM: number;
  /** OTA undo window. */
  undoMs?: number;
  /** Get JWT for Authorization header. */
  getAuthToken: () => string | null | Promise<string | null>;
  /** OTA poll interval. */
  pollMs?: number;
  onDismiss: () => void;
}

const REASON_LABELS: Record<ReportReason, string> = {
  fake_ad: 'False or misleading',
  info_mismatch: "Doesn't match reality",
  dislike: "Don't like this",
};

export function LikeReportSheet({
  markerId,
  markerType,
  markerNote,
  distanceM,
  userPos,
  arInteractRangeM,
  undoMs = 5000,
  getAuthToken,
  pollMs,
  onDismiss,
}: Props) {
  const insets = useSafeAreaInsets();
  const { state, error, scheduleLike, submitReport } = useLikeReport(markerId, {
    getAuthToken,
    pollMs,
  });

  // Like undo flow
  const [undoVisible, setUndoVisible] = useState(false);
  const [cancelFn, setCancelFn] = useState<(() => void) | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(undoMs);

  // Report flow
  const [reasonPickerOpen, setReasonPickerOpen] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);

  const tooFar = distanceM > arInteractRangeM;
  const userVote = state?.user_vote ?? null;
  const alreadyVoted = !!userVote;

  // Undo countdown ticker
  useEffect(() => {
    if (!undoVisible) return;
    const startedAt = Date.now();
    const t = setInterval(() => {
      const left = undoMs - (Date.now() - startedAt);
      if (left <= 0) {
        setUndoVisible(false);
        setCancelFn(null);
        setUndoCountdown(0);
      } else {
        setUndoCountdown(left);
      }
    }, 100);
    return () => clearInterval(t);
  }, [undoVisible, undoMs]);

  const onLike = () => {
    if (alreadyVoted) return;
    if (tooFar) return;
    if (!userPos) return;
    const cancel = scheduleLike(userPos, undoMs);
    setCancelFn(() => cancel);
    setUndoCountdown(undoMs);
    setUndoVisible(true);
  };

  const onUndo = () => {
    if (cancelFn) cancelFn();
    setCancelFn(null);
    setUndoVisible(false);
  };

  const onPickReason = async (reason: ReportReason) => {
    if (!userPos) return;
    setSubmittingReport(true);
    try {
      await submitReport(reason, userPos);
    } finally {
      setSubmittingReport(false);
      setReasonPickerOpen(false);
    }
  };

  const helpfulCount = state?.helpful_count ?? 0;
  const reportCount = state?.report_count ?? 0;

  return (
    <>
      <View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 12 }]}>
        <GlassPanel intensity={20} tint="dark" style={styles.sheet} borderRadius={18}>
          <View style={styles.header}>
            <Text style={styles.headerType}>{markerType.toUpperCase()}</Text>
            <Text style={styles.headerDist}>{distanceM.toFixed(1)} m</Text>
          </View>
          {!!markerNote && <Text style={styles.note} numberOfLines={2}>{markerNote}</Text>}
          <View style={styles.countsRow}>
            <Text style={styles.countText}>♥ {helpfulCount}</Text>
            {reportCount > 0 && <Text style={styles.countTextWarn}>⚠ {reportCount}</Text>}
            {state?.status === 'hidden' && <Text style={styles.statusHidden}>HIDDEN</Text>}
          </View>

          {tooFar && (
            <Text style={styles.tooFarText}>
              Get closer to interact (≤ {arInteractRangeM.toFixed(0)}m)
            </Text>
          )}

          {alreadyVoted ? (
            <Text style={styles.alreadyVoted}>
              You already marked this as {userVote.type}
              {userVote.reason ? ` (${REASON_LABELS[userVote.reason] ?? userVote.reason})` : ''}.
            </Text>
          ) : (
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btnLike, (tooFar || undoVisible) && styles.btnDisabled]}
                onPress={onLike}
                disabled={tooFar || undoVisible}
                activeOpacity={0.7}
              >
                <Text style={styles.btnLikeText}>♥ Like</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnReport, tooFar && styles.btnDisabled]}
                onPress={() => setReasonPickerOpen(true)}
                disabled={tooFar}
                activeOpacity={0.7}
              >
                <Text style={styles.btnReportText}>⚠ Report</Text>
              </TouchableOpacity>
            </View>
          )}

          {!!error && error !== 'already_voted' && (
            <Text style={styles.errorText}>{error}</Text>
          )}

          <TouchableOpacity style={styles.dismissBtn} onPress={onDismiss} activeOpacity={0.7}>
            <Text style={styles.dismissText}>Done</Text>
          </TouchableOpacity>
        </GlassPanel>
      </View>

      {/* 5s undo toast — once dismissed without undo, the like commits */}
      {undoVisible && (
        <View style={[styles.undoToast, { bottom: insets.bottom + 200 }]} pointerEvents="box-none">
          <View style={styles.undoToastInner}>
            <Text style={styles.undoToastText}>
              Liked. Undo? ({(undoCountdown / 1000).toFixed(1)}s)
            </Text>
            <TouchableOpacity style={styles.undoBtn} onPress={onUndo}>
              <Text style={styles.undoBtnText}>Undo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Reason picker modal */}
      <Modal visible={reasonPickerOpen} transparent animationType="fade"
             onRequestClose={() => setReasonPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setReasonPickerOpen(false)}>
          <Pressable style={styles.reasonCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.reasonTitle}>Why are you reporting?</Text>
            <Text style={styles.reasonSubtitle}>This is permanent — you cannot undo.</Text>
            {(['fake_ad', 'info_mismatch', 'dislike'] as ReportReason[]).map(r => (
              <TouchableOpacity
                key={r}
                style={styles.reasonRow}
                onPress={() => onPickReason(r)}
                disabled={submittingReport}
                activeOpacity={0.7}
              >
                <Text style={styles.reasonText}>{REASON_LABELS[r]}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.reasonCancelBtn}
              onPress={() => setReasonPickerOpen(false)}
              disabled={submittingReport}
            >
              <Text style={styles.reasonCancelText}>Cancel</Text>
            </TouchableOpacity>
            {submittingReport && <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 8 }} />}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sheetWrap: {
    position: 'absolute',
    bottom: 0, left: 12, right: 12,
  },
  sheet: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  headerType: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  headerDist: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },
  note: { color: 'rgba(255,255,255,0.85)', fontSize: 14, marginVertical: 6 },
  countsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  countText: { color: '#FFB3C0', fontSize: 14, fontWeight: '600' },
  countTextWarn: { color: '#FFC066', fontSize: 13, fontWeight: '600' },
  statusHidden: { color: '#FF6B6B', fontSize: 11, fontWeight: '700', letterSpacing: 1.2 },
  tooFarText: { color: '#FFC066', fontSize: 12, marginTop: 6, textAlign: 'center' },
  alreadyVoted: { color: 'rgba(255,255,255,0.65)', fontSize: 13, marginTop: 10, textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btnLike: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: 'rgba(255,90,120,0.20)', borderWidth: 1, borderColor: 'rgba(255,90,120,0.35)',
    alignItems: 'center',
  },
  btnLikeText: { color: '#FFB3C0', fontSize: 14, fontWeight: '700' },
  btnReport: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: 'rgba(240,168,56,0.18)', borderWidth: 1, borderColor: 'rgba(240,168,56,0.32)',
    alignItems: 'center',
  },
  btnReportText: { color: '#FFC066', fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  errorText: { color: '#FF6B6B', fontSize: 12, marginTop: 8 },
  dismissBtn: { marginTop: 10, alignItems: 'center', paddingVertical: 8 },
  dismissText: { color: 'rgba(255,255,255,0.5)', fontSize: 13, fontWeight: '500' },

  undoToast: { position: 'absolute', left: 16, right: 16 },
  undoToastInner: {
    backgroundColor: '#1c1f29', borderRadius: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  undoToastText: { color: '#fff', fontSize: 14 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  undoBtnText: { color: '#FFB3C0', fontSize: 14, fontWeight: '700' },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24,
  },
  reasonCard: {
    width: '100%', maxWidth: 340,
    backgroundColor: '#1a1c24', borderRadius: 16,
    paddingHorizontal: 18, paddingTop: 18, paddingBottom: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  reasonTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  reasonSubtitle: { color: 'rgba(255,255,255,0.6)', fontSize: 12, marginTop: 4, marginBottom: 12 },
  reasonRow: {
    paddingVertical: 14, paddingHorizontal: 4,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  reasonText: { color: '#fff', fontSize: 15 },
  reasonCancelBtn: {
    paddingVertical: 14, alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)',
  },
  reasonCancelText: { color: '#FF6B6B', fontSize: 15, fontWeight: '600' },
});
