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
 * dialog), we show a fifth screen "You can still use Cairn" with Open
 * Settings / Later actions. Choosing Later marks onboarding done — the user
 * has explicitly opted out of location. GPS-dependent features (Hiking,
 * Plant, Memory) will re-prompt when reached, per user note "GPS 不允许功能
 * 也没法用".
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, Animated, Easing,
  Image, Platform, Linking,
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

const STORAGE_KEY = 'cairn_onboarding_v1_done';

interface Props {
  visible: boolean;
  onFinish: () => void;
}

type Step = 1 | 2 | 3 | 4 | 'denied';

export function OnboardingModal({ visible, onFinish }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [locationGranted, setLocationGranted] = useState<boolean | null>(null);
  const fade = useRef(new Animated.Value(0)).current;

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

  const advance = () => {
    haptic.impact('light');
    setStep(prev => (prev === 1 ? 2 : prev === 2 ? 3 : prev === 3 ? 4 : prev));
  };

  const finish = async () => {
    try {
      await storage.setItem(STORAGE_KEY, 'true');
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

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent transparent={false}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <Animated.View style={[styles.inner, { opacity: fade }]}>
          {step === 1 && (
            <ScreenLayout
              icon={<CairnLogo size={64} />}
              title="Discover Cairn"
              body="Your quiet companion for the outdoors."
              cta="Get started"
              onCta={advance}
              stepIndex={0}
            />
          )}
          {step === 2 && (
            <ScreenLayout
              icon={<HikingIcon size={64} color={Colors.primary} />}
              title="Track every hike"
              body={"Cairn quietly records your route, distance, and elevation.\nNo chatter, no leaderboards."}
              cta="Next"
              onCta={advance}
              stepIndex={1}
            />
          )}
          {step === 3 && (
            <ScreenLayout
              icon={<FlagMarkerIcon size={64} stoneColor={Colors.flag} flagColor={Colors.primary} />}
              title="Leave a cairn"
              body={"Drop a small marker with a note.\nKeep it for yourself, or share with friends walking the same trail."}
              cta="Next"
              onCta={advance}
              stepIndex={2}
            />
          )}
          {step === 4 && (
            <ScreenLayout
              icon={<Icon name="Footprints" size={56} color={Colors.primary} strokeWidth={1.5} />}
              title="Uncover your map"
              body={"Every step reveals fog on your map.\nOver months, you build a personal atlas of where you have walked."}
              cta={locationGranted === true ? 'Done' : 'Enable Location'}
              ctaHint={locationGranted === true ? undefined : 'iOS will ask for permission next.'}
              onCta={requestLocation}
              stepIndex={3}
            />
          )}
          {step === 'denied' && (
            <ScreenLayout
              icon={<Icon name="MapPin" size={56} color={Colors.textMuted} strokeWidth={1.5} />}
              title="You can still use Cairn"
              body={"Without location, we can't record your hikes or reveal your map.\nWhen you're ready, turn on location in Settings."}
              cta="Open Settings"
              onCta={openSettings}
              secondaryCta="Later"
              onSecondary={finish}
            />
          )}
        </Animated.View>
      </SafeAreaView>
    </Modal>
  );
}

interface ScreenLayoutProps {
  icon: React.ReactNode;
  title: string;
  body: string;
  cta: string;
  ctaHint?: string;
  onCta: () => void;
  secondaryCta?: string;
  onSecondary?: () => void;
  stepIndex?: number;
}

function ScreenLayout({ icon, title, body, cta, ctaHint, onCta, secondaryCta, onSecondary, stepIndex }: ScreenLayoutProps) {
  return (
    <View style={styles.screen}>
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {stepIndex !== undefined && (
        <View style={styles.dots}>
          {[0, 1, 2, 3].map(i => (
            <View
              key={i}
              style={[styles.dot, i === stepIndex && styles.dotActive]}
            />
          ))}
        </View>
      )}
      <View style={styles.ctaWrap}>
        <TouchableOpacity
          style={styles.ctaBtn}
          onPress={onCta}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={cta}
        >
          <Text style={styles.ctaText}>{cta}</Text>
        </TouchableOpacity>
        {ctaHint && <Text style={styles.ctaHint}>{ctaHint}</Text>}
        {secondaryCta && onSecondary && (
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={onSecondary}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={secondaryCta}
          >
            <Text style={styles.secondaryText}>{secondaryCta}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

/** Check whether onboarding has already been completed for this install. */
export async function hasCompletedOnboarding(): Promise<boolean> {
  try {
    const value = await storage.getItem(STORAGE_KEY);
    return value === 'true';
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
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
  },
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
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
    marginBottom: Spacing.xl,
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
    position: 'absolute',
    bottom: Spacing.xl,
    left: Spacing.xl,
    right: Spacing.xl,
    alignItems: 'center',
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
    marginTop: Spacing.sm,
    fontSize: FontSize.small,
    color: Colors.textMuted,
    textAlign: 'center',
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
