/**
 * MarkDetailSheet — Friend System v1 / Sprint 68 / STORY-00532
 *
 * Bottom sheet that renders one of 4 forms per v4 §4.11:
 *   A. self (any visibility)    — Edit + Delete (+ Like/Report if Public)
 *   B. other + visited           — author (Friend tier only) + Like + Report + Delete-from-view
 *   C. other + via friend fog    — author (Friend tier only) + helper text + Delete-from-view
 *   D. unreachable (not visible) — sheet not opened
 *
 * Iron law mapping (v4 §3):
 *   - visible(mark)         → caller already filtered; D form never reaches this component
 *   - can_like_report(mark) → only form B (and form A when Public)
 *   - can_delete(mark)      → all visible forms (semantic differs: own = real DELETE,
 *                             other = hide, handled by Story-533/534)
 *
 * This component is pure presentation: action handlers come from props.
 * Story-533 (Like/Report fake) + Story-534 (Hide cache wipe) provide the
 * concrete behavior via onLike / onReport / onDelete / onClose props.
 *
 * Anonymization (v4 row Q): Public marks NEVER display author name even
 * when the creator is a friend. Sprint 67 STORY-00528 already nulls
 * author_name on the wire for Public marks. This component additionally
 * suppresses authorName when permission === 'public' as defense in depth.
 */

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import type { Marker } from '../../../store/useMarkerStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import {
  getMarkVisibility,
  getMarkDetailForm,
  type MarkDetailForm,
} from '../utils/markVisibility';

interface Props {
  /** The mark to show. null = closed. */
  marker: Marker | null;
  /** Viewer id (from useMarkerStore.userId). */
  viewerId: string | null;
  /** Subscribed friend ids (Memory 5-pick set). */
  subscribedFriendIds: ReadonlyArray<string | number>;
  /** All friends (superset of subscribed). */
  friendIds: ReadonlyArray<string | number>;
  /** Predicate from useMemoryStore.isExplored. */
  inMyFog: (lat: number, lng: number) => boolean;
  /** Handlers — Story-533/534 wire these. */
  onClose: () => void;
  onEdit?: (mark: Marker) => void;
  onDelete?: (mark: Marker, semantic: 'own' | 'hide') => void;
  onLike?: (mark: Marker) => void;
  onReport?: (mark: Marker) => void;
  /** Session-local like state — Story-533 fake state. */
  isLiked?: (markId: string) => boolean;
}

const TIER_BADGE: Record<'personal' | 'friend' | 'public', { label: string; icon: IconName }> = {
  personal: { label: 'Personal', icon: 'Lock' },
  friend:   { label: 'Friend',   icon: 'Users' },
  public:   { label: 'Public',   icon: 'Globe' },
};

/**
 * Normalize legacy 'group' (markers DB ENUM) → 'friend' for display.
 * Sprint 67 wire already does this on /api/circle/markers but local-store
 * marks may still carry 'group'. Defense in depth.
 */
function normalizePerm(p: string | null | undefined): 'personal' | 'friend' | 'public' {
  if (p === 'group' || p === 'friend') return 'friend';
  if (p === 'public') return 'public';
  return 'personal';
}

function formatAge(createdAt: number): string {
  const ms = Date.now() - createdAt;
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) {
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 1) return 'just now';
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
}

