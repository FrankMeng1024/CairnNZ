import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { Icon } from '../../components/Icon';
import { CairnIcon } from '../../components/CairnIcon';
import { HomeProductIcon } from '../../components/home/HomeProductIcon';
import { HomeActionCandidateIcon, type HikingIconCandidate, type RunningIconCandidate } from '../../components/home/HomeActionCandidateIcon';
import { SunnyMotionLayer } from '../../components/home/SunnyMotionLayer';
import { getRegisteredBackgroundLayout, type HomeBackgroundTokens } from '../../utils/homeBackground';

// Auto-generated from Home.spec.json  viewport 375x812
// States: H0, H1
// R21 v3 (2026-08-17): accepts optional bgAsset + bgTokens to apply
//   weather+time adaptive backgrounds and text/card colors. If tokens
//   are absent, falls back to hard-coded home-background.jpg + white text.

type HomeState = 'H0' | 'H1';

// R21 (2026-08-17): accept real stats + last hike info as props. Wrapper
// (HomeScreen.tsx) computes from useSessionStore / useMemoryStore and
// passes down. Now also accepts bgAsset + bgTokens (R21 v3).
export function HomeScreen(props: {
  state?: HomeState;
  initial?: string;
  exploredKm2?: number;
  greetingName?: string;
  lastHikeTitle?: string;
  lastHikeMeta?: string;
  /** Existing activity values composed into the unchanged card footprint. */
  lastHikeDetails?: string[];
  countryName?: string;
  percentOfCountry?: number;
  showPercent?: boolean;
  onToggleUnit?: () => void;
  bgAsset?: any;
  bgTokens?: HomeBackgroundTokens;
  /** Resolved scenic contrast from the wrapper; Sunset and Deep Night use
   *  the shared dark-foreground geometry without changing Home layout. */
  forcedIsDark?: boolean;
  /** Gate A1: render local ambient overlays only for the canonical Sunny Day. */
  sunnyMotionEnabled?: boolean;
  /** Dev-only real-Home icon review. Null/undefined keeps production glyphs. */
  hikingIconCandidate?: HikingIconCandidate | null;
  runningIconCandidate?: RunningIconCandidate | null;
  /** R21 (2026-08-18): when set, the last-hike card is tappable and its
   *  eyebrow shows the passed label (e.g. "Unfinished") instead of the
   *  default "Last hike". */
  lastHikeEyebrow?: string;
  onLastHikePress?: () => void;
} = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'H0';
  const initial = props.initial ?? '?';
  const greetingName = props.greetingName ?? 'Explorer';
  const lastHikeTitle = props.lastHikeTitle ?? 'Recent hike';
  const lastHikeMeta = props.lastHikeMeta ?? '';
  const lastHikeDetails = props.lastHikeDetails ?? [];
  const countryName = props.countryName;
  const percentOfCountry = props.percentOfCountry;
  const showPercent = !!props.showPercent;
  const km2 = props.exploredKm2 ?? 0;

  // R21 v3: bg + color tokens. Default keeps original behavior (white text
  // over the classic sunny-day background) so callers that don't pass tokens
  // still render correctly.
  const bgAsset = props.bgAsset ?? require('../../../assets/home/home-background.jpg');
  const tokens = props.bgTokens;
  const textColor = tokens?.textColor ?? '#ffffff';
  const textColorMuted = tokens?.textColorMuted ?? 'rgba(255,255,255,0.92)';
  const textShadowColor = tokens?.textShadowColor ?? 'rgba(0,0,0,0.5)';
  const heroTextShadowRadius = tokens?.heroTextShadowRadius ?? 8;
  const heroTextShadowOffsetY = tokens?.heroTextShadowOffsetY ?? 2;
  const cardBg = tokens?.cardBackgroundColor;
  const cardBorder = tokens?.cardBorderColor;
  const cardText = tokens?.cardTextColor;
  const cardTextMuted = tokens?.cardTextColorMuted;
  const actionBg = tokens?.actionButtonBackgroundColor;
  const actionText = tokens?.actionButtonTextColor;
  const tabBg = tokens?.tabBarBackgroundColor;
  const tabBorder = tokens?.tabBarBorderColor;
  const tabText = tokens?.tabBarTextColor;
  const actionIconColor = tokens?.actionIconColor ?? (props.forcedIsDark ? '#E2E9E7' : '#29483E');
  const navIconColor = tokens?.navIconColor ?? (props.forcedIsDark ? '#D3DEDC' : '#40564E');
  const useCorrectedSunnyIcons = tokens?.variant === 'sunny-day'
    || tokens?.variant === 'sunny-sunset'
    || tokens?.variant === 'sunny-night'
    || tokens?.variant.includes('-review-');

  // One functional vector family; Day/Night changes semantic color only.
  const isDark = props.forcedIsDark ?? false;
  const actionAccent = actionIconColor;
  const navAccent = navIconColor;
  const scenicScrim = tokens?.variant === 'sunny-day'
    ? ['rgba(7,24,27,0.00)', 'rgba(7,24,27,0.00)', 'rgba(7,24,27,0.00)', 'rgba(6,19,19,0.06)'] as const
    : tokens?.variant === 'sunny-sunset'
      ? ['rgba(31,28,38,0.06)', 'rgba(31,28,38,0.00)', 'rgba(31,28,38,0.02)', 'rgba(24,24,31,0.10)'] as const
    : tokens?.variant === 'sunny-night'
      ? ['rgba(7,13,23,0.06)', 'rgba(7,13,23,0.00)', 'rgba(7,13,23,0.02)', 'rgba(6,12,21,0.12)'] as const
    : tokens?.variant === 'cloudy-review-day'
      ? ['rgba(18,23,25,0.00)', 'rgba(18,23,25,0.00)', 'rgba(18,23,25,0.00)', 'rgba(13,19,19,0.06)'] as const
    : tokens?.variant === 'cloudy-review-sunset'
      ? ['rgba(30,31,36,0.08)', 'rgba(30,31,36,0.00)', 'rgba(30,31,36,0.03)', 'rgba(25,26,31,0.12)'] as const
    : tokens?.variant === 'cloudy-review-night'
      ? ['rgba(9,14,23,0.07)', 'rgba(9,14,23,0.00)', 'rgba(9,14,23,0.03)', 'rgba(7,12,20,0.13)'] as const
    : tokens?.variant === 'rain-review-day'
      ? ['rgba(20,26,27,0.00)', 'rgba(20,26,27,0.00)', 'rgba(20,26,27,0.00)', 'rgba(15,21,21,0.07)'] as const
    : tokens?.variant === 'rain-review-sunset'
      ? ['rgba(21,26,32,0.08)', 'rgba(21,26,32,0.00)', 'rgba(21,26,32,0.03)', 'rgba(16,22,28,0.13)'] as const
    : tokens?.variant === 'rain-review-night'
      ? ['rgba(7,13,21,0.08)', 'rgba(7,13,21,0.00)', 'rgba(7,13,21,0.03)', 'rgba(6,11,18,0.14)'] as const
    : tokens?.variant === 'snow-review-day' || tokens?.variant === 'snow-review-sunset'
      ? ['rgba(18,25,29,0.00)', 'rgba(18,25,29,0.00)', 'rgba(18,25,29,0.00)', 'rgba(13,19,23,0.05)'] as const
    : tokens?.variant === 'snow-review-night'
      ? ['rgba(7,12,21,0.06)', 'rgba(7,12,21,0.00)', 'rgba(7,12,21,0.02)', 'rgba(6,10,18,0.11)'] as const
      : isDark
        ? ['rgba(4,12,18,0.28)', 'rgba(4,12,18,0.02)', 'rgba(4,12,18,0.10)', 'rgba(3,10,14,0.34)'] as const
        : ['rgba(7,24,27,0.20)', 'rgba(7,24,27,0.01)', 'rgba(7,24,27,0.06)', 'rgba(6,19,19,0.24)'] as const;

  // Override helpers — flatten spread so we only override the changing color
  // props, keeping every position/size value from styles.ts intact.
  const heroBigTextOverride = {
    color: textColor,
    textShadowColor,
    textShadowRadius: heroTextShadowRadius,
    textShadowOffset: { width: 0, height: heroTextShadowOffsetY },
  };
  const heroSubTextOverride = {
    color: textColorMuted,
    textShadowColor,
    textShadowRadius: heroTextShadowRadius,
    textShadowOffset: { width: 0, height: heroTextShadowOffsetY },
  };
  const backgroundLayout = tokens
    ? getRegisteredBackgroundLayout(tokens)
    : { width: '100%' as const, height: '100%' as const, left: '0%' as const, top: '0%' as const };
  const cardContainerOverride = cardBg
    ? { backgroundColor: cardBg, borderColor: cardBorder }
    : null;
  const actionButtonOverride = actionBg
    ? { backgroundColor: actionBg, borderWidth: 1, borderColor: cardBorder }
    : null;
  const tabBarOverride = tabBg
    ? { backgroundColor: tabBg, borderColor: tabBorder }
    : null;
  const actionIconReviewActive = !!props.hikingIconCandidate || !!props.runningIconCandidate;
  const renderActionIcon = (name: 'hiking' | 'running' | 'leaveCairn') => {
    if (name === 'hiking' && props.hikingIconCandidate) {
      return <HomeActionCandidateIcon kind="hiking" candidate={props.hikingIconCandidate} size={29} color={actionIconColor} />;
    }
    if (name === 'running' && props.runningIconCandidate) {
      return <HomeActionCandidateIcon kind="running" candidate={props.runningIconCandidate} size={29} color={actionIconColor} />;
    }
    if (name === 'leaveCairn' && actionIconReviewActive) {
      return <HomeActionCandidateIcon kind="cairn" size={29} color={actionIconColor} />;
    }
    return useCorrectedSunnyIcons
      ? <HomeProductIcon name={name} size={29} color={actionIconColor} />
      : <CairnIcon name={name} size={29} color={actionIconColor} accent={actionAccent} active={name === 'hiking'} />;
  };
  const renderNavIcon = (name: 'trails' | 'friends' | 'memory' | 'settings') => useCorrectedSunnyIcons
    ? <HomeProductIcon name={name} size={20} color={navIconColor} />
    : <CairnIcon name={name} size={20} color={navIconColor} accent={navAccent} />;

  // R21 (2026-08-17): display formatting per user rules:
  //  - 走了一段但 <0.1 km² → show "0.1" (round up so progress is visible)
  //  - ≥0.1 → normal toFixed(1)
  // R21 (2026-08-17 user "不要写 <0.001 最小就 0.01"): floor at 0.01% so
  // early users always see a real number, never "<0.001".
  const exploredDisplay = showPercent && percentOfCountry != null
    ? (percentOfCountry < 0.01 ? '0.01' : percentOfCountry.toFixed(2))
    : (km2 < 0.1 ? '0.1' : km2.toFixed(1));
  const unitText = showPercent
    ? `% of ${countryName || 'the map'}`
    : `km² of ${countryName || 'your world'}`;
  return (
    <View style={{ flex: 1, width: 375, height: 812, backgroundColor: props.sunnyMotionEnabled ? '#79A8BE' : undefined }}>
      {state === 'H0' && (
        <>
          <Image source={bgAsset} style={[{ position: 'absolute' }, backgroundLayout]} resizeMode="cover" />
          {props.sunnyMotionEnabled ? <SunnyMotionLayer /> : null}
          <LinearGradient colors={scenicScrim} locations={[0, 0.34, 0.62, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Text style={[styles.shared__greeting_eyebrow, heroSubTextOverride]}>{'Kia ora,'}</Text>
          <Text style={[styles.shared__greeting_name, heroBigTextOverride]}>{greetingName}</Text>
          <View style={styles.shared__action_row}>
            <TouchableOpacity style={[styles.shared__action_row__action_hiking, actionButtonOverride]} onPress={() => nav.navigate('Hiking' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_hiking__icon}>{renderActionIcon('hiking')}</View>
              <Text style={[styles.shared__action_row__action_hiking__label, actionText ? { color: actionText } : null]}>{'Hiking'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_running, actionButtonOverride]} onPress={() => nav.navigate('Running' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_running__icon}>{renderActionIcon('running')}</View>
              <Text style={[styles.shared__action_row__action_running__label, actionText ? { color: actionText } : null]}>{'Running'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_leave_cairn, actionButtonOverride]} onPress={() => nav.navigate('Plant' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_leave_cairn__icon}>{renderActionIcon('leaveCairn')}</View>
              <Text style={[styles.shared__action_row__action_leave_cairn__label, actionText ? { color: actionText } : null]}>{'Leave a Cairn'}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.shared__tab_bar, tabBarOverride]}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>{renderNavIcon('trails')}</View>
              <Text style={[styles.shared__tab_bar__tab_trails_label, tabText ? { color: tabText } : null]}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>{renderNavIcon('friends')}</View>
              <Text style={[styles.shared__tab_bar__tab_friends_label, tabText ? { color: tabText } : null]}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>{renderNavIcon('memory')}</View>
              <Text style={[styles.shared__tab_bar__tab_memory_label, tabText ? { color: tabText } : null]}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>{renderNavIcon('settings')}</View>
              <Text style={[styles.shared__tab_bar__tab_settings_label, tabText ? { color: tabText } : null]}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.H0__hero_invite_1, heroBigTextOverride]}>{countryName || 'Your world'}</Text>
          <Text style={[styles.H0__hero_invite_2, heroBigTextOverride]}>{'is waiting.'}</Text>
          <Text style={[styles.H0__hero_invite_sub, heroSubTextOverride]}>{'Every step becomes your map.'}</Text>
          <View style={[styles.H0__first_journey_card, cardContainerOverride]}>
            <Text style={[styles.H0__first_journey_card__first_journey_eyebrow, cardTextMuted ? { color: cardTextMuted } : null]}>{'Your first trail'}</Text>
            <Text style={[styles.H0__first_journey_card__first_journey_title, cardText ? { color: cardText } : null]}>{'Head outside.'}</Text>
            <Text style={[styles.H0__first_journey_card__first_journey_title2, cardText ? { color: cardText } : null]}>{'Unravel your world.'}</Text>
            <Text style={[styles.H0__first_journey_card__first_journey_hint, cardTextMuted ? { color: cardTextMuted } : null]}>{'Tap an activity above to start.'}</Text>
          </View>
        </>
      )}
      {state === 'H1' && (
        <>
          <Image source={bgAsset} style={[{ position: 'absolute' }, backgroundLayout]} resizeMode="cover" />
          {props.sunnyMotionEnabled ? <SunnyMotionLayer /> : null}
          <LinearGradient colors={scenicScrim} locations={[0, 0.34, 0.62, 1]} style={StyleSheet.absoluteFill} pointerEvents="none" />
          <Text style={[styles.shared__greeting_eyebrow, heroSubTextOverride]}>{'Kia ora,'}</Text>
          <Text style={[styles.shared__greeting_name, heroBigTextOverride]}>{greetingName}</Text>
          <View style={styles.shared__action_row}>
            <TouchableOpacity style={[styles.shared__action_row__action_hiking, actionButtonOverride]} onPress={() => nav.navigate('Hiking' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_hiking__icon}>{renderActionIcon('hiking')}</View>
              <Text style={[styles.shared__action_row__action_hiking__label, actionText ? { color: actionText } : null]}>{'Hiking'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_running, actionButtonOverride]} onPress={() => nav.navigate('Running' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_running__icon}>{renderActionIcon('running')}</View>
              <Text style={[styles.shared__action_row__action_running__label, actionText ? { color: actionText } : null]}>{'Running'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_leave_cairn, actionButtonOverride]} onPress={() => nav.navigate('Plant' as never)} activeOpacity={0.85}>
              <View style={styles.shared__action_row__action_leave_cairn__icon}>{renderActionIcon('leaveCairn')}</View>
              <Text style={[styles.shared__action_row__action_leave_cairn__label, actionText ? { color: actionText } : null]}>{'Leave a Cairn'}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.shared__tab_bar, tabBarOverride]}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <View style={styles.shared__tab_bar__tab_trails_icon_wrap}>{renderNavIcon('trails')}</View>
              <Text style={[styles.shared__tab_bar__tab_trails_label, tabText ? { color: tabText } : null]}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <View style={styles.shared__tab_bar__tab_friends_icon_wrap}>{renderNavIcon('friends')}</View>
              <Text style={[styles.shared__tab_bar__tab_friends_label, tabText ? { color: tabText } : null]}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <View style={styles.shared__tab_bar__tab_memory_icon_wrap}>{renderNavIcon('memory')}</View>
              <Text style={[styles.shared__tab_bar__tab_memory_label, tabText ? { color: tabText } : null]}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <View style={styles.shared__tab_bar__tab_settings_icon_wrap}>{renderNavIcon('settings')}</View>
              <Text style={[styles.shared__tab_bar__tab_settings_label, tabText ? { color: tabText } : null]}>Settings</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.H1__hero_metric_eyebrow, heroSubTextOverride]}>{'You\'ve explored'}</Text>
          {/* R21 (2026-08-17 user "数字+km 在一起, 数字右上角小切换按钮"):
              hero_metric_number + unit inline via absolute-positioned row,
              toggle button at top-right of that row. */}
          <View style={{ position: 'absolute', left: 24, top: 168, flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={[styles.H1__hero_metric_number, { position: 'relative', left: 0, top: 0 }, heroBigTextOverride]}>
              {exploredDisplay}
            </Text>
            <Text style={[
              {
                fontSize: 20, fontWeight: '700',
                color: textColor,
                textShadowColor,
                textShadowOffset: { width: 0, height: heroTextShadowOffsetY }, textShadowRadius: heroTextShadowRadius,
                marginLeft: 6, marginTop: 12,
              }
            ]}>
              {showPercent ? '%' : 'km²'}
            </Text>
            {props.onToggleUnit && (
              <TouchableOpacity
                onPress={props.onToggleUnit}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                style={{
                  marginLeft: 6, marginTop: 10,
                  padding: 2,
                  backgroundColor: 'transparent',
                }}
                accessibilityLabel="Toggle km² / %"
              >
                <Icon name="ArrowLeftRight" size={14} color={textColor} strokeWidth={2.2} />
              </TouchableOpacity>
            )}
          </View>
          {/* Subtitle line below the number: "of {city}" or "of the map" */}
          <Text style={[styles.H1__hero_metric_unit, heroSubTextOverride]}>
            {showPercent ? `of ${countryName || 'the map'}` : `of ${countryName || 'your world'}`}
          </Text>
          {/* R21 (2026-08-17): duplicate top-right toggle removed. The new
              inline toggle sits next to the km² label. */}
          <TouchableOpacity
            activeOpacity={props.onLastHikePress ? 0.85 : 1}
            disabled={!props.onLastHikePress}
            onPress={props.onLastHikePress}
            style={[styles.H1__last_hike_card, cardContainerOverride]}
          >
            <Text style={[styles.H1__last_hike_card__last_hike_eyebrow, cardTextMuted ? { color: cardTextMuted } : null]}>{props.lastHikeEyebrow ?? 'Last hike'}</Text>
            <Text style={[styles.H1__last_hike_card__last_hike_title, cardText ? { color: cardText } : null]}>{lastHikeTitle}</Text>
            {lastHikeDetails.length > 0 ? (
              <View style={styles.H1__last_hike_card__detail_row}>
                {lastHikeDetails.slice(0, 3).map((detail, index) => (
                  <React.Fragment key={`${detail}-${index}`}>
                    {index > 0 ? <View style={[styles.H1__last_hike_card__detail_divider, cardTextMuted ? { backgroundColor: cardTextMuted } : null]} /> : null}
                    <Text numberOfLines={1} style={[styles.H1__last_hike_card__detail_text, cardTextMuted ? { color: cardTextMuted } : null]}>{detail}</Text>
                  </React.Fragment>
                ))}
              </View>
            ) : (
              <Text style={[styles.H1__last_hike_card__last_hike_meta, cardTextMuted ? { color: cardTextMuted } : null]}>{lastHikeMeta}</Text>
            )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}
