import React from 'react';
import { View, Text, Image, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { styles } from './styles';
import { Icon } from '../../components/Icon';
import type { HomeBackgroundTokens } from '../../utils/homeBackground';
import { useAppearance } from '../../hooks/useAppearance';

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
  countryName?: string;
  percentOfCountry?: number;
  showPercent?: boolean;
  onToggleUnit?: () => void;
  bgAsset?: any;
  bgTokens?: HomeBackgroundTokens;
} = {}) {
  const nav = useNavigation<any>();
  const state = props.state ?? 'H0';
  const initial = props.initial ?? '?';
  const greetingName = props.greetingName ?? 'Explorer';
  const lastHikeTitle = props.lastHikeTitle ?? 'Recent hike';
  const lastHikeMeta = props.lastHikeMeta ?? '';
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
  const cardBg = tokens?.cardBackgroundColor;
  const cardBorder = tokens?.cardBorderColor;
  const cardText = tokens?.cardTextColor;
  const cardTextMuted = tokens?.cardTextColorMuted;
  const actionBg = tokens?.actionButtonBackgroundColor;
  const actionText = tokens?.actionButtonTextColor;
  const tabBg = tokens?.tabBarBackgroundColor;
  const tabBorder = tokens?.tabBarBorderColor;
  const tabText = tokens?.tabBarTextColor;

  // R21 (2026-08-17): day/night action icon variants. Night = gold, Day = dark green.
  const { isDark } = useAppearance();
  const hikingIcon  = isDark ? require('../../../assets/home/action-hiking-night.png')     : require('../../../assets/home/action-hiking-day.png');
  const runningIcon = isDark ? require('../../../assets/home/action-running-night.png')    : require('../../../assets/home/action-running-day.png');
  const cairnIcon   = isDark ? require('../../../assets/home/action-leave-cairn-night.png'): require('../../../assets/home/action-leave-cairn-day.png');

  // Override helpers — flatten spread so we only override the changing color
  // props, keeping every position/size value from styles.ts intact.
  const heroBigTextOverride = { color: textColor, textShadowColor };
  const heroSubTextOverride = { color: textColorMuted, textShadowColor };
  const cardContainerOverride = cardBg
    ? { backgroundColor: cardBg, borderColor: cardBorder }
    : null;
  const actionButtonOverride = actionBg
    ? { backgroundColor: actionBg }
    : null;
  const tabBarOverride = tabBg
    ? { backgroundColor: tabBg, borderColor: tabBorder }
    : null;

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
    <View style={{ flex: 1, width: 375, height: 812 }}>
      {state === 'H0' && (
        <>
          <Image source={bgAsset} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <Text style={[styles.shared__greeting_eyebrow, heroSubTextOverride]}>{'Kia ora,'}</Text>
          <Text style={[styles.shared__greeting_name, heroBigTextOverride]}>{greetingName}</Text>
          <View style={styles.shared__action_row}>
            <TouchableOpacity style={[styles.shared__action_row__action_hiking, actionButtonOverride]} onPress={() => nav.navigate('Hiking' as never)} activeOpacity={0.85}>
              <Image source={hikingIcon} style={styles.shared__action_row__action_hiking__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_hiking__label, actionText ? { color: actionText } : null]}>{'Hiking'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_running, actionButtonOverride]} onPress={() => nav.navigate('Running' as never)} activeOpacity={0.85}>
              <Image source={runningIcon} style={styles.shared__action_row__action_running__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_running__label, actionText ? { color: actionText } : null]}>{'Running'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_leave_cairn, actionButtonOverride]} onPress={() => nav.navigate('Plant' as never)} activeOpacity={0.85}>
              <Image source={cairnIcon} style={styles.shared__action_row__action_leave_cairn__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_leave_cairn__label, actionText ? { color: actionText } : null]}>{'Leave a Cairn'}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.shared__tab_bar, tabBarOverride]}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/home/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_trails_label, tabText ? { color: tabText } : null]}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/home/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_friends_label, tabText ? { color: tabText } : null]}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/home/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_memory_label, tabText ? { color: tabText } : null]}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/home/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
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
          <Image source={bgAsset} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' }} resizeMode="cover" />
          <Text style={[styles.shared__greeting_eyebrow, heroSubTextOverride]}>{'Kia ora,'}</Text>
          <Text style={[styles.shared__greeting_name, heroBigTextOverride]}>{greetingName}</Text>
          <View style={styles.shared__action_row}>
            <TouchableOpacity style={[styles.shared__action_row__action_hiking, actionButtonOverride]} onPress={() => nav.navigate('Hiking' as never)} activeOpacity={0.85}>
              <Image source={hikingIcon} style={styles.shared__action_row__action_hiking__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_hiking__label, actionText ? { color: actionText } : null]}>{'Hiking'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_running, actionButtonOverride]} onPress={() => nav.navigate('Running' as never)} activeOpacity={0.85}>
              <Image source={runningIcon} style={styles.shared__action_row__action_running__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_running__label, actionText ? { color: actionText } : null]}>{'Running'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.shared__action_row__action_leave_cairn, actionButtonOverride]} onPress={() => nav.navigate('Plant' as never)} activeOpacity={0.85}>
              <Image source={cairnIcon} style={styles.shared__action_row__action_leave_cairn__icon} resizeMode="contain" />
              <Text style={[styles.shared__action_row__action_leave_cairn__label, actionText ? { color: actionText } : null]}>{'Leave a Cairn'}</Text>
            </TouchableOpacity>
          </View>
          <View style={[styles.shared__tab_bar, tabBarOverride]}>
            <TouchableOpacity style={styles.shared__tab_bar__tab_trails} onPress={() => nav.navigate('Routes' as never)}>
              <Image source={require('../../../assets/home/tab-trails.png')} style={styles.shared__tab_bar__tab_trails_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_trails_label, tabText ? { color: tabText } : null]}>Trails</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_friends} onPress={() => nav.navigate('Friends' as never)}>
              <Image source={require('../../../assets/home/tab-friends.png')} style={styles.shared__tab_bar__tab_friends_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_friends_label, tabText ? { color: tabText } : null]}>Friends</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_memory} onPress={() => nav.navigate('Memory' as never)}>
              <Image source={require('../../../assets/home/tab-memory.png')} style={styles.shared__tab_bar__tab_memory_icon} resizeMode="contain" />
              <Text style={[styles.shared__tab_bar__tab_memory_label, tabText ? { color: tabText } : null]}>Memory</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.shared__tab_bar__tab_settings} onPress={() => nav.navigate('Settings' as never)}>
              <Image source={require('../../../assets/home/tab-settings.png')} style={styles.shared__tab_bar__tab_settings_icon} resizeMode="contain" />
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
                textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8,
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
          <View style={[styles.H1__last_hike_card, cardContainerOverride]}>
            <Text style={[styles.H1__last_hike_card__last_hike_eyebrow, cardTextMuted ? { color: cardTextMuted } : null]}>{'Last hike'}</Text>
            <Text style={[styles.H1__last_hike_card__last_hike_title, cardText ? { color: cardText } : null]}>{lastHikeTitle}</Text>
            <Text style={[styles.H1__last_hike_card__last_hike_meta, cardTextMuted ? { color: cardTextMuted } : null]}>{lastHikeMeta}</Text>
          </View>
        </>
      )}
    </View>
  );
}
