/**
 * MarkerDetailSheet — bottom sheet shown when user taps a planted flag.
 *
 * Extracted from HikingScreen.tsx (O1 batch 21 refactor).
 * Shows flag type, note, voice memo controls, metadata, and delete action.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, Animated, Easing,
} from 'react-native';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../components/tokens';
import { Icon, type IconName } from '../components/Icon';
import { MARKER_META } from '../data/mockData';
import { haversineM, formatDistance } from '../utils/geo';
import type { Marker } from '../store/useMarkerStore';
import type { MarkerType } from '../data/mockData';

export type FlagTypeEntry = {
  id: MarkerType;
  icon: IconName;
  label: string;
  color: string;
  bg: string;
};

type Props = {
  marker: Marker;
  onClose: () => void;
  onDelete: () => void;
  lastCoordinate: { lat: number; lng: number } | null;
  onUpdateMemo: (uri: string, durationMs: number) => void;
  flagTypes: FlagTypeEntry[];
};

export function MarkerDetailSheet({ marker, onClose, onDelete, lastCoordinate, onUpdateMemo, flagTypes }: Props) {
  const meta = MARKER_META[marker.type] || MARKER_META.free;
  const flagType = flagTypes.find(f => f.id === marker.type);
  const timeAgo = (() => {
    const diffMs = Date.now() - marker.createdAt;
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.floor(mins / 60)}h ago`;
  })();

  const coordStr = `${marker.lat.toFixed(5)}, ${marker.lng.toFixed(5)}`;
  const distToMarker = lastCoordinate
    ? haversineM(lastCoordinate, { lat: marker.lat, lng: marker.lng })
    : null;
  const distStr = distToMarker != null
    ? formatDistance(distToMarker, 'km', 1) + ' km away'
    : '--';

  // Slide-in animation — same easing/duration as FlagPlantSheet for consistency
  const slideY = useRef(new Animated.Value(400)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: 0, duration: 280, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start();
  }, []);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  // v80 #45: voice memo state. recordingHandle != null while recording;
  // hasMemo derived from marker.voiceMemoUri.
  // Round-2 review-fix: recordingHandle MUST be mirrored to a ref so the
  // unmount cleanup `useEffect(() => () => ..., [])` actually sees the
  // current handle. With empty deps, the cleanup closure freezes on the
  // initial state value (null) — without the ref mirror, an in-flight
  // recording survives sheet close, the auto-stop timer fires orphaned
  // and the memo is lost; reopening the sheet within 5s hits the
  // isBusy() mutex and throws.
  const [recordingHandle, setRecordingHandle] = useState<{ stop: () => Promise<{ uri: string; durationMs: number } | null>; cancel: () => Promise<void> } | null>(null);
  const recordingHandleRef = useRef<typeof recordingHandle>(null);
  const [recordingProgress, setRecordingProgress] = useState(0); // 0..1 over 5s
  const [playing, setPlaying] = useState(false);
  const playHandleRef = useRef<{ stop: () => Promise<void> } | null>(null);

  const handleStartRecording = async () => {
    try {
      const { startRecording } = require('../services/voiceMemoService');
      const handle = await startRecording();
      setRecordingHandle(handle);
      recordingHandleRef.current = handle;
      setRecordingProgress(0);
      const startedAt = Date.now();
      const tickInterval = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 5000;
        setRecordingProgress(Math.min(1, elapsed));
        if (elapsed >= 1) clearInterval(tickInterval);
      }, 50);
    } catch (err: any) {
      Alert.alert('Could not record', err?.message || 'Microphone unavailable');
    }
  };

  const handleStopRecording = async () => {
    if (!recordingHandle) return;
    const result = await recordingHandle.stop();
    setRecordingHandle(null);
    recordingHandleRef.current = null;
    setRecordingProgress(0);
    if (result) {
      // Persist to permanent location keyed by marker id
      const { persistMemo } = require('../services/voiceMemoService');
      const finalUri = await persistMemo(result.uri, marker.id);
      onUpdateMemo(finalUri, result.durationMs);
    }
  };

  const handleCancelRecording = async () => {
    if (!recordingHandle) return;
    await recordingHandle.cancel();
    setRecordingHandle(null);
    recordingHandleRef.current = null;
    setRecordingProgress(0);
  };

  const handlePlayMemo = async () => {
    if (!marker.voiceMemoUri) return;
    if (playing) {
      await playHandleRef.current?.stop();
      playHandleRef.current = null;
      setPlaying(false);
      return;
    }
    try {
      const { playMemo } = require('../services/voiceMemoService');
      const handle = await playMemo(marker.voiceMemoUri);
      playHandleRef.current = handle;
      setPlaying(true);
      // Auto-clear playing state after duration + small buffer
      const dur = (marker.voiceMemoDurationMs ?? 5000) + 200;
      setTimeout(() => { setPlaying(false); playHandleRef.current = null; }, dur);
    } catch (err: any) {
      Alert.alert('Could not play', err?.message || 'Audio unavailable');
    }
  };

  // Cleanup any active recording/playback on unmount.
  // Round-2 review-fix: cleanup uses recordingHandleRef.current (not the
  // state value `recordingHandle`) because [] deps means this closure is
  // captured once at mount and the state's null initial value would
  // permanently haunt the cleanup. Refs side-step React's closure capture
  // by being a live mutable reference cell.
  useEffect(() => {
    return () => {
      recordingHandleRef.current?.cancel().catch(() => {});
      playHandleRef.current?.stop().catch(() => {});
    };
  }, []);

  const handleClose = () => {
    setDeleteConfirm(false);
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onClose());
  };

  const handleDelete = () => {
    if (!deleteConfirm) { setDeleteConfirm(true); return; }
    Animated.parallel([
      Animated.timing(slideY, { toValue: 400, duration: 220, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(() => onDelete());
  };

  return (
    <Animated.View style={[detailStyles.container, { opacity }]}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={handleClose} activeOpacity={1} />
      <Animated.View style={[detailStyles.sheet, { transform: [{ translateY: slideY }] }]}>
        <View style={detailStyles.handle} />
        <View style={detailStyles.headerRow}>
          <View style={[detailStyles.typeBadge, { backgroundColor: meta.bg, borderColor: meta.color }]}>
            {flagType && <Icon name={flagType.icon} size={14} color={meta.color} strokeWidth={2.5} />}
            <Text style={[detailStyles.typeLabel, { color: meta.color }]}>{meta.label}</Text>
          </View>
          <TouchableOpacity style={detailStyles.closeChip} onPress={handleClose}>
            <Icon name="X" size={IconSize.sm} color={Colors.textSecondary} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        {marker.note ? (
          <Text style={detailStyles.note}>{marker.note}</Text>
        ) : (
          <Text style={[detailStyles.note, { color: Colors.textMuted, fontStyle: 'italic' }]}>(No note)</Text>
        )}
        {/* v80 #45: voice memo. Three states:
            - Has memo → Play / Stop button
            - Recording → red Stop / Cancel pair + progress bar
            - No memo → Record button */}
        <View style={detailStyles.voiceMemoRow}>
          {marker.voiceMemoUri ? (
            <TouchableOpacity
              style={[detailStyles.voiceBtn, playing && detailStyles.voiceBtnActive]}
              onPress={handlePlayMemo}
              activeOpacity={0.7}
            >
              <Icon name={playing ? 'Square' : 'Volume2'} size={14} color={playing ? '#fff' : Colors.primary} strokeWidth={2.2} />
              <Text style={[detailStyles.voiceBtnLabel, playing && { color: '#fff' }]}>
                {playing ? 'Stop' : `Play voice memo${marker.voiceMemoDurationMs ? ` · ${Math.round(marker.voiceMemoDurationMs/1000)}s` : ''}`}
              </Text>
            </TouchableOpacity>
          ) : recordingHandle ? (
            <>
              <TouchableOpacity
                style={[detailStyles.voiceBtn, { backgroundColor: Colors.danger, borderColor: Colors.danger, flex: 1 }]}
                onPress={handleStopRecording}
                activeOpacity={0.7}
              >
                <Icon name="Square" size={14} color="#fff" strokeWidth={2.2} />
                <Text style={[detailStyles.voiceBtnLabel, { color: '#fff' }]}>Stop ({Math.ceil((1 - recordingProgress) * 5)}s)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[detailStyles.voiceBtnSecondary]}
                onPress={handleCancelRecording}
                activeOpacity={0.7}
              >
                <Icon name="X" size={14} color={Colors.textSecondary} strokeWidth={2.2} />
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity
              style={detailStyles.voiceBtn}
              onPress={handleStartRecording}
              activeOpacity={0.7}
            >
              <Icon name="Mic" size={14} color={Colors.primary} strokeWidth={2.2} />
              <Text style={detailStyles.voiceBtnLabel}>Record voice memo (5s)</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={detailStyles.metaRow}>
          <Icon name="Timer" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{timeAgo}</Text>
        </View>
        <View style={detailStyles.metaRow}>
          <Icon name="MapPin" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{coordStr}</Text>
        </View>
        <View style={detailStyles.metaRow}>
          <Icon name="Route" size={IconSize.sm} color={Colors.textMuted} strokeWidth={1.8} />
          <Text style={detailStyles.meta}>{distStr}</Text>
        </View>
        {marker.approximate && (
          <View style={[detailStyles.metaRow, { backgroundColor: Colors.severityCautionBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }]}>
            <Icon name="Info" size={IconSize.sm} color={Colors.severityCaution} strokeWidth={1.8} />
            <Text style={[detailStyles.meta, { color: Colors.severityCaution }]}>
              Approximate position{marker.gpsAgeS != null && marker.gpsAgeS > 0
                ? ` (GPS was ${marker.gpsAgeS < 60 ? `${marker.gpsAgeS}s` : `${Math.round(marker.gpsAgeS / 60)}min`} old)`
                : ''}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={[detailStyles.deleteBtn, deleteConfirm && { backgroundColor: Colors.danger }]}
          onPress={handleDelete}
        >
          <Icon name="Trash2" size={IconSize.sm} color={deleteConfirm ? '#fff' : Colors.danger} strokeWidth={2} />
          <Text style={[detailStyles.deleteBtnText, deleteConfirm && { color: '#fff' }]}>{deleteConfirm ? 'Confirm Delete' : 'Delete Flag'}</Text>
        </TouchableOpacity>
      </Animated.View>
    </Animated.View>
  );
}

const detailStyles = StyleSheet.create({
  // v80 #45: voice memo row + button styles. Sit between note and meta.
  voiceMemoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    marginBottom: Spacing.xs,
  },
  voiceBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.primaryLight,
  },
  voiceBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  voiceBtnLabel: {
    fontSize: FontSize.small,
    fontWeight: '600',
    color: Colors.primary,
  },
  voiceBtnSecondary: {
    width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  container: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet, borderTopRightRadius: Radius.sheet,
    padding: Spacing.xl, paddingBottom: Spacing.xxl, gap: Spacing.sm,
    ...Shadow.overlay,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.sm,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  typeBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderWidth: 1.5,
  },
  typeLabel: { fontSize: FontSize.caption, fontWeight: '700' },
  closeChip: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center',
  },
  note: { fontSize: FontSize.body, color: Colors.textSecondary, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta: { fontSize: FontSize.small, color: Colors.textMuted },
  deleteBtn: {
    marginTop: Spacing.xs, borderRadius: Radius.button, paddingVertical: Spacing.md,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.danger + '50',
    backgroundColor: Colors.dangerBg,
    flexDirection: 'row', gap: Spacing.xs, justifyContent: 'center',
  },
  deleteBtnText: { color: Colors.danger, fontWeight: '600', fontSize: FontSize.body },
});
