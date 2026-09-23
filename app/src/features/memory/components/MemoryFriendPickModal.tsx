/**
 * MemoryFriendPickModal — Friend System v1 / Sprint 70 / STORY-00540
 *
 * Modal shown from Memory tab Friends scope. Lists the viewer's friends
 * (from useFriendStore) with a check next to each subscribed friend
 * (from useMemorySubscriptionsStore). Tap to toggle; tapping a 6th
 * (after 5 already subscribed) triggers the Paywall sheet (Story-542).
 *
 * v4 §1 row M: cap = users.memory_subscription_limit (default 5). Server
 * trigger enforces; client shows 🔒 on rows beyond the cap.
 *
 * v372→v373 UX overhaul (UX-C/D/E):
 *   - Title copy: 'See friends on your map' → 'Show friends on your map'
 *     ('Show' is more direct — this is a control, not a wish).
 *   - Backdrop: cream-tint overlayDark → 'rgba(0,0,0,0.35)' soft-dark.
 *     Matches Hiking choose-a-route convention.
 *   - Animation: Modal's built-in animationType='slide' replaced with
 *     custom Animated.timing + Easing.out(Easing.cubic) 280ms + parallel
 *     backdrop fade. Same easing as Hiking route picker.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, ActivityIndicator, Animated, Easing } from 'react-native';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';
import { useVisualTheme } from '../../../hooks/useVisualTheme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps a friend beyond the cap (UI shows lock,
   *  parent opens Paywall sheet — Story-542). */
  onCapHit: (friendId: number) => void;
}

