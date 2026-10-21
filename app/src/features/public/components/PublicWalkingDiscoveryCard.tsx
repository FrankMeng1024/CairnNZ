import React from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Radius, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { useAppStore } from '../../../store/useAppStore';
import { useCairnPresentationStore } from '../../cairns/cairnPresentationStore';
import { CairnStoneMark, useReduceMotion } from '../../cairns/components/CairnPaper';
import { CAIRN_MOTION, CAIRN_TERMS } from '../../cairns/cairnExperience';
import { haptic } from '../../../services/hapticService';
import { resolveCairnPresentationDestinations } from '../../cairns/cairnPresentationNavigation';
import { scheduleVisibleFrame, useAppIsActive } from '../../../hooks/useAppIsActive';

const encounteredThisProcess = new Set<string>();

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
  verticalOffset = 154,
  safeBottom = 0,
  bottomOffset = 176,
}: {
  surface: 'hike' | 'run' | 'memory';
  safeTop: number;
  onOpen: (
    markerId: string | null,
    markerIds?: string[],
    revisionIdsByMarker?: Record<string, string>,
  ) => void;
  blocked?: boolean;
  verticalOffset?: number;
  safeBottom?: number;
  bottomOffset?: number;
}) {
  const theme = useVisualTheme();
  const focused = useIsFocused();
  const viewerId = useAppStore(state => String(state.user?.id ?? ''));
  const storeViewerId = useCairnPresentationStore(state => state.viewerId);
  const pendingCount = useCairnPresentationStore(state => state.pendingGroups.length);
  const activeGroup = useCairnPresentationStore(state => state.activeGroup);
  const activeGroupMembers = useCairnPresentationStore(state => state.activeGroupMembers);
  const activeSurface = useCairnPresentationStore(state => state.activeSurface);
  const activePrincipalAttention = useCairnPresentationStore(state => state.activePrincipalAttention);
  const presentationBlocked = useCairnPresentationStore(state => state.presentationBlocked);
  const reduceMotion = useReduceMotion();
  const appIsActive = useAppIsActive();
  const reveal = React.useRef(new Animated.Value(0)).current;
  const [opening, setOpening] = React.useState(false);
  const [openError, setOpenError] = React.useState(false);

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
    if (!focused || !appIsActive || blocked || presentationBlocked || pendingCount === 0) {
      if (!appIsActive) useCairnPresentationStore.getState().release(surface);
      return;
    }
    useCairnPresentationStore.getState().claim(surface);
  }, [appIsActive, blocked, focused, pendingCount, presentationBlocked, surface, storeViewerId]);

  const visible = focused && appIsActive && !blocked && !presentationBlocked && activeSurface === surface ? activeGroup : null;
  React.useEffect(() => {
    if (!visible) return undefined;
    const presentationKey = `${viewerId}:${visible.token}`;
    reveal.stopAnimation();
    reveal.setValue(activePrincipalAttention && !reduceMotion ? 0 : 1);
    if (activePrincipalAttention) {
      Animated.timing(reveal, {
        toValue: 1,
        duration: reduceMotion ? CAIRN_MOTION.reducedMs : CAIRN_MOTION.encounterMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
    if (activePrincipalAttention && !encounteredThisProcess.has(presentationKey)) {
      encounteredThisProcess.add(presentationKey);
      haptic.notification('success');
    }
    const cancelFrame = scheduleVisibleFrame(() => {
      void useCairnPresentationStore.getState().markActiveDisplayed(surface).then(displayed => {
        if (displayed) void useCairnPresentationStore.getState().acknowledgeActive(surface);
      });
    });
    return () => {
      cancelFrame();
      reveal.stopAnimation();
    };
  }, [activePrincipalAttention, reduceMotion, reveal, surface, viewerId, visible?.eventThroughId, visible?.token]);

  React.useEffect(() => () => {
    useCairnPresentationStore.getState().release(surface);
  }, [surface]);

  if (!visible) return null;
  const count = visible.cairnCount;
  const updatedOnly = count === 1
    && visible.eventCount > 0
    && visible.updatedEventCount === visible.eventCount;
  const provenanceLabel = visible.sourceAudience === 'friends'
    ? 'FRIENDS CAIRN · ENCOUNTERED HERE'
    : visible.sourceAudience === 'public'
      ? 'PUBLIC CAIRN · ENCOUNTERED HERE'
      : visible.sourceAudience === 'mixed'
        ? 'FRIENDS + PUBLIC · ENCOUNTERED HERE'
        : 'CAIRN · ENCOUNTERED HERE';
  return (
    <Animated.View
      testID={`walking-discovery-group-${visible.token}`}
      style={[
        styles.card,
        {
          top: surface === 'memory' ? undefined : safeTop + verticalOffset,
          bottom: surface === 'memory' ? safeBottom + bottomOffset : undefined,
          backgroundColor: theme.sheetSurface,
          borderColor: theme.borderStrong,
          shadowColor: theme.shadow,
          opacity: reveal,
          transform: [
            { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) },
            { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLabel={`${count} ${count === 1 ? 'Cairn' : 'Cairns'} found and saved in Memory`}
    >
      <View style={[styles.icon, { backgroundColor: theme.controlSelected }]}>
        {visible.sourceAudience === 'mixed' ? (
          <View style={styles.mixedMark}>
            <CairnStoneMark size={21} tone="friends" />
            <CairnStoneMark size={21} tone="public" />
          </View>
        ) : (
          <CairnStoneMark
            size={31}
            tone={visible.sourceAudience === 'public' ? 'public' : visible.sourceAudience === 'friends' ? 'friends' : 'neutral'}
          />
        )}
      </View>
      <View style={styles.copy}>
        <Text style={[styles.eyebrow, { color: theme.foregroundSecondary }]}>{provenanceLabel}</Text>
        <Text style={[styles.title, { color: theme.foreground }]}>
          {updatedOnly ? 'A familiar Cairn has new words'
            : count === 1 ? CAIRN_TERMS.encounterTitle : `${count} notes were waiting here`}
        </Text>
        <Text style={[styles.author, { color: theme.foregroundSecondary }]} numberOfLines={1}>
          Saved in Memory{surface === 'hike' || surface === 'run' ? ' · Recording continues' : ''}
        </Text>
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.openAction, { backgroundColor: theme.primary }]}
            disabled={opening}
            onPress={() => {
              if (opening) return;
              const requestedViewer = viewerId;
              const requestedToken = visible.token;
              const groupIds = activeGroupMembers.map(member => member.id);
              setOpening(true);
              setOpenError(false);
              void resolveCairnPresentationDestinations(
                requestedViewer,
                groupIds,
                { requireExactRevision: true },
              ).then(destinations => {
                const current = useCairnPresentationStore.getState();
                if (String(useAppStore.getState().user?.id ?? '') !== requestedViewer
                  || current.activeSurface !== surface
                  || current.activeGroup?.token !== requestedToken) return;
                const markerIds = [...new Set(destinations.map(item => item.markerId))];
                const revisionIdsByMarker = Object.fromEntries(
                  destinations.map(item => [item.markerId, item.revisionId]),
                );
                current.release(surface);
                onOpen(
                  markerIds.length === 1 ? markerIds[0] : null,
                  markerIds.length === 1 ? undefined : markerIds,
                  revisionIdsByMarker,
                );
              }).catch(() => {
                if (String(useAppStore.getState().user?.id ?? '') === requestedViewer) setOpenError(true);
              }).finally(() => {
                if (String(useAppStore.getState().user?.id ?? '') === requestedViewer) setOpening(false);
              });
            }}
            accessibilityRole="button"
            accessibilityState={{ busy: opening, disabled: opening }}
            accessibilityLabel={count === 1 ? 'Open found Cairn' : 'Open found Cairns'}
          >
            <Text style={[styles.openText, { color: theme.onPrimary }]}>{opening ? 'Opening…' : openError ? 'Retry' : 'Open'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.laterAction}
            onPress={() => useCairnPresentationStore.getState().release(surface)}
            accessibilityRole="button"
          >
            <Text style={[styles.laterText, { color: theme.foregroundSecondary }]}>Later</Text>
          </TouchableOpacity>
        </View>
        {openError ? <Text accessibilityLiveRegion="polite" style={[styles.openError, { color: theme.destructive }]}>Could not open this exact group. It is still here; try again.</Text> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 24,
    minHeight: 104,
    borderRadius: Radius.card,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    ...Shadow.card,
  },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  mixedMark: { flexDirection: 'row', alignItems: 'flex-end', marginHorizontal: -3 },
  copy: { flex: 1 },
  eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '700', marginTop: 1 },
  author: { fontSize: 12, lineHeight: 17, marginTop: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  openAction: { minHeight: 44, minWidth: 84, borderRadius: 22, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  openText: { fontSize: 12, fontWeight: '700' },
  laterAction: { minHeight: 44, minWidth: 68, alignItems: 'center', justifyContent: 'center' },
  laterText: { fontSize: 12, fontWeight: '700' },
  openError: { fontSize: 11, lineHeight: 15, marginTop: Spacing.xs },
});
