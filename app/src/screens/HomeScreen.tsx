/**
 * HomeScreen — Sprint 41 full-screen layout
 *
 * Layout: flex column, no ScrollView, fills SafeArea exactly.
 * Hierarchy: Header → Stats? → Recent? → Activity Cards (dominant) → Tools row
 * Design: Golden ratio φ=1.618 applied to card proportions and spacing.
 */
import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Animated, useWindowDimensions, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../components/tokens';
import { Icon, type IconName } from '../components/Icon';
import { HikingIcon, RunningIcon, FlagMarkerIcon, CairnLogo } from '../components/ActivityIcons';
// O12: useAppStore import removed — uiMode was the only consumer.
import { useSessionStore } from '../store/useSessionStore';
import { useMarkerStore } from '../store/useMarkerStore';
import { useTrackingStore } from '../store/useTrackingStore';
import { formatDuration, getRelativeTime } from '../utils/geo';
import { useDistance } from '../utils/distanceFormat';
import { getCurrentRegion } from '../config/regions';
import { OtaBadge } from '../components/OtaBadge';
// v412: UnfinishedSessionBanner 已被 v412 UnfinishedRecoveryModal 取代 (HikingScreen 内)

type Nav = NativeStackNavigationProp<RootStackParamList>;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function getGreeting() {
  const h = new Date().getHours();
  // O12: uiMode removed — greeting no longer branches on Explorer/Navigator.
  // PRD3 E-014: occasional Te Reo touch — Kia ora as morning variant
  // (registered translator review pending — Kia ora is a well-established greeting)
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  return 'Good evening';
}

