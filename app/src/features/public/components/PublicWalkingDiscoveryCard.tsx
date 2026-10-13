import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Icon } from '../../../components/Icon';
import { Radius, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useAppStore } from '../../../store/useAppStore';
import { useCairnPresentationStore } from '../../cairns/cairnPresentationStore';

/**
 * Shared foreground discovery cue for Hike and Run. Acquisition is already
 * durable; this claims the one presentation surface and acknowledges only
 * the exact event watermark that reached a rendered frame.
 */
export function PublicWalkingDiscoveryCard({
  surface,
  safeTop,
  onOpen,
  blocked = false,
}: {
  surface: 'hike' | 'run';
  safeTop: number;
  onOpen: (markerId: string | null) => void;
  blocked?: boolean;
}) {
  const theme = useVisualTheme();
  const focused = useIsFocused();
  const viewerId = useAppStore(state => String(state.user?.id ?? ''));
  const storeViewerId = useCairnPresentationStore(state => state.viewerId);
  const pendingCount = useCairnPresentationStore(state => state.pendingGroups.length);
  const activeGroup = useCairnPresentationStore(state => state.activeGroup);
  const activeSurface = useCairnPresentationStore(state => state.activeSurface);
  const presentationBlocked = useCairnPresentationStore(state => state.presentationBlocked);

  React.useEffect(() => {
    const key = `${surface}:modal`;
    useCairnPresentationStore.getState().setPresentationBlock(key, blocked);
    return () => useCairnPresentationStore.getState().setPresentationBlock(key, false);
  }, [blocked, surface]);

  React.useEffect(() => {
    if (!focused || !viewerId) return undefined;
    const store = useCairnPresentationStore.getState();
    if (store.viewerId !== viewerId) void store.initialize(viewerId);
    else void store.refresh();
    return undefined;
  }, [focused, viewerId]);

  React.useEffect(() => {
    if (!focused || blocked || presentationBlocked || pendingCount === 0) return;
    useCairnPresentationStore.getState().claim(surface);
  }, [blocked, focused, pendingCount, presentationBlocked, surface, storeViewerId]);

  const visible = focused && !blocked && !presentationBlocked && activeSurface === surface ? activeGroup : null;
  React.useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      void useCairnPresentationStore.getState().acknowledgeActive(surface);
    }, 0);
    return () => clearTimeout(timer);
  }, [surface, visible?.eventThroughId, visible?.token]);

  React.useEffect(() => () => {
    useCairnPresentationStore.getState().release(surface);
  }, [surface]);

  if (!visible) return null;
  const count = visible.cairnCount;
  const updatedOnly = count === 1
    && visible.eventCount > 0
    && visible.updatedEventCount === visible.eventCount;
  return (
    <TouchableOpacity
      testID={`walking-discovery-group-${visible.token}`}
      style={[
        styles.card,
        {
          top: safeTop + 154,
          backgroundColor: theme.sheetSurface,
          borderColor: theme.borderStrong,
          shadowColor: theme.shadow,
        },
      ]}
      activeOpacity={0.9}
      onPress={() => onOpen(visible.singleMarkerId)}
      accessibilityRole="button"
      accessibilityLabel={`${count} ${count === 1 ? 'Cairn' : 'Cairns'} saved in Memory while recording`}
    >
      <View style={[styles.icon, { backgroundColor: theme.controlSelected }]}>
        <Icon name="MapPin" size={17} color={theme.primary} strokeWidth={2.2} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: theme.foregroundSecondary }]}>FOUND WHILE MOVING</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>
          {updatedOnly ? 'A Cairn story was updated'
            : count === 1 ? 'A Cairn is now in Memory' : `${count} Cairns are now in Memory`}
        </Text>
        <Text style={[styles.author, { color: theme.foregroundSecondary }]} numberOfLines={1}>
          Recording continues
        </Text>
      </View>
      <Icon name="ChevronRight" size={17} color={theme.iconInactive} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 24,
    minHeight: 72,
    borderRadius: Radius.card,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 1 },
  author: { fontSize: 12, lineHeight: 17, marginTop: 1 },
});
