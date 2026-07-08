/**
 * RevealedCairnSheet — full-content sheet shown when a user taps a
 * cairn that's in their explored area (within 25m of original plant
 * AND inside the unlock radius).
 *
 * Visible:
 *   - Author name + avatar (initial)
 *   - Time-ago + region label (e.g. "3 days ago · West Lake")
 *   - Title (if any)
 *   - Voice memo player (if any) — UI only in MVP, real playback in v0.2.7
 *   - Body text (if any)
 *   - Action row: Like / Report / Share
 *   - "Now in your Memory" hint at bottom (educates user that
 *     unlocked cairns are persistent across distance)
 */

import React from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Marker } from '../../../store/useMarkerStore';
import { Colors } from '../../../components/tokens';
import { MemoryColors } from '../config/memoryConfig';
import { splitTitleBody } from '../../plant/services/noteEncoding';

interface Props {
  marker: Marker | null;
  authorName?: string;
  regionLabel?: string;
  onLike?: () => void;
  onReport?: () => void;
  onShare?: () => void;
  onClose: () => void;
}

function formatAge(ms: number): string {
  const diff = Date.now() - ms;
  const day = 24 * 60 * 60 * 1000;
  if (diff < 60 * 60 * 1000) return 'just now';
  if (diff < day)            return `${Math.floor(diff / (60 * 60 * 1000))} h ago`;
  if (diff < 30 * day)       return `${Math.floor(diff / day)} d ago`;
  return new Date(ms).toLocaleDateString();
}

/**
 * Title/body separator — must match plant flow's TITLE_BODY_SEP
 * (U+001E Record Separator). Decoder is `splitTitleBody` imported from
 * the plant feature.
 */

function initialOf(name: string | undefined): string {
  if (!name) return '·';
  return name.trim().charAt(0).toUpperCase() || '·';
}

export function RevealedCairnSheet({
  marker, authorName, regionLabel, onLike, onReport, onShare, onClose,
}: Props) {
  if (!marker) return null;
  const { title, body } = splitTitleBody(marker.note ?? '');
  const hasVoice = Boolean(marker.voiceMemoUri);
  const ageText = formatAge(marker.createdAt);

  return (
    <Modal visible={true} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.headerRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initialOf(authorName)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.authorName}>{authorName ?? 'A neighbour'}</Text>
                <Text style={styles.metaText}>
                  {ageText}{regionLabel ? ` · ${regionLabel}` : ''}
                </Text>
              </View>
            </View>

            {title.length > 0 && <Text style={styles.title}>{title}</Text>}

            {hasVoice && (
              <View style={styles.voiceCard}>
                <View style={[styles.voicePlayBtn, { opacity: 0.4 }]}>
                  <Text style={styles.voicePlayIcon}>▶</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.voiceWave, { opacity: 0.4 }]}>▁▃▆█▇▅▃▂▁▁▂▄▆▄▂▁▁▂▃▅▃▁</Text>
                  <Text style={styles.voiceTime}>Voice playback coming soon</Text>
                </View>
              </View>
            )}

            {body.length > 0 && (
              <Text style={styles.body}>{body}</Text>
            )}

            <View style={styles.actions}>
              <ActionBtn label="Like" onPress={onLike} />
              <ActionBtn label="Report" onPress={onReport} />
              <ActionBtn label="Share" onPress={onShare} />
            </View>

            <View style={styles.hint}>
              <Text style={styles.hintText}>
                ✓ This cairn is in your Memory now. You can read it anywhere.
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ActionBtn({ label, onPress }: { label: string; onPress?: () => void }) {
  // v416 fix (Bug E): CairnPinsLayer 从未传 onLike/onReport/onShare handler,
  // 之前 onPress={undefined} 让按钮"看起来可点但完全无反应". 现在 disabled 视觉
  // 明确表达"暂未实装", 避免用户困惑地反复戳. handler 真接线后自动恢复正常.
  const isDisabled = typeof onPress !== 'function';
  return (
    <TouchableOpacity
      style={[styles.actionBtn, isDisabled && { opacity: 0.4 }]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
    >
      <Text style={styles.actionBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,20,20,0.25)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: MemoryColors.cream,
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 28,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 14,
  },
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: Colors.running,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  authorName: { fontSize: 13, fontWeight: '600', color: Colors.textPrimary },
  metaText:   { fontSize: 11, color: Colors.textSecondary, marginTop: 1 },
  title: {
    fontSize: 18, fontWeight: '600',
    color: Colors.textPrimary,
    marginBottom: 12, lineHeight: 24,
  },
  voiceCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginBottom: 12,
  },
  voicePlayBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  voicePlayIcon: { color: '#fff', fontSize: 12 },
  voiceWave: { fontSize: 12, color: Colors.primary, letterSpacing: -1 },
  voiceTime: { fontSize: 10, color: Colors.textSecondary, marginTop: 2 },
  body: {
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, padding: 14,
    fontSize: 13, color: Colors.textPrimary,
    lineHeight: 20,
    marginBottom: 14,
  },
  actions: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  actionBtn: {
    flex: 1, padding: 10,
    backgroundColor: Colors.surface,
    borderWidth: 1, borderColor: Colors.border,
    borderRadius: 10,
    alignItems: 'center',
  },
  actionBtnText: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  hint: {
    backgroundColor: Colors.primaryBg,
    borderRadius: 10, padding: 10,
    alignItems: 'center',
  },
  hintText: { fontSize: 11, color: Colors.textSecondary, fontStyle: 'italic' },
  closeBtn: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  closeBtnText: { fontSize: 13, color: Colors.textSecondary },
});