// ── Recent / Live activity row ───────────────────────────────────────────
// Single row that occupies one fixed slot on the home dashboard.
//   • If a hike/run is actively recording → show "Hiking in progress" with
//     live distance + duration, tap → resume the in-progress screen.
//     Replaces (does NOT stack on top of) the most-recent-activity row,
//     so the user sees one row in one position no matter the state.
//   • Else if the most recent activity was within 24h → show it.
//   • Else render nothing.
// This unification fixes the "stacked Resume + Last activity" duplication
// reported on V8.
function RecentRow({ onPress }: { onPress: (id: string) => void }) {
  const sessions = useSessionStore(s => s.sessions);
  const status = useTrackingStore(s => s.status);
  const liveActivityMode = useTrackingStore(s => s.activityMode);
  const liveDistanceM = useTrackingStore(s => s.distanceM);
  const liveDurationS = useTrackingStore(s => s.durationS);
  const nav = useNavigation<Nav>();
  const pulse = useRef(new Animated.Value(1)).current;
  // O12: user Units preference (metric/imperial).
  const dist = useDistance();

  // Pulse the dot when live so the row visually communicates "this is
  // moving right now" rather than feeling identical to a stale entry.
  useEffect(() => {
    if (status !== 'tracking') {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.4, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status]);

  // ── Live mode ──
  // v450: only show "in progress" when there's actual tracked content.
  // Previously, opening Hiking → tapping Start → tapping Back to Home
  // would leave status='tracking' with 0 points and show a confusing
  // "Hiking in progress · Resume" row with no info. Now: require at
  // least some distance or duration before advertising an ongoing hike.
  if (status === 'tracking' && (liveDistanceM > 0 || liveDurationS > 5)) {
    const isRun = liveActivityMode === 'running';
    const accent = isRun ? Colors.running : Colors.primary;
    const bg = isRun ? Colors.runningLight : Colors.primaryLight;
    const label = isRun ? 'Running' : 'Hiking';
    const target = isRun ? 'Running' : 'Hiking';
    return (
      <TouchableOpacity
        style={recentStyles.row}
        onPress={() => nav.navigate(target as any)}
        activeOpacity={0.85}
      >
        <Animated.View
          style={[recentStyles.dot, { backgroundColor: bg, transform: [{ scale: pulse }] }]}
        >
          {isRun
            ? <RunningIcon size={14} color={accent} />
            : <HikingIcon size={14} color={accent} />
          }
        </Animated.View>
        <View style={recentStyles.textGroup}>
          <Text style={[recentStyles.badge, { color: accent }]}>{label} in progress</Text>
          <Text style={recentStyles.stat}>
            {`${dist.format(liveDistanceM, 2)} ${dist.unit} · ${formatDuration(liveDurationS)}`}
          </Text>
        </View>
        <Text style={[recentStyles.when, { color: accent, fontWeight: '700' }]}>Resume</Text>
        <Icon name="ChevronRight" size={14} color={accent} strokeWidth={2.5} />
      </TouchableOpacity>
    );
  }

  // ── Last activity mode (only within 24h) ──
  // v413 UX fix (Bug A): filter out zombie sessions (name=undefined + distance=0 + duration=0).
  // 这些是 offline pending 从未 drain 成功的残余 (case-6 test data 之类).
  // 显示"Hike 00:00 · Nh ago"对用户是无信息噪音, 应该隐藏直到真数据.
  const validSessions = sessions.filter((s) =>
    (s.distanceM > 0 || s.durationS > 0) && s.startedAt
  );
  if (validSessions.length === 0) return null;
  const last = validSessions.reduce((best, s) => s.startedAt > best.startedAt ? s : best);
  const ageMs = Date.now() - last.startedAt;
  if (ageMs > 24 * 60 * 60 * 1000) return null;

  const isRun = last.activityMode === 'running';
  const accent = isRun ? Colors.running : Colors.primary;
  const bg = isRun ? Colors.runningLight : Colors.primaryLight;
  const label = isRun ? 'Run' : 'Hike';
  const stat = last.distanceM > 10
    ? `${dist.format(last.distanceM, 1)} ${dist.unit}`
    : formatDuration(last.durationS);
  const when = getRelativeTime(last.startedAt);

  return (
    <TouchableOpacity style={recentStyles.row} onPress={() => onPress(last.id)} activeOpacity={0.7}>
      <View style={[recentStyles.dot, { backgroundColor: bg }]}>
        {isRun
          ? <RunningIcon size={14} color={accent} />
          : <HikingIcon size={14} color={accent} />
        }
      </View>
      <View style={recentStyles.textGroup}>
        <Text style={[recentStyles.badge, { color: accent }]}>{label}</Text>
        <Text style={recentStyles.stat}>{stat}</Text>
      </View>
      <Text style={recentStyles.when}>{when}</Text>
      <Icon name="ChevronRight" size={14} color={Colors.textMuted} strokeWidth={2} />
    </TouchableOpacity>
  );
}

// ── Big activity card — flex-based, no parent height dependency ──────────────
function ActivityCard({
  icon, title, subtitle, accentColor, lightBg, cardBg, onPress, anim, flex = 1,
}: {
  icon: (size: number) => React.ReactNode;
  title: string;
  subtitle: string;
  accentColor: string;
  lightBg: string;
  cardBg: string;
  onPress: () => void;
  anim: Animated.Value;
  flex?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const { width: screenW } = useWindowDimensions();
  const panelW = Math.min(Math.round(screenW * 0.32), 130);
  const iconSize = Math.round(panelW * 0.55);

  return (
    <Animated.View style={{ flex, opacity: anim, transform: [{ scale }] }}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 200, friction: 10 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }).start()}
        style={[cardStyles.card, { backgroundColor: cardBg, flex: 1 }]}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      >
        {/* Left panel */}
        <View style={[cardStyles.leftPanel, { width: panelW, backgroundColor: lightBg }]}>
          {icon(iconSize)}
        </View>

        {/* Text area */}
        <View style={[cardStyles.innerRow, { marginLeft: panelW }]}>
          <View style={cardStyles.textCol}>
            <Text style={[cardStyles.title, { color: Colors.textPrimary }]}>{title}</Text>
            <Text style={cardStyles.subtitle}>{subtitle}</Text>
            <View style={[cardStyles.accentLine, { backgroundColor: accentColor }]} />
          </View>
          <View style={[cardStyles.chevron, { backgroundColor: lightBg }]}>
            <Icon name="ChevronRight" size={16} color={accentColor} strokeWidth={2.5} />
          </View>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Tool button ───────────────────────────────────────────────────────────────
function ToolBtn({ iconName, label, onPress }: { iconName: IconName; label: string; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <TouchableOpacity
        style={toolStyles.btn}
        onPress={onPress}
        activeOpacity={1}
        onPressIn={() => Animated.spring(scale, { toValue: 0.93, useNativeDriver: true, tension: 300, friction: 10 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300, friction: 8 }).start()}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <View style={toolStyles.iconWrap}>
          <Icon name={iconName} size={20} color={Colors.primary} strokeWidth={1.8} />
        </View>
        <Text style={toolStyles.label} numberOfLines={1}>{label}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function HomeScreen() {
  // v302 boot diag: probe first thing in render — if app dies after
  // navigation_container_ready but no home_screen_render_start, mount is dying
  // in react-navigation transition, not user code.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('home_screen_render_start');
  } catch {/* ignore */}
  const nav = useNavigation<Nav>();
  // O12: uiMode removed
  const sessions = useSessionStore(s => s.sessions);
  const allMarkers = useMarkerStore(s => s.markers);
  // v320: beacon after selectors read — confirms zustand subscriptions
  // worked without throw. Heavy computation goes here (filter/sort/derive).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('home_after_selectors', {
      sessions_n: sessions.length,
      markers_n: allMarkers.length,
    });
  } catch {/* ignore */}
  const region = getCurrentRegion();
  // O17 P-RENDER-05: memoize marker count so HomeScreen doesn't recompute
  // the .filter().length on every unrelated re-render (allMarkers is stable
  // between hikes; region.code changes rarely).
  const markerCount = React.useMemo(
    () => allMarkers.filter(m => m.regionCode === region.code).length,
    [allMarkers, region.code],
  );
  // O18 HOME-04: period filter for stats (week/month/year/all).
  const [statsPeriod, setStatsPeriod] = useState<'week' | 'month' | 'year' | 'all'>('all');
  const periodSessionCount = React.useMemo(() => {
    if (statsPeriod === 'all') return sessions.length;
    const now = Date.now();
    const cutoff = now - (statsPeriod === 'week' ? 7 : statsPeriod === 'month' ? 30 : 365) * 86400000;
    return sessions.filter(s => (s.startedAt ?? 0) >= cutoff).length;
  }, [sessions, statsPeriod]);
  const hasData = sessions.length > 0 || markerCount > 0;
  const hasRecent = sessions.length > 0;

  const opacity = useRef(new Animated.Value(1)).current;
  const card1 = useRef(new Animated.Value(1)).current;
  const card2 = useRef(new Animated.Value(1)).current;
  const insets = useSafeAreaInsets();

  // v354 fix: OTA-reload-first-signin tab-jump root cause.
  // iOS doesn't guarantee window.safeAreaInsets is final at JS-init
  // time after OTA reloadAsync. SafeAreaProvider's initialMetrics
  // may seed insets.bottom = 0 → first frame paddingBottom is wrong
  // → tabs visually clipped under home indicator → onInsetsChange
  // fires one layout pass later → tabs visibly jump up.
  // Fix: defer first render until insets.bottom has been measured
  // (or 250ms timeout fallback). User sees splash background for
  // up to one extra frame instead of jumping tabs. Pure JS, OTA.
  const [insetsReady, setInsetsReady] = useState(
    () => Platform.OS !== 'ios' || insets.bottom > 0,
  );
  useEffect(() => {
    if (insetsReady) return;
    if (insets.bottom > 0) {
      setInsetsReady(true);
      return;
    }
    // Fallback: paint after 250ms even if insets still 0 (iPhone SE
    // or other no-home-indicator devices where insets.bottom is
    // legitimately 0).
    const t = setTimeout(() => setInsetsReady(true), 250);
    return () => clearTimeout(t);
  }, [insets.bottom, insetsReady]);

  // v320: beacon right before JSX return — if app dies between selectors
  // and JSX render, we'll see home_after_selectors but no home_before_jsx.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../services/bootDiagnostics').markBootPhase('home_before_jsx');
  } catch {/* ignore */}

  // v320: schedule alive heartbeats — if these fire, JS thread survived.
  // If 500ms fires but 2000ms doesn't, we know death was between.
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../services/bootDiagnostics').markBootPhase('home_mounted_useEffect');
    } catch {/* ignore */}
    const t500 = setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('home_alive_500ms');
      } catch {/* ignore */}
    }, 500);
    const t2000 = setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('home_alive_2000ms');
      } catch {/* ignore */}
    }, 2000);
    const t5000 = setTimeout(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../services/bootDiagnostics').markBootPhase('home_alive_5000ms');
      } catch {/* ignore */}
    }, 5000);
    return () => {
      clearTimeout(t500);
      clearTimeout(t2000);
      clearTimeout(t5000);
    };
  }, []);

  // v324: unified GPS permission request on Home mount.
  // User feedback 2026-06-25: "我们的 hiking 也好 plant 也好 memory 也好
  // 这几个都是需要位置和 GPS 这些的权限的 那我们是否应该在 homepage 去
  // 做这个事情". Confirmed via AskUserQuestion: yes, Home unified request.
  //
  // Trade-off accepted: permission prompt appears once when user reaches
  // Home (first time after login or fresh install). All downstream
  // screens (Hiking/Plant/Memory) can then assume permission granted
  // and skip the prompt + UI-already-rendered-before-prompt problem.
  //
  // Delay 800ms after mount so Home renders first; user has visual
  // context before iOS permission dialog appears (better UX than
  // dialog-on-blank-screen).
  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        // Lazy-import expo-location to avoid pulling it into Home's
        // initial render path.
        const Location = await import('expo-location');
        const existing = await Location.getForegroundPermissionsAsync();
        if (existing.status !== 'granted' && existing.canAskAgain) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../services/bootDiagnostics').markBootPhase('home_requesting_location_permission');
          } catch {/* ignore */}
          await Location.requestForegroundPermissionsAsync();
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            require('../services/bootDiagnostics').markBootPhase('home_location_permission_responded');
          } catch {/* ignore */}
        }
      } catch {
        // expo-location unavailable (web) — silent skip.
      }
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // v354: defer first paint until insets are ready (or 250ms timeout).
  // Prevents the OTA-reload-first-signin tab-jump bug where iOS hasn't
  // yet provided real safeAreaInsets to JS at the moment HomeScreen
  // mounts. With insetsReady gate, when we DO render we already have
  // correct paddingBottom and tabs are positioned right on the first
  // pixel the user sees.
  if (!insetsReady) {
    return <View style={styles.safe} />;
  }

  return (
    // v351: REVERTED v350 edges={['top']} change. v350 was based on
    // "double-padding race" hypothesis — wrong. v346-v349 design was
    // intentional: SafeAreaView provides ~34px native bottom padding
    // (home indicator) AND manual paddingBottom inset.bottom + 12px
    // provides a second tier. Total ~72px buffer keeps toolsRow above
    // the home indicator visual strip with comfortable margin. v350
    // removing one tier left only 12-38px → tabs visually pressed
    // against home indicator (or under on devices with insets=0 first
    // frame). Restore double-tier.
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.bg} />
      <OtaBadge />
      {/* v412: v409 UnfinishedSessionBanner 已删除, 恢复流程走 HikingScreen 的 UnfinishedRecoveryModal */}
      <Animated.View
        style={[
          styles.screen,
          {
            // Honour the device's bottom inset (home indicator). We can't
            // rely on SafeAreaView edges:['bottom'] alone — on Pro Max the
            // indicator strip was eating the toolsRow labels.
            paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.xs,
          },
          { opacity },
        ]}
      >

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            {/* Match Sign In page exactly: size=28 + marginTop:-7 + center
                alignment + gap=Spacing.xs. Keeps the brand mark visually
                consistent across the whole app. */}
            <View style={{ marginTop: -7 }}>
              <CairnLogo size={28} color={Colors.primary} />
            </View>
            <Text style={styles.logo}>Cairn</Text>
          </View>
          <Text style={styles.greeting}>{getGreeting()}</Text>
        </View>

        {/* v412: pending-sync banner — only when there are real pending
             hikes. v450 (a) English copy — Cairn UI is English; the
             pending banner was the last stray Chinese string. (b) filter
             out zombie shell sessions (distanceM===0 && durationS===0):
             those are startSession placeholders that never got real
             points, they can't sync anything so they shouldn't count. */}
        {(() => {
          const pendingCount = sessions.filter((s: any) => {
            const isPending = s.syncState === 'pending' || s.syncState === 'syncing';
            if (!isPending) return false;
            const hasContent = (s.distanceM ?? 0) > 0 || (s.durationS ?? 0) > 0;
            return hasContent;
          }).length;
          if (pendingCount === 0) return null;
          return (
            // O18 HOME-02: banner is now tappable — invokes syncDaemon.drainPending
            // so users don't have to wait for the automatic retry cycle.
            <TouchableOpacity
              style={styles.pendingBanner}
              onPress={async () => {
                try {
                  const { drainPending } = require('../services/syncDaemon');
                  await drainPending();
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.warn('[HOME-02] manual sync trigger failed:', e);
                }
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Retry pending sync now"
            >
              <Icon name="CloudOff" size={14} color={Colors.textSecondary} strokeWidth={2} />
              <Text style={styles.pendingBannerText}>
                {pendingCount === 1
                  ? '1 hike pending sync — tap to retry now'
                  : `${pendingCount} hikes pending sync — tap to retry now`}
              </Text>
            </TouchableOpacity>
          );
        })()}

        {/* Stats strip — only when data exists.
            O18 HOME-04: added period toggle (week / month / year / all). */}
        {hasData && (
          <>
            <View style={styles.periodToggle}>
              {(['week', 'month', 'year', 'all'] as const).map(p => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setStatsPeriod(p)}
                  style={[styles.periodChip, statsPeriod === p && styles.periodChipActive]}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${p} stats`}
                >
                  <Text style={[styles.periodChipText, statsPeriod === p && styles.periodChipTextActive]}>
                    {p === 'all' ? 'All' : p === 'week' ? 'Week' : p === 'month' ? 'Month' : 'Year'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statChip}>
                <Icon name="Route" size={12} color={Colors.primary} strokeWidth={2} />
                <Text style={styles.statText}>{plural(periodSessionCount, 'session')}</Text>
              </View>
              <View style={styles.statChip}>
                <FlagMarkerIcon size={14} stoneColor={Colors.flag} flagColor={Colors.primary} />
                <Text style={styles.statText}>{plural(markerCount, 'cairn')}</Text>
              </View>
            </View>
          </>
        )}

        {/* Recent activity — above the cards so user sees it before cards */}
        {hasRecent && <RecentRow onPress={(id) => nav.navigate('MapHistory', { sessionId: id })} />}

        {/* Activity Cards — fill remaining vertical space, two equal halves */}
        <View style={styles.cardsArea}>
          <ActivityCard
            icon={(sz) => <HikingIcon size={sz} color={Colors.primary} />}
            title="Hiking"
            subtitle="Track your route · Explore at your pace"
            accentColor={Colors.primary}
            lightBg={Colors.primaryLight}
            cardBg="#eef4e8"
            onPress={() => nav.navigate('Hiking')}
            anim={card1}
          />
          <ActivityCard
            icon={(sz) => <RunningIcon size={sz} color={Colors.running} />}
            title="Running"
            subtitle="Route planning · Lock mode"
            accentColor={Colors.running}
            lightBg={Colors.runningLight}
            cardBg="#e8f1f8"
            onPress={() => nav.navigate('Running')}
            anim={card2}
          />
          {/* v0.2.6.2 — Plant cairn entry. Smaller flex (0.5) so it
              reads as a tertiary action and Hiking/Running cards keep
              their v0.2.5 visual proportions. Flag/cairn palette so it
              reads as a third distinct activity. */}
          <ActivityCard
            icon={(sz) => <FlagMarkerIcon size={sz} stoneColor={Colors.flag} flagColor={Colors.primary} />}
            title="Leave a Cairn here"
            subtitle="Drop a note for friends or your future self"
            accentColor={Colors.flag}
            lightBg="#fbe9d8"
            cardBg="#fff5e9"
            onPress={() => {
              import('../services/appLog').then(({ log }) => log('home.tap_plant'));
              nav.navigate('Plant');
            }}
            anim={card2}
            flex={0.4}
          />
        </View>

        {/* Tools — Trails / Friends / Memory / Settings */}
        <View style={styles.toolsRow}>
          <ToolBtn iconName="Route" label="Trails" onPress={() => nav.navigate('Routes')} />
          <ToolBtn iconName="Users" label="Friends" onPress={() => nav.navigate('Friends')} />
          <ToolBtn iconName="Footprints" label="Memory" onPress={() => nav.navigate('Memory')} />
          <ToolBtn iconName="Settings2" label="Settings" onPress={() => nav.navigate('Settings')} />
        </View>

        {/* Sprint 68 STORY-00532 dev preview entry — only renders in __DEV__ */}
        {__DEV__ ? (
          <TouchableOpacity
            onPress={() => nav.navigate('MarkDetailDevPreview')}
            style={{ marginTop: 8, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 12 }}
            testID="dev-mark-detail-preview"
          >
            <Text style={{ color: '#8c7e72', fontSize: 11 }}>[dev] MarkDetail preview</Text>
          </TouchableOpacity>
        ) : null}

      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  screen: {
    flex: 1,
    paddingHorizontal: Spacing.base,
    paddingTop: Spacing.sm,
    // paddingBottom set inline using useSafeAreaInsets — see the JSX.
    gap: Spacing.sm,
  },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  logo: {
    fontSize: FontSize.h1, fontWeight: '900', color: Colors.textPrimary,
    letterSpacing: -1, lineHeight: 32, includeFontPadding: false,
  },
  greeting: { fontSize: FontSize.body, fontWeight: '600', color: Colors.textSecondary },

  statsRow: { flexDirection: 'row', gap: Spacing.sm },
  // O18 HOME-04: period toggle above stats row.
  periodToggle: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: Spacing.xs,
  },
  periodChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  periodChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  periodChipText: {
    fontSize: FontSize.tiny,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  periodChipTextActive: {
    color: '#fff',
  },
  // v412: 离线未同步提示条
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    backgroundColor: Colors.surfaceMuted ?? '#F5F0E5',
    borderRadius: Radius.chip,
    marginBottom: Spacing.xs,
  },
  pendingBannerText: {
    color: Colors.textSecondary,
    fontSize: FontSize.caption,
    flex: 1,
  },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: Radius.pill,
    paddingHorizontal: 12, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  statText: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textSecondary },

  cardsArea: { flex: 1, gap: Spacing.sm },

  toolsRow: { flexDirection: 'row', gap: Spacing.sm },
});

const cardStyles = StyleSheet.create({
  card: {
    borderRadius: Radius.cardLg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    flexDirection: 'row',
    // Upgraded shadow: deeper, more layered (elevation-3 feel)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  leftPanel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  innerRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    gap: Spacing.sm,
  },
  textCol: { flex: 1, gap: 5 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  subtitle: { fontSize: FontSize.small, color: Colors.textSecondary, lineHeight: 17 },
  accentLine: { width: 28, height: 3, borderRadius: 2, marginTop: 4, opacity: 0.8 },
  chevron: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});

const recentStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: Radius.card,
    paddingHorizontal: Spacing.md, paddingVertical: 10,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  dot: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  textGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  badge: { fontSize: FontSize.small, fontWeight: '700' },
  stat: { fontSize: FontSize.small, fontWeight: '600', color: Colors.textPrimary },
  when: { fontSize: FontSize.small, color: Colors.textMuted, flexShrink: 0 },
});

const toolStyles = StyleSheet.create({
  btn: {
    flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.card,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.sm, gap: 4,
    minHeight: 64,
    borderWidth: 1, borderColor: Colors.border, ...Shadow.card,
  },
  iconWrap: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
});
