/**
 * OnboardingModal — 4-screen first-run introduction to Cairn.
 *
 * Batch 6.0 (v0.2.6): shown once per install after user is authenticated.
 * The 4 screens introduce the core concepts:
 *   1. Discover — brand tagline
 *   2. Hiking — track every hike
 *   3. Cairns — leave a marker
 *   4. Memory — fog-of-war + Enable Location CTA
 *
 * Screen 4 CTA triggers the iOS foreground location permission dialog. This
 * follows Apple's HIG "pre-permission priming" pattern — user has read a
 * concrete explanation (Memory reveals your explored area) and made an
 * explicit choice before the system dialog appears.
 *
 * Persistence: `cairn_onboarding_v1_done` = 'true' in AsyncStorage. Version
 * prefix `v1` allows a future major re-onboarding without conflating with
 * copy tweaks. Bump only for structural changes (new screens, new key
 * concepts), never for typo fixes.
 *
 * Legacy users (installed before this OTA) will see the full 4 screens once
 * per user note: "都完整看 4 屏, 我要自己测". If GPS is already granted,
 * Screen 4 CTA reads "Done" instead of "Enable Location".
 *
 * Mount gate: RootNavigator mounts <OnboardingModal /> only when all of the
 * following are true (avoids race with hydrate / deep link cold-start):
 *   - user is authenticated (useAppStore.isLoggedIn)
 *   - stores have completed initial hydrate
 *   - no pending deep link intent
 *   - `cairn_onboarding_v1_done` is not 'true'
 *
 * Denied-permission path: if the user rejects Screen 4 CTA (or system
 * dialog), we show a fifth screen "You can still use Cairn" with Continue
 * (primary — finishes onboarding, user proceeds to Home) and Open Settings
 * (secondary). Per user feedback: "GPS 拒了不要死胡同". GPS-dependent
 * features (Hiking, Plant, Memory) will re-prompt when reached.
 *
 * Swipe navigation (2026-08-05): the 4 intro screens are horizontally
 * pageable via FlatList (pagingEnabled). Users can swipe left/right, tap
 * the CTA arrow, or tap a dot to jump. Screen 4 is the last swipeable
 * page — swiping further has no effect. `denied` remains a separate branch
 * outside the FlatList, reached only via Screen 4 CTA rejection.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
  Image, Platform, Linking, FlatList, Dimensions,
  NativeSyntheticEvent, NativeScrollEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors, Spacing, Radius, FontSize, Shadow, IconSize } from '../../components/tokens';
import { Icon } from '../../components/Icon';
import { CairnLogo } from '../../components/ActivityIcons/CairnLogo';
import { FlagMarkerIcon } from '../../components/ActivityIcons/FlagMarkerIcon';
import { HikingIcon } from '../../components/ActivityIcons/HikingIcon';
import { storage } from '../../store/storage';
import { haptic } from '../../services/hapticService';
import { useAppStore } from '../../store/useAppStore';
import { useVisualTheme } from '../../hooks/useVisualTheme';

const LEGACY_STORAGE_KEY = 'cairn_onboarding_v1_done';

/** R114 (2026-08-07): per-account key. User reported that uninstall+reinstall
 *  re-triggered onboarding because AsyncStorage was cleared on uninstall.
 *  Onboarding should be tied to the account, not the device. Per-user key
 *  ensures the same person on a new device / after reinstall doesn't see
 *  onboarding again. Legacy key (device-level) is migrated at first read. */
function storageKey(userId: string | number | null | undefined): string {
  if (userId === null || userId === undefined || userId === '') {
    // Fallback for pre-login checks — should be very rare because
    // RootNavigator only calls hasCompletedOnboarding after isLoggedIn.
    return LEGACY_STORAGE_KEY;
  }
  return `cairn_onboarding_v1_done_${userId}`;
}

interface Props {
  visible: boolean;
  onFinish: () => void;
}

type Step = 1 | 2 | 3 | 4 | 'denied';

interface IntroScreen {
  key: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}

