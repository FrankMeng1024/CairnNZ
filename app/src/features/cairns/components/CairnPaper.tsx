import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Icon, type IconName } from '../../../components/Icon';
import { FontSize, RadiusRole, Shadow, Spacing } from '../../../components/tokens';
import { useVisualTheme } from '../../../hooks/useVisualTheme';
import { CAIRN_MOTION } from '../cairnExperience';

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      // `false` is already the initial state. Avoid a no-op async update,
      // which also keeps screen tests free of post-render act warnings.
      if (mounted && value) setReduced(true);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

export function CairnStoneMark({ size = 34, tone = 'owner' }: {
  size?: number;
  tone?: 'owner' | 'friends' | 'public' | 'neutral';
}) {
  const theme = useVisualTheme();
  const accent = tone === 'public'
    ? theme.cairnPublic
    : tone === 'friends'
      ? '#477C78'
      : tone === 'neutral' ? theme.iconInactive : theme.primary;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }} accessibilityElementsHidden>
      <View style={[styles.stone, { width: size * 0.68, height: size * 0.22, borderRadius: size, backgroundColor: accent, opacity: 0.92 }]} />
      <View style={[styles.stone, { width: size * 0.48, height: size * 0.19, borderRadius: size, backgroundColor: accent, opacity: 0.78 }]} />
      <View style={[styles.stone, { width: size * 0.27, height: size * 0.16, borderRadius: size, backgroundColor: accent, opacity: 0.64 }]} />
    </View>
  );
}

export function CairnPaper({
  children,
  style,
  animated = true,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  animated?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const theme = useVisualTheme();
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(animated && !reduced ? 0 : 1)).current;
  useEffect(() => {
    if (!animated || reduced) {
      progress.setValue(1);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: CAIRN_MOTION.openMs,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [animated, progress, reduced]);
  const transform = useMemo(() => ({
    opacity: progress,
    transform: [
      { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
      { scaleY: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  }), [progress]);
  return (
    <Animated.View
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.paper,
        {
          backgroundColor: theme.recordSurface,
          borderColor: theme.borderStrong,
          shadowColor: theme.shadow,
        },
        transform,
        style,
      ]}
    >
      <View style={[styles.foldUnder, { borderTopColor: theme.borderStrong }]} accessibilityElementsHidden />
      <View style={[styles.fold, { borderTopColor: theme.backgroundElevated }]} accessibilityElementsHidden />
      <View style={[styles.paperRule, { backgroundColor: theme.borderSubtle }]} accessibilityElementsHidden />
      {children}
    </Animated.View>
  );
}

export function CairnPlaceAnchor({
  title,
  detail,
  status,
  icon = 'MapPin',
  compact = false,
}: {
  title: string;
  detail: string;
  status?: string;
  icon?: IconName;
  compact?: boolean;
}) {
  const theme = useVisualTheme();
  return (
    <View
      style={[
        styles.place,
        compact && styles.placeCompact,
        { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle },
      ]}
    >
      <View style={[styles.placeIcon, { backgroundColor: theme.controlSelected }]}>
        <Icon name={icon} size={17} color={theme.iconActive} strokeWidth={2.1} />
      </View>
      <View style={styles.placeCopy}>
        <Text style={[styles.placeTitle, { color: theme.foreground }]} numberOfLines={1}>{title}</Text>
        <Text style={[styles.placeDetail, { color: theme.foregroundSecondary }]} numberOfLines={2}>{detail}</Text>
      </View>
      {status ? <Text style={[styles.placeStatus, { color: theme.primary }]}>{status}</Text> : null}
    </View>
  );
}

export function CairnStatusPill({ label, icon = 'Check', tone = 'primary' }: {
  label: string;
  icon?: IconName;
  tone?: 'primary' | 'muted' | 'public';
}) {
  const theme = useVisualTheme();
  const color = tone === 'public' ? theme.cairnPublic : tone === 'muted' ? theme.foregroundSecondary : theme.primary;
  return (
    <View style={[styles.pill, { backgroundColor: theme.surfaceSecondary, borderColor: theme.borderSubtle }]}>
      <Icon name={icon} size={12} color={color} strokeWidth={2.2} />
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: {
    position: 'relative',
    overflow: 'hidden',
    borderWidth: 1,
    borderRadius: RadiusRole.card,
    padding: Spacing.lg,
    ...Shadow.card,
  },
  foldUnder: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 22,
    borderTopWidth: 22,
    borderLeftColor: 'transparent',
    opacity: 0.32,
  },
  fold: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 0,
    height: 0,
    borderLeftWidth: 18,
    borderTopWidth: 18,
    borderLeftColor: 'transparent',
    opacity: 0.9,
  },
  paperRule: { position: 'absolute', left: 20, right: 20, top: 52, height: StyleSheet.hairlineWidth },
  stone: { marginTop: 1 },
  place: {
    minHeight: 76,
    borderWidth: 1,
    borderRadius: RadiusRole.card,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  placeCompact: { minHeight: 62, paddingVertical: Spacing.sm },
  placeIcon: { width: 36, height: 36, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  placeCopy: { flex: 1, minWidth: 0 },
  placeTitle: { fontSize: FontSize.caption, lineHeight: 18, fontWeight: '700' },
  placeDetail: { fontSize: FontSize.small, lineHeight: 16, marginTop: 2 },
  placeStatus: { fontSize: FontSize.small, fontWeight: '700' },
  pill: {
    minHeight: 28,
    paddingHorizontal: Spacing.sm,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  pillText: { fontSize: FontSize.small, fontWeight: '700' },
});