export function MemoryFriendPickModal({ visible, onClose, onCapHit }: Props) {
  const theme = useVisualTheme();
  const sources = useMemorySubscriptionsStore((s) => s.availableSources);
  const subs = useMemorySubscriptionsStore((s) => s.subscriptions);
  const limit = useMemorySubscriptionsStore((s) => s.limit);
  const loading = useMemorySubscriptionsStore((s) => s.loading);
  const load = useMemorySubscriptionsStore((s) => s.load);
  const subscribe = useMemorySubscriptionsStore((s) => s.subscribe);
  const unsubscribe = useMemorySubscriptionsStore((s) => s.unsubscribe);
  const isSubscribed = useMemorySubscriptionsStore((s) => s.isSubscribed);
  const selectedFriendId = useMemoryScopeStore((s) => s.selectedFriendId);
  const setScope = useMemoryScopeStore((s) => s.setScope);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  // UX-E fix: Animated values for smooth slide + backdrop fade matching
  // Hiking choose-a-route. Mount Modal in 'fade' mode (instant) and own
  // the slide via our Animated.View so we control easing precisely.
  // v374: align starting translateY 400 → 300 to match Hiking exactly
  // (was 100px further off-screen = faster perceived velocity).
  const slideAnim = useRef(new Animated.Value(300)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      void load();
      slideAnim.setValue(300);
      backdropAnim.setValue(0);
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 220,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 220,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  const atCap = subs.length >= limit;

  const onTap = async (friendId: number) => {
    if (pendingId !== null) return;
    if (isSubscribed(friendId)) {
      setScope('friend', String(friendId));
      dismiss();
      return;
    }
    if (atCap) {
      onCapHit(friendId);
      return;
    }
    setPendingId(friendId);
    setMutationError(null);
    const status = await subscribe(friendId);
    setPendingId(null);
    if (status >= 200 && status < 300) {
      setScope('friend', String(friendId));
      dismiss();
      return;
    }
    if (status === 409) {
      // A 409 may be a duplicate after an unknown prior commit, not only a
      // cap. Reconcile before choosing product feedback.
      await load();
      const reconciled = useMemorySubscriptionsStore.getState();
      if (reconciled.isSubscribed(friendId)) {
        setScope('friend', String(friendId));
        dismiss();
      } else if (reconciled.subscriptions.length >= reconciled.limit) {
        onCapHit(friendId);
      } else {
        setMutationError('Could not add this friend to Memory. Try again.');
      }
      return;
    }
    setMutationError('Could not update Memory friends. Check your connection and try again.');
  };

  const removeFriend = async (friendId: number) => {
    if (pendingId !== null) return;
    setPendingId(friendId);
    setMutationError(null);
    const status = await unsubscribe(friendId);
    setPendingId(null);
    if (status < 200 || status >= 300) {
      setMutationError('Could not remove this friend from Memory. Try again.');
      return;
    }
    if (String(friendId) === selectedFriendId) setScope('combined');
  };

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={dismiss}
      testID="memory-friend-pick-modal"
    >
      <Animated.View style={[styles.backdrop, { opacity: backdropAnim, backgroundColor: theme.readabilityScrim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={dismiss} activeOpacity={1} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }], backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.foreground }]}>Friends in Memory</Text>
              <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>
                Choose all friends or one person · {subs.length} of {limit} available
              </Text>
            </View>
            <TouchableOpacity onPress={dismiss} testID="memory-friend-pick-close" style={styles.close}>
              <Icon name="X" size={18} color={theme.iconInactive} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={theme.primary} /></View>
          ) : sources.length === 0 ? (
            <Text style={[styles.emptyHint, { color: theme.muted }]}>No shared Memory is available yet. Friends choose whether new completed Activities can appear here.</Text>
          ) : (
            <>
            {subs.length > 0 ? (
              <TouchableOpacity
                style={[styles.row, selectedFriendId == null && { backgroundColor: theme.surface }]}
                onPress={() => { setScope('combined'); dismiss(); }}
                accessibilityRole="button"
                accessibilityLabel="Show all available friends in Memory"
                testID="memory-friend-row-all"
              >
                <View style={styles.rowMain}>
                  <Text style={[styles.rowName, { color: theme.foreground }]}>All available friends</Text>
                  <Text style={[styles.rowEmail, { color: theme.foregroundSecondary }]}>Friend Memory only — your own Memory stays under Mine</Text>
                </View>
                {selectedFriendId == null ? <Icon name="Check" size={18} color={Colors.success} strokeWidth={2.5} /> : null}
              </TouchableOpacity>
            ) : null}
            <FlatList
              data={sources}
              keyExtractor={(f) => String(f.friend_id)}
              renderItem={({ item }) => {
                const friendId = Number(item.friend_id);
                const subscribed = isSubscribed(friendId);
                const locked = !subscribed && atCap;
                return (
                  <TouchableOpacity
                    style={[styles.row, subscribed && { backgroundColor: theme.surface }]}
                    onPress={() => onTap(friendId)}
                    disabled={pendingId !== null}
                    testID={`memory-friend-row-${item.friend_id}`}
                  >
                    <View style={styles.rowMain}>
                      <Text style={[styles.rowName, { color: theme.foreground }]}>{item.friend_name}</Text>
                      <Text style={[styles.rowEmail, { color: theme.foregroundSecondary }]}>
                        {subscribed ? 'Tap to see this friend only' : 'Available because this friend chose to share new Activities'}
                      </Text>
                    </View>
                    {pendingId === friendId ? (
                      <ActivityIndicator size="small" color={theme.primary} />
                    ) : subscribed ? (
                      <TouchableOpacity
                        onPress={() => { void removeFriend(friendId); }}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${item.friend_name} from Memory`}
                        style={styles.removeCircle}
                      >
                        <Icon name="X" size={14} color={theme.iconInactive} strokeWidth={2.3} />
                      </TouchableOpacity>
                    ) : locked ? (
                      <Icon name="Lock" size={16} color={Colors.warning} strokeWidth={2.2} />
                    ) : (
                      <View style={styles.addCircle}>
                        <Icon name="Plus" size={14} color={theme.iconActive} strokeWidth={2.4} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.border }]} />}
            />
            {mutationError ? <Text style={[styles.mutationError, { color: theme.destructive }]}>{mutationError}</Text> : null}
            </>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // UX-D fix (v372→v373): soft-dark backdrop matches Hiking choose-a-
    // route convention. Replaces cream-tint Colors.overlayDark which
    // read as "white veil".
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    maxHeight: '70%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 12,
  },
  // Drag handle pattern matches Hiking route picker.
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  title: { fontSize: FontSize.h2, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 2 },
  close: { padding: Spacing.xs },
  loadingBox: { paddingVertical: Spacing.xl, alignItems: 'center' },
  emptyHint: { textAlign: 'center', color: Colors.textMuted, paddingVertical: Spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.card,
  },
  rowActive: { backgroundColor: Colors.primaryBg },
  rowMain: { flex: 1 },
  rowName: { fontSize: FontSize.body, color: Colors.textPrimary, fontWeight: '600' },
  rowEmail: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 2 },
  addCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  removeCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  mutationError: { fontSize: FontSize.small, lineHeight: 17, marginTop: Spacing.sm },
  sep: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },
});