export function MarkDetailSheet(props: Props) {
  const {
    marker, viewerId, subscribedFriendIds, friendIds, inMyFog,
    onClose, onEdit, onDelete, onLike, onReport, isLiked,
  } = props;

  if (!marker) return null;

  const isMine =
    viewerId != null && String(viewerId) === String(marker.authorId);

  const vis = getMarkVisibility({
    viewerId,
    markUserId: marker.authorId,
    markLat: marker.lat,
    markLng: marker.lng,
    permission: marker.permission,
    inMyFog,
    subscribedFriendIds,
    friendIds,
  });
  const form: MarkDetailForm = getMarkDetailForm({ isMine, vis });

  // Form D: do not render a sheet. Caller should also suppress the tap,
  // but render-time guard ensures correctness if a tap leaked through.
  if (form === 'D') return null;

  const permDisplay = normalizePerm(marker.permission);
  const tierBadge = TIER_BADGE[permDisplay];

  // v4 row Q: Public marks anonymized regardless of creator's friend status.
  const showAuthorName =
    permDisplay !== 'public' && (form === 'B' || form === 'C') && !!marker.authorName;

  // Action surface per iron law 2 + 3:
  //   form A: Edit + Delete; Like/Report if Public
  //   form B: Like + Report + Delete-from-view
  //   form C: Delete-from-view only + "(Walk here to like/report)" hint
  const canLikeReport =
    form === 'B' || (form === 'A' && permDisplay === 'public');
  const canEdit = form === 'A';
  const deleteSemantic: 'own' | 'hide' = form === 'A' ? 'own' : 'hide';
  const liked = isLiked?.(marker.id) ?? false;
  // UX-Crit-1 fix (post-review UX round 2): own marks should not Report
  // themselves — current behavior shows misleading 'Thank you for reporting'
  // toast. Hide Report on form A (own marks); keep Like (own Public mark
  // can be liked per v4 §4.11 simplified rule).
  const showReport = canLikeReport && form !== 'A';

  // Split note → title + body (existing convention from PlantScreen).
  // Inline split: first line up to 30 chars is the title, rest is body.
  const splitNote = (note: string): { title: string; body: string } => {
    const trimmed = (note ?? '').trim();
    if (!trimmed) return { title: '', body: '' };
    const newlineIdx = trimmed.indexOf('\n');
    if (newlineIdx === -1) return { title: trimmed.slice(0, 60), body: '' };
    return {
      title: trimmed.slice(0, newlineIdx).slice(0, 60),
      body: trimmed.slice(newlineIdx + 1).trim(),
    };
  };
  const { title, body } = splitNote(marker.note);

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!marker}
      onRequestClose={onClose}
      testID={`mark-detail-sheet-form-${form}`}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          {/* Close */}
          <TouchableOpacity style={styles.close} onPress={onClose} testID="mark-detail-close">
            <Icon name="X" size={20} color={Colors.textSecondary} strokeWidth={2.2} />
          </TouchableOpacity>

          {/* Title + body */}
          <Text style={styles.title} testID="mark-detail-title">{title || '(untitled)'}</Text>
          {body ? <Text style={styles.body}>{body}</Text> : null}

          {/* Tier badge row */}
          <View style={styles.row} testID="mark-detail-tier-row">
            <View style={[styles.tierChip, permDisplay === 'personal' && styles.tierPersonal,
                                          permDisplay === 'friend'   && styles.tierFriend,
                                          permDisplay === 'public'   && styles.tierPublic]}>
              <Icon name={tierBadge.icon} size={12} color={Colors.textPrimary} strokeWidth={2.2} />
              <Text style={styles.tierText}>{tierBadge.label}</Text>
            </View>
            <Text style={styles.metaText}>{formatAge(marker.createdAt)}</Text>
          </View>

          {/* Author (form B/C, Friend tier only) */}
          {showAuthorName ? (
            <View style={styles.authorRow}>
              <Icon name="User" size={12} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={styles.authorText}>{marker.authorName}</Text>
            </View>
          ) : null}

          {/* Visited badge (form B) */}
          {form === 'B' ? (
            <View style={styles.visitedBadge}>
              <Icon name="Check" size={12} color={Colors.success} strokeWidth={2.4} />
              <Text style={styles.visitedText}>You visited here</Text>
            </View>
          ) : null}

          {/* Helper text (form C) */}
          {form === 'C' ? (
            <Text style={styles.helperText} testID="mark-detail-helper-walk">
              {/* UX-Med-3 fix (post-review UX round 2): reframed positively.
                  Original "(Walk here to like or report)" read like a
                  restriction. v4 §3 iron law 2 frames in-fog liking as
                  authenticity (you can only vouch for places you've
                  actually been). Copy now sells the rule. */}
              Walk this spot to vouch for it.
            </Text>
          ) : null}

          {/* Action surface */}
          <View style={styles.actionRow}>
            {canEdit ? (
              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary]}
                onPress={() => onEdit?.(marker)}
                testID="mark-detail-edit"
              >
                <Icon name="Pencil" size={14} color={Colors.primary} strokeWidth={2.2} />
                <Text style={styles.actionTextSecondary}>Edit</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnSecondary]}
              onPress={() => onDelete?.(marker, deleteSemantic)}
              testID={`mark-detail-delete-${deleteSemantic}`}
            >
              <Icon name="Trash2" size={14} color={Colors.danger} strokeWidth={2.2} />
              <Text style={[styles.actionTextSecondary, { color: Colors.danger }]}>
                {/* UX-Med-4 fix (post-review UX round 2): button vs modal
                    tone aligned at medium. Pre-fix: button "Hide from view"
                    (soft) → modal "Hide permanently?" (hard) felt like
                    bait-and-switch. Now both at medium tone — button labels
                    the action factually, modal explains the consequence
                    without scare-word "permanently". */}
                {deleteSemantic === 'own' ? 'Delete' : 'Hide from my map'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Like / Report row (forms B + A-public). v1: NO API wire — Story-533 stubs.
              UX-Crit-1 fix: show visible count delta so the local-only Like
              state doesn't read as "did it work?". Caption below clarifies
              the session-scope so users don't expect sync.
              UX-Crit-2 fix: hide Report on own marks (form A) — reporting
              your own mark would fire the misleading "Thank you for
              reporting" toast. v4 §4.11 lets own Public mark Like itself
              (simplified rule), but Report-self is incoherent. */}
          {canLikeReport ? (
            <View style={styles.likeRow}>
              <TouchableOpacity
                style={styles.likeBtn}
                onPress={() => onLike?.(marker)}
                testID="mark-detail-like"
              >
                <Icon
                  name="Heart"
                  size={16}
                  color={liked ? Colors.danger : Colors.textSecondary}
                  strokeWidth={2.2}
                />
                <Text style={[styles.likeText, liked && { color: Colors.danger }]}>
                  {liked ? '1 Liked' : 'Like'}
                </Text>
              </TouchableOpacity>
              {showReport ? (
                <TouchableOpacity
                  style={styles.reportBtn}
                  onPress={() => onReport?.(marker)}
                  testID="mark-detail-report"
                >
                  <Icon name="Flag" size={16} color={Colors.warning} strokeWidth={2.2} />
                  <Text style={styles.reportText}>Report</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: Colors.overlayDark,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    ...Shadow.card,
  },
  close: {
    alignSelf: 'flex-end',
    padding: Spacing.xs,
    marginBottom: Spacing.xs,
  },
  title: {
    fontSize: FontSize.h2,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  body: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    lineHeight: 22,
    marginBottom: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primaryBg,
  },
  tierPersonal: { backgroundColor: 'rgba(140,126,114,0.12)' },
  tierFriend:   { backgroundColor: Colors.primaryBg },
  tierPublic:   { backgroundColor: Colors.runningCardBg },
  tierText: {
    fontSize: FontSize.caption,
    color: Colors.textPrimary,
    fontWeight: '600',
  },
  metaText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  authorText: {
    fontSize: FontSize.caption,
    color: Colors.textSecondary,
  },
  visitedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.sm,
  },
  visitedText: {
    fontSize: FontSize.caption,
    color: Colors.success,
    fontWeight: '600',
  },
  helperText: {
    fontSize: FontSize.caption,
    color: Colors.textMuted,
    fontStyle: 'italic',
    marginBottom: Spacing.sm,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.button,
    borderWidth: 1,
  },
  actionBtnSecondary: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  actionTextSecondary: {
    fontSize: FontSize.body,
    color: Colors.primary,
    fontWeight: '600',
  },
  likeRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  likeText: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    fontWeight: '500',
  },
  reportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportText: {
    fontSize: FontSize.body,
    color: Colors.warning,
    fontWeight: '500',
  },
  // UX-Crit-1 fix: low-key caption telling the user the Like state is
  // local-only. Prevents "did it save?" confusion after restart.
});
