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
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useFriendStore } from '../../../store/useFriendStore';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Called when the user taps a friend beyond the cap (UI shows lock,
   *  parent opens Paywall sheet — Story-542). */
  onCapHit: (friendId: number) => void;
}

export function MemoryFriendPickModal({ visible, onClose, onCapHit }: Props) {
  const friends = useFriendStore((s) => s.friends);
  const subs = useMemorySubscriptionsStore((s) => s.subscriptions);
  const limit = useMemorySubscriptionsStore((s) => s.limit);
  const loading = useMemorySubscriptionsStore((s) => s.loading);
  const load = useMemorySubscriptionsStore((s) => s.load);
  const subscribe = useMemorySubscriptionsStore((s) => s.subscribe);
  const unsubscribe = useMemorySubscriptionsStore((s) => s.unsubscribe);
  const isSubscribed = useMemorySubscriptionsStore((s) => s.isSubscribed);

  useEffect(() => {
    if (visible) void load();
  }, [visible]);

  const atCap = subs.length >= limit;

  const onTap = async (friendId: number) => {
    if (isSubscribed(friendId)) {
      await unsubscribe(friendId);
      return;
    }
    if (atCap) {
      onCapHit(friendId);
      return;
    }
    const status = await subscribe(friendId);
    if (status === 409) {
      // Cap exceeded server-side (race) — surface paywall.
      onCapHit(friendId);
    }
  };

  return (
    <Modal
      transparent
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      testID="memory-friend-pick-modal"
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>See friends on your map</Text>
              <Text style={styles.subtitle}>
                Pick up to {limit}. Currently subscribed: {subs.length} / {limit}.
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} testID="memory-friend-pick-close" style={styles.close}>
              <Icon name="X" size={18} color={Colors.textSecondary} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingBox}><ActivityIndicator color={Colors.primary} /></View>
          ) : friends.length === 0 ? (
            <Text style={styles.emptyHint}>No friends yet. Add a friend in the Friends tab first.</Text>
          ) : (
            <FlatList
              data={friends}
              keyExtractor={(f) => String(f.id)}
              renderItem={({ item }) => {
                const subscribed = isSubscribed(Number(item.id));
                const locked = !subscribed && atCap;
                return (
                  <TouchableOpacity
                    style={[styles.row, subscribed && styles.rowActive]}
                    onPress={() => onTap(Number(item.id))}
                    testID={`memory-friend-row-${item.id}`}
                  >
                    <View style={styles.rowMain}>
                      <Text style={styles.rowName}>{item.name || item.email}</Text>
                      {item.email && item.email !== item.name ? <Text style={styles.rowEmail}>{item.email}</Text> : null}
                    </View>
                    {subscribed ? (
                      <Icon name="Check" size={18} color={Colors.success} strokeWidth={2.5} />
                    ) : locked ? (
                      <Icon name="Lock" size={16} color={Colors.warning} strokeWidth={2.2} />
                    ) : (
                      <View style={styles.addCircle}>
                        <Icon name="Plus" size={14} color={Colors.primary} strokeWidth={2.4} />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.sep} />}
            />
          )}
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
    maxHeight: '70%',
    ...Shadow.card,
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
  sep: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },
});
