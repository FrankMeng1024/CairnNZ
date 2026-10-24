import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { FontSize, Radius, Shadow, Spacing } from './tokens';
import { useVisualTheme } from '../hooks/useVisualTheme';
import { cairnText } from '../i18n/runtime';

export type MapLoadState = 'loading' | 'slow' | 'error' | 'offline';

type Props = {
  state: MapLoadState;
  recordingContinues?: boolean;
  onRetry?: () => void;
  testID?: string;
  /** Suppress a warm-cache one-frame flash without delaying real readiness. */
  delayMs?: number;
};

const COPY: Record<MapLoadState, { title: string; body: string }> = {
  loading: {
    get title() { return cairnText('map-load-overlay.preparing-your-map'); },
    get body() { return cairnText('map-load-overlay.loading-the-first-view-for-this-place'); },
  },
  slow: {
    get title() { return cairnText('map-load-overlay.the-map-is-taking-longer'); },
    get body() { return cairnText('map-load-overlay.you-can-keep-using-cairn-while-the'); },
  },
  error: {
    get title() { return cairnText('map-load-overlay.map-unavailable'); },
    get body() { return cairnText('map-load-overlay.check-your-connection-then-try-loading-the'); },
  },
  offline: {
    get title() { return cairnText('map-load-overlay.map-offline'); },
    get body() { return cairnText('map-load-overlay.the-map-will-return-when-you-are'); },
  },
};

/**
 * Product-owned first-paint boundary for native maps. It deliberately stays
 * over the native canvas until Mapbox reports a rendered map; a style-loaded
 * callback or a timeout must never expose a white/empty globe as ready.
 */
export function MapLoadOverlay({ state, recordingContinues = false, onRetry, testID = 'map-load-overlay', delayMs = 0 }: Props) {
  const theme = useVisualTheme();
  const [visible, setVisible] = useState(delayMs <= 0);
  const copy = COPY[state];
  const showRetry = Boolean(onRetry) && (state === 'slow' || state === 'error');

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!visible) return null;

  return (
    <View
      testID={testID}
      accessibilityRole="summary"
      style={[styles.overlay, { backgroundColor: theme.background }]}
    >
      <View style={[styles.card, { backgroundColor: theme.surfaceElevated, borderColor: theme.border, shadowColor: theme.shadow }]}>
        <View style={[styles.iconWrap, { backgroundColor: theme.controlSelected }]}>
          {state === 'loading' || state === 'slow' ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : (
            <Icon name={state === 'offline' ? 'CloudOff' : 'Map'} size={22} color={theme.iconActive} strokeWidth={2} />
          )}
        </View>
        <Text style={[styles.title, { color: theme.foreground }]}>{copy.title}</Text>
        <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{cairnText('map-load-overlay.value-value', { body: copy.body, value2: recordingContinues ? cairnText('map-load-overlay.your-activity-is-still-being-recorded') : '' })}</Text>
        {showRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={cairnText('map-load-overlay.try-loading-the-map-again')}
            onPress={onRetry}
            style={({ pressed }) => [styles.retry, { backgroundColor: theme.primaryAction }, pressed && styles.pressed]}
          >
            <Icon name="RotateCcw" size={15} color={theme.onPrimary} strokeWidth={2.3} />
            <Text style={[styles.retryText, { color: theme.onPrimary }]}>{cairnText('map-load-overlay.try-again')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    zIndex: 30,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.cardLg,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    ...Shadow.card,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  title: { fontSize: FontSize.h3, fontWeight: '700', textAlign: 'center' },
  body: { marginTop: Spacing.xs, fontSize: FontSize.body, lineHeight: 21, textAlign: 'center' },
  retry: {
    minHeight: 44,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  retryText: { fontSize: FontSize.body, fontWeight: '700' },
  pressed: { opacity: 0.82, transform: [{ scale: 0.98 }] },
});