export function OnboardingModal({ visible, onFinish }: Props) {
  const theme = useVisualTheme();
  const [step, setStep] = useState<Step>(1);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const listRef = useRef<FlatList<IntroScreen>>(null);
  const screenWidth = Dimensions.get('window').width;

  useEffect(() => {
    if (visible) {
      Animated.timing(fade, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      // Pre-check permission so Screen 4 CTA can say "Done" if already granted.
      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          setLocationGranted(perm.status === 'granted');
        } catch { /* best-effort */ }
      })();
    } else {
      fade.setValue(0);
      setStep(1);
    }
  }, [visible]);

  const scrollToIndex = (index: number) => {
    listRef.current?.scrollToIndex({ index, animated: true });
  };

  const advance = () => {
    haptic.impact('light');
    if (step === 1 || step === 2 || step === 3) {
      const next = (step + 1) as Step;
      setStep(next);
      // step values 1..4 map to indices 0..3
      scrollToIndex((next as number) - 1);
    }
  };

  const jumpTo = (targetStep: 1 | 2 | 3 | 4) => {
    haptic.impact('light');
    setStep(targetStep);
    scrollToIndex(targetStep - 1);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    const clamped = Math.max(0, Math.min(3, idx));
    const nextStep = (clamped + 1) as 1 | 2 | 3 | 4;
    if (nextStep !== step) {
      setStep(nextStep);
      haptic.impact('light');
    }
  };

  const finish = async () => {
    try {
      // R114: per-account local key. Always written first so the local
      // gate never blocks the user even if the server call fails.
      const uid = useAppStore.getState().user?.id;
      await storage.setItem(storageKey(uid), 'true');
    } catch { /* best-effort */ }
    // R114/O22 STORY-73006 (H2): also mark server-side so the flag
    // follows the account across devices and reinstalls. Fire and forget —
    // failure is non-fatal because the local key covers this device.
    // Server backfills as source of truth on next hydrate.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { patchOnboardingDone } = require('../../services/authService');
      void patchOnboardingDone();
    } catch { /* best-effort */ }
    onFinish();
  };

  const requestLocation = async () => {
    haptic.impact('light');
    // If already granted (legacy user path), just finish.
    if (locationGranted === true) {
      await finish();
      return;
    }
    try {
      const result = await Location.requestForegroundPermissionsAsync();
      if (result.status === 'granted') {
        setLocationGranted(true);
        await finish();
      } else {
        setStep('denied');
      }
    } catch {
      // Fall back to denied screen — user can Open Settings.
      setStep('denied');
    }
  };

  const openSettings = () => {
    Linking.openSettings().catch(() => { /* best-effort */ });
    // Whether or not settings opened, mark onboarding done. Feature-level
    // re-prompts (Hiking / Plant / Memory) will handle GPS from here.
    void finish();
  };

  if (!visible) return null;

  const screens: IntroScreen[] = [
    {
      key: 'discover',
      icon: <CairnLogo size={64} />,
      title: 'Discover Cairn',
      body: 'A cairn is a stack of stones — a trail marker left by hikers for those who come after. This app is your quiet companion for the outdoors.',
    },
    {
      key: 'hiking',
      icon: <HikingIcon size={64} color={theme.iconActive} />,
      title: 'Track every hike',
      body: 'Cairn quietly records your route, distance, and elevation.\nNo chatter, no leaderboards.',
    },
    {
      key: 'cairns',
      icon: <FlagMarkerIcon size={64} stoneColor={Colors.flag} flagColor={theme.iconActive} />,
      title: 'Leave a cairn',
      body: 'Drop a small marker with a note.\nKeep it for yourself, or share with friends walking the same trail.',
    },
    {
      key: 'memory',
      icon: <Icon name="Footprints" size={56} color={theme.iconActive} strokeWidth={1.5} />,
      title: 'Uncover your map',
      body: 'Every step reveals fog on your map.\nOver months, you build a personal atlas of where you have walked.',
    },
  ];

  const stepIndex = step === 'denied' ? 3 : step - 1;
  const isLastIntro = step === 4;

  return (
    <Modal visible={visible} animationType="slide" statusBarTranslucent transparent={false}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <Animated.View style={[styles.inner, { opacity: fade }]}>
          {step !== 'denied' && (
            <View style={styles.pagerWrap}>
              <FlatList
                ref={listRef}
                data={screens}
                keyExtractor={(item) => item.key}
                horizontal
                pagingEnabled
                showsHorizontalScrollIndicator={false}
                onMomentumScrollEnd={onMomentumScrollEnd}
                initialScrollIndex={0}
                getItemLayout={(_, index) => ({
                  length: screenWidth,
                  offset: screenWidth * index,
                  index,
                })}
                bounces={false}
                renderItem={({ item }) => (
                  <View style={[styles.page, { width: screenWidth }]}>
                    <View style={styles.iconWrap}>{item.icon}</View>
                    <Text style={[styles.title, { color: theme.foreground }]}>{item.title}</Text>
                    <Text style={[styles.body, { color: theme.foregroundSecondary }]}>{item.body}</Text>
                  </View>
                )}
              />
              <View style={styles.dots}>
                {[0, 1, 2, 3].map(i => (
                  <TouchableOpacity
                    key={i}
                    onPress={() => jumpTo((i + 1) as 1 | 2 | 3 | 4)}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`Go to screen ${i + 1}`}
                    hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
                  >
                    <View
                      style={[styles.dot, { backgroundColor: i === stepIndex ? theme.primary : theme.border }]}
                    />
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.ctaWrap}>
                <TouchableOpacity
                  style={[styles.ctaBtn, { backgroundColor: theme.primary }]}
                  onPress={isLastIntro ? requestLocation : advance}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={isLastIntro ? (locationGranted === true ? 'Done' : 'Enable Location') : 'Continue'}
                >
                  <Text style={[styles.ctaText, { color: theme.onPrimary }]}>
                    {isLastIntro ? (locationGranted === true ? 'Done' : 'Enable Location') : 'Continue'}
                  </Text>
                </TouchableOpacity>
                {/* R114 (2026-08-07): reserved-space hint slot. User reported
                    the Enable Location button on screen 4 sits higher than
                    the Continue button on screens 1-3 because screen 4
                    appended a hint line under the button, growing ctaWrap.
                    Fix: give the hint a fixed slot height so button y is
                    identical across all four intro screens. Text is only
                    rendered on last intro when permission is not yet
                    granted; the slot is always reserved. */}
                <View style={styles.ctaHintSlot}>
                  {isLastIntro && locationGranted !== true ? (
                    <Text style={[styles.ctaHint, { color: theme.muted }]}>iOS will ask for permission next.</Text>
                  ) : null}
                </View>
              </View>
            </View>
          )}
          {step === 'denied' && (
            <View style={styles.screen}>
              <View style={styles.iconWrap}>
                <Icon name="MapPin" size={56} color={theme.iconInactive} strokeWidth={1.5} />
              </View>
              <Text style={[styles.title, { color: theme.foreground }]}>You can still use Cairn</Text>
              <Text style={[styles.body, { color: theme.foregroundSecondary }]}>
                {"Without location, we can't record your hikes or reveal your map.\nYou can turn on location later in Settings."}
              </Text>
              <View style={styles.ctaWrap}>
                <TouchableOpacity
                  style={[styles.ctaBtn, { backgroundColor: theme.primary }]}
                  onPress={finish}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Continue"
                >
                  <Text style={[styles.ctaText, { color: theme.onPrimary }]}>Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={openSettings}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings"
                >
                  <Text style={[styles.secondaryText, { color: theme.foregroundSecondary }]}>Open Settings</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

/** R114 (2026-08-07): per-account check. Pass the current user's id — the
 *  onboarding-done flag is stored per user so reinstall / new-device / new
 *  account no longer skips onboarding for a different person. A legacy
 *  device-level key from earlier OTAs is honored ONCE per user as a
 *  migration convenience: if the user has the legacy flag set and no
 *  per-account flag, we migrate on read and mark the per-account key so
 *  the same user won't see onboarding again. */
export async function hasCompletedOnboarding(
  userId: string | number | null | undefined,
): Promise<boolean> {
  try {
    // R114/O22 STORY-73006 (H2): server user.onboardingDoneAt is source
    // of truth. If backend has flagged this user done, cache locally and
    // return true immediately. This handles the cross-device / reinstall
    // case: same account on a new device sees onboarding as done.
    try {
      const user = useAppStore.getState().user as { onboardingDoneAt?: string | null } | null;
      if (user && user.onboardingDoneAt) {
        try { await storage.setItem(storageKey(userId), 'true'); } catch { /* best-effort */ }
        return true;
      }
    } catch { /* fall through */ }
    // Prefer per-account key.
    const perAcct = await storage.getItem(storageKey(userId));
    if (perAcct === 'true') return true;
    // Legacy migration: if the previous install marked done at device
    // level, treat as done for this user AND write the per-account key
    // so we never rely on the legacy key again.
    const legacy = await storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy === 'true' && userId !== null && userId !== undefined && userId !== '') {
      try { await storage.setItem(storageKey(userId), 'true'); } catch { /* best-effort */ }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  inner: {
    flex: 1,
    paddingBottom: Spacing.xl,
  },
  pagerWrap: {
    flex: 1,
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl + Spacing.md,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl + Spacing.md,
  },
  iconWrap: {
    marginBottom: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: FontSize.h1,
    fontWeight: '800',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: Spacing.md,
    letterSpacing: -0.4,
  },
  body: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: Spacing.xl,
    maxWidth: 320,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    marginBottom: Spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.border,
  },
  dotActive: {
    backgroundColor: Colors.primary,
    width: 24,
  },
  ctaWrap: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  ctaBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: Radius.button,
    alignItems: 'center',
    minWidth: 240,
    ...Shadow.fab,
  },
  ctaText: {
    color: '#fff',
    fontSize: FontSize.body,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  ctaHint: {
    fontSize: FontSize.small,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  ctaHintSlot: {
    // R114: reserved fixed height so button y-position is identical across
    // all 4 intro screens regardless of whether the hint text is rendered.
    // Value = ctaHint fontSize (11) + line-height buffer (~4) + top margin
    // matching the pre-R114 marginTop: Spacing.sm (8) = 24pt total.
    height: 24,
    marginTop: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  secondaryBtn: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  secondaryText: {
    fontSize: FontSize.body,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
});
