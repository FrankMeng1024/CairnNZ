/**
 * MemoryFriendPickModal — Friend System v1 / Sprint 70 / STORY-00540
 *
 * Lists every current friend. Authorized-empty sources remain selectable;
 * friends who have not shared are visible but disabled. A stored preference
 * distinguishes an explicit empty selection from first use.
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
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, FlatList, ActivityIndicator, Animated, Easing } from 'react-native';
import { useMemorySubscriptionsStore } from '../store/useMemorySubscriptionsStore';
import { useMemoryScopeStore } from '../store/useMemoryScopeStore';
import { useFriendMemoryStore } from '../store/useFriendMemoryStore';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../../../components/tokens';
import { Icon } from '../../../components/Icon';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { DismissButton } from '../../../components/DismissButton';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Memory opts into combined scope after selection; Route keeps its own
   * independent display scope while editing the shared contributor set. */
  activateCombinedOnSelect?: boolean;
}

export function MemoryFriendPickModal({ visible, onClose, activateCombinedOnSelect = true }: Props) {
  const theme = useVisualTheme();
  const sources = useMemorySubscriptionsStore((s) => s.availableSources);
  const loading = useMemorySubscriptionsStore((s) => s.loading);
  const loadError = useMemorySubscriptionsStore((s) => s.error);
  const load = useMemorySubscriptionsStore((s) => s.load);
  const subscribe = useMemorySubscriptionsStore((s) => s.subscribe);
  const unsubscribe = useMemorySubscriptionsStore((s) => s.unsubscribe);
  const isSubscribed = useMemorySubscriptionsStore((s) => s.isSubscribed);
  const setScope = useMemoryScopeStore((s) => s.setScope);
  const loadFriendProjections = useFriendMemoryStore((s) => s.loadSelectedProjections);

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

  const onTap = (friendId: number, sharingStatus: 'not_shared' | 'shared_empty' | 'shared') => {
    if (sharingStatus === 'not_shared') return;
    if (isSubscribed(friendId)) {
      if (activateCombinedOnSelect) setScope('combined');
      void unsubscribe(friendId);
      return;
    }
    if (activateCombinedOnSelect) setScope('combined');
    // subscribe() commits the local intent synchronously before its first
    // await. Projection work starts only after the server accepts the grant;
    // any transport failure remains a center-map retry, never a row error.
    void subscribe(friendId).then(status => {
      if ((status >= 200 && status < 300) || status === 409) {
        void loadFriendProjections([friendId]);
      }
    });
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
        <Animated.View
          onStartShouldSetResponder={() => true}
          style={[styles.sheet, { transform: [{ translateY: slideAnim }], backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.foreground }]}>Friends in Memory</Text>
              <Text style={[styles.subtitle, { color: theme.foregroundSecondary }]}>
                Choose one or more shared exploration areas
              </Text>
            </View>
            <DismissButton onPress={dismiss} label="Close friend selection" testID="memory-friend-pick-close" />
          </View>

          {loading && sources.length === 0 ? (
            <View style={styles.loadingBox}><ActivityIndicator color={theme.primary} /></View>
          ) : loadError && sources.length === 0 ? (
            <View style={styles.listError} testID="memory-friend-list-error">
              <Text style={[styles.emptyHint, { color: theme.destructive }]}>Couldn't load friends</Text>
              <TouchableOpacity
                onPress={() => { void load(); }}
                accessibilityRole="button"
                accessibilityLabel="Retry loading friends"
                testID="memory-friend-list-retry"
                style={[styles.retryButton, { borderColor: theme.borderStrong }]}
              >
                <Text style={[styles.retryText, { color: theme.primary }]}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : sources.length === 0 ? (
            <Text style={[styles.emptyHint, { color: theme.muted }]}>No shared places yet.</Text>
          ) : (
            <>
            <FlatList
              data={sources}
              keyExtractor={(f) => String(f.friend_id)}
              renderItem={({ item }) => {
                const friendId = Number(item.friend_id);
                const subscribed = isSubscribed(friendId);
                const unavailable = item.sharing_status === 'not_shared';
                const stateCopy: string | null = unavailable
                  ? 'Not shared with you'
                  : item.sharing_status === 'shared_empty'
                        ? 'No shared places yet'
                        : subscribed ? null : 'Shared with you';
                return (
                  <View>
                    <TouchableOpacity
                      style={[styles.row, subscribed && { backgroundColor: theme.surface }, unavailable && { opacity: 0.62 }]}
                      onPress={() => onTap(friendId, item.sharing_status)}
                      disabled={unavailable}
                      testID={`memory-friend-row-${item.friend_id}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ disabled: unavailable, checked: subscribed }}
                    >
                      <View style={styles.rowMain}>
                        <Text style={[styles.rowName, { color: theme.foreground }]}>{item.friend_name}</Text>
                        <View style={styles.rowStatusSlot} testID={`memory-friend-row-status-slot-${item.friend_id}`}>
                        {stateCopy ? (
                          <Text
                            style={[styles.rowEmail, { color: theme.foregroundSecondary }]}
                            testID={`memory-friend-row-status-${item.friend_id}`}
                          >
                            {stateCopy}
                          </Text>
                        ) : null}
                        </View>
                      </View>
                      <View style={styles.rowAccessory} testID={`memory-friend-row-accessory-${item.friend_id}`}>
                        {unavailable ? (
                          <Icon name="Lock" size={16} color={Colors.warning} strokeWidth={2.2} />
                        ) : (
                          <View style={[styles.checkbox, { borderColor: subscribed ? theme.primary : theme.borderStrong, backgroundColor: subscribed ? theme.primary : 'transparent' }]}>
                            {subscribed ? <Icon name="Check" size={14} color={theme.onPrimary} strokeWidth={2.5} /> : null}
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              }}
              ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: theme.border }]} />}
            />
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
  loadingBox: { paddingVertical: Spacing.xl, alignItems: 'center' },
  emptyHint: { textAlign: 'center', color: Colors.textMuted, paddingVertical: Spacing.xl },
  listError: { alignItems: 'center', paddingBottom: Spacing.lg },
  retryButton: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryText: { fontSize: FontSize.body, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.card,
  },
  rowActive: { backgroundColor: Colors.primaryBg },
  rowMain: { flex: 1, minWidth: 0 },
  rowName: { fontSize: FontSize.body, color: Colors.textPrimary, fontWeight: '600' },
  rowEmail: { fontSize: FontSize.caption, color: Colors.textSecondary, marginTop: 2 },
  rowStatusSlot: { minHeight: 18, justifyContent: 'center' },
  rowAccessory: { width: 32, minHeight: 44, marginLeft: Spacing.sm, alignItems: 'center', justifyContent: 'center' },
  addCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primaryBg,
    alignItems: 'center', justifyContent: 'center',
  },
  removeCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 7, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  sep: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },
});
