/**
 * HomeScreen — spec-driven implementation.
 *
 * This screen used to be 978 lines of hand-crafted layout. That version is
 * archived at HomeScreen.OLD.tsx.bak. The new flow:
 *   1. docs/ui-redesign/Home.spec.json  (single source of truth)
 *   2. spike/spec_to_rn.py  generates  screens/home_generated/*
 *   3. this file wires nav + real store data + navigation callbacks into
 *      the generated component
 *
 * When the concept changes: edit spec.json → rerun spec_to_rn.py → nothing
 * to touch here unless a new prop appears.
 */
import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, LayoutChangeEvent, TouchableOpacity, Text, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { HomeScreen as GeneratedHome } from './home_generated/HomeScreen.generated';
import { useSessionStore } from '../store/useSessionStore';
import { useAppStore } from '../store/useAppStore';
import { useMemoryStore } from '../features/memory/store/useMemoryStore';
import { useWeatherStore, NZ_TEST_CITIES } from '../store/useWeatherStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAppearance } from '../hooks/useAppearance';
import { resolveCurrentCountry } from '../services/countryService';
import { getHomeBackground } from '../utils/homeBackground';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const DESIGN_W = 375;
const DESIGN_H = 812;

// R21 (2026-08-17): country area (km²) for percentage-of-country stat.
// Wikipedia data, hard-coded lookup for common target markets.
const COUNTRY_AREA_KM2: Record<string, number> = {
  'NZ': 268021,
  'AU': 7692024,
  'US': 9833520,
  'CA': 9984670,
  'GB': 243610,
  'CN': 9596961,
  'JP': 377975,
  'DE': 357022,
  'FR': 643801,
  'IN': 3287263,
  'BR': 8515767,
  'ZA': 1221037,
};

function formatDistanceKm(meters: number): string {
  return (meters / 1000).toFixed(1) + ' km';
}
function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}
function formatRelativeDay(startedAt: number | string): string {
  const t = typeof startedAt === 'number' ? startedAt : new Date(startedAt).getTime();
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString();
}

export function HomeScreen() {
  const nav = useNavigation<Nav>();
  const user = useAppStore(s => s.user);
  const sessions = useSessionStore(s => s.sessions);
  const memoryPointCount = useMemoryStore(s => s.points.length);
  const weatherCondition = useWeatherStore(s => s.condition);
  const conditionOverride = useWeatherStore(s => s.conditionOverride);
  const locationOverride = useWeatherStore(s => s.locationOverride);
  const dayNightOverride = useWeatherStore(s => s.dayNightOverride);
  const fetchWeather = useWeatherStore(s => s.fetchWeather);
  // Effective condition = override if set, else real. Drives bg + tokens.
  const effectiveCondition = conditionOverride ?? weatherCondition;
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [country, setCountry] = useState<{ name: string; code: string } | null>(null);
  const [showPercent, setShowPercent] = useState(false);
  // R21 (2026-08-17 user "在settings里添加一个 可以隐藏首页的探索百分比的设置"):
  // when Settings toggle is off, hide the % swap icon and force km² display.
  const showExplorationPercent = useSettingsStore(s => s.showExplorationPercent);
  // R21 (2026-08-17 user "debug模式开启的时候展示出来"): gate the top-right
  // DEV cycler on debugMode instead of __DEV__ so it appears on production
  // builds after 5-tap Settings unlock.
  const debugMode = useSettingsStore(s => s.debugMode);

  // R21 (2026-08-18 user "如果正有一个正在进行 未完成的hike ... 展示的内容是
  // 最后一个未完成的action, N-1个未完成的action, last 完成了的 action,
  // empty action"): read unfinished hike/run backups from disk. Home
  // reveals them ahead of completed sessions so a returning user is
  // reminded to resume or discard first. Refreshes on focus.
  const [unfinishedHikes, setUnfinishedHikes] = useState<Array<{ session_id: string; started_at: number; activity_mode: 'hiking' | 'running' }>>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { listActiveHikes } = require('../services/hikeTrackWriter');
        const list = await listActiveHikes();
        if (!cancelled) {
          setUnfinishedHikes(
            list.map((m: any) => ({
              session_id: m.session_id,
              started_at: m.started_at,
              activity_mode: m.activity_mode,
            })).sort((a: any, b: any) => b.started_at - a.started_at),
          );
        }
      } catch { /* silent — no disk = empty */ }
    })();
    return () => { cancelled = true; };
  }, [sessions.length]);

  const validSessions = useMemo(
    () => sessions.filter((s: any) => (s.distanceM > 0 || s.durationS > 0) && s.startedAt),
    [sessions],
  );
  const hasHike = validSessions.length > 0;
  const state = hasHike ? 'H1' : 'H0';

  // R21 (2026-08-17 user "你没索要地理 GPS 位置么"): actively request
  // foreground location permission on Home mount so we can read GPS for
  // country name + real weather. If user grants, resolveCurrentCountry
  // + fetchWeather will succeed. If they deny, we silently fall back to
  // "Your world" copy and default sunny bg.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Location = require('expo-location');
        const existing = await Location.getForegroundPermissionsAsync();
        if (existing.status !== 'granted' && existing.canAskAgain !== false) {
          await Location.requestForegroundPermissionsAsync();
        }
        // Whether or not it granted, resolve/fetch below will handle both paths.
      } catch { /* silent */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // R21 (2026-08-17): resolve current country from GPS. If location override
  // is active, use that instead. Cached 24h so first-render doesn't wait.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (locationOverride) {
        // Use overridden city name as country — dev/test.
        setCountry({ name: locationOverride.label, code: 'NZ' });
        return;
      }
      const result = await resolveCurrentCountry();
      if (!cancelled && result) {
        setCountry({ name: result.countryName, code: result.countryCode });
      }
    })();
    return () => { cancelled = true; };
  }, [locationOverride]);

  // R21 (2026-08-17): fire real weather fetch on mount if no override.
  // If GPS available, use real lat/lon; else fall back to a default. Real
  // condition drives the bg + text tokens.
  useEffect(() => {
    if (locationOverride) return; // dev override handles its own fetch
    let cancelled = false;
    (async () => {
      try {
        // R21 (2026-08-17): defensive — on web + when expo-location's web
        // shim has limited API, some methods can throw. Guard the whole
        // block; failure just means bg stays default. Fixes crash user
        // reported: "进了 memory 返回 他报错了".
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Location = require('expo-location');
        if (!Location || typeof Location.getForegroundPermissionsAsync !== 'function') return;
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (!perm?.granted) return;
        let pos: any = null;
        try {
          pos = await Location.getLastKnownPositionAsync({});
        } catch { /* fallback */ }
        if (!pos) {
          try {
            pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy?.Lowest ?? 1 });
          } catch { /* silent */ }
        }
        if (!cancelled && pos?.coords) {
          fetchWeather(pos.coords.latitude, pos.coords.longitude);
        }
      } catch { /* silent — bg stays sunny default */ }
    })();
    return () => { cancelled = true; };
  }, [locationOverride, fetchWeather]);

  // exploredKm² = memoryPointCount × 0.000541 (each 25m hex cell ≈ 541 m²)
  const exploredKm2 = useMemo(() => memoryPointCount * 0.000541, [memoryPointCount]);

  // R21 (2026-08-17 user "0.0 不要写", "走了一段写 0.1 km 这种"):
  // display precision + suppression. Below 0.05 km² → no digits (H0).
  // 0.05–0.1 → 0.1 (round up so users see progress right away).
  // Above → normal .toFixed(1).
  // Also: if state is H1 but exploredKm2 < 0.05, fall back to H0-like
  // greeting (no digits) — user's "0.0" complaint.
  const hasMeaningfulExploration = exploredKm2 >= 0.05;
  const displayState = hasHike && hasMeaningfulExploration ? 'H1' : 'H0';

  const lastHike = useMemo(() => {
    if (!hasHike) return null;
    const sorted = [...validSessions].sort((a: any, b: any) => {
      const ta = typeof a.startedAt === 'number' ? a.startedAt : new Date(a.startedAt).getTime();
      const tb = typeof b.startedAt === 'number' ? b.startedAt : new Date(b.startedAt).getTime();
      return tb - ta;
    });
    return sorted[0];
  }, [hasHike, validSessions]);

  // R21 (2026-08-18): priority display — most recent unfinished action wins
  // over the last completed hike. Users see "resume or discard" instead of
  // "here's an old completed hike" when there's an in-progress session.
  const topUnfinished = unfinishedHikes[0] ?? null;
  const otherUnfinishedCount = Math.max(0, unfinishedHikes.length - 1);
  const showUnfinished = !!topUnfinished;

  const lastHikeTitle = showUnfinished
    ? (topUnfinished.activity_mode === 'running' ? 'Run in progress' : 'Hike in progress')
    : (lastHike?.name || 'Recent hike');
  const lastHikeMeta = showUnfinished
    ? `Tap to resume or discard${otherUnfinishedCount > 0 ? ` · +${otherUnfinishedCount} more unfinished` : ''} · Started ${formatRelativeDay(topUnfinished.started_at)}`
    : (lastHike
    ? `${formatDistanceKm(lastHike.distanceM || 0)} · ${formatDuration(lastHike.durationS || 0)} · ${formatRelativeDay(lastHike.startedAt)}`
    : '');

  const initial = ((user?.name ?? user?.email ?? '?').charAt(0) || '?').toUpperCase();
  const greetingName = user?.name || 'Explorer';

  // R21 (2026-08-17 user "右上角小转换 icon 切百分比"): compute % of country
  // area. Only meaningful if we resolved a country. Uses hardcoded area map.
  const countryAreaKm2 = country ? COUNTRY_AREA_KM2[country.code] : undefined;
  const percentOfCountry = countryAreaKm2 ? (exploredKm2 / countryAreaKm2) * 100 : null;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0 && (dims?.w !== width || dims?.h !== height)) {
      setDims({ w: width, h: height });
    }
  };

  const scale = dims ? Math.min(dims.w / DESIGN_W, dims.h / DESIGN_H) : 1;

  // R21 (2026-08-17): weather-adaptive tokens now respect user Appearance
  // preference. When user explicitly picks Light/Dark, we override the
  // clock-based day/night; DEV toggle still wins over both.
  const appearance = useAppearance();
  const bgTokens = useMemo(
    () => {
      // Priority: DEV dayNightOverride > user Appearance (light/dark) > real clock (auto)
      let forced: 'day' | 'night' | undefined = undefined;
      if (dayNightOverride === 'day' || dayNightOverride === 'night') {
        forced = dayNightOverride;
      } else if (appearance.mode === 'light') {
        forced = 'day';
      } else if (appearance.mode === 'dark') {
        forced = 'night';
      }
      return getHomeBackground(effectiveCondition, Date.now(), forced);
    },
    [effectiveCondition, dayNightOverride, appearance.mode],
  );

  // R21 (2026-08-17 user "DEV 改的是我的当前 GPS location + 切白天黑夜 + reset"):
  // DEV menu supports two independent overrides:
  //  - Location: 5 NZ cities → triggers real weather fetch → real condition
  //  - Day/Night: force UI to render day or night variant (independent of clock)
  //  - Reset: clear both, back to real GPS + real time
  // TODO: LAUNCH_GATE — remove before App Store submission.
  const setLocationOverride = useWeatherStore(s => s.setLocationOverride);
  const setDayNightOverride = useWeatherStore(s => s.setDayNightOverride);
  const setConditionOverride = useWeatherStore(s => s.setConditionOverride);
  const [devMenuOpen, setDevMenuOpen] = useState(false);
  // R21 (2026-08-17 user "二次点击就是取消"): each toggle is idempotent —
  // click city A once = override, click A again = clear. Same for weather
  // and day/night. No "reset" button needed.

  return (
    <View style={styles.root} onLayout={onLayout}>
      {dims && (
        <View
          style={[
            styles.canvas,
            {
              width: DESIGN_W,
              height: DESIGN_H,
              transform: [{ scale }],
            },
          ]}
        >
          <GeneratedHome
            state={showUnfinished ? 'H1' : displayState}
            initial={initial}
            greetingName={greetingName}
            exploredKm2={exploredKm2}
            countryName={country?.name}
            percentOfCountry={percentOfCountry ?? undefined}
            showPercent={showExplorationPercent && showPercent}
            onToggleUnit={showExplorationPercent ? () => setShowPercent(v => !v) : undefined}
            lastHikeTitle={lastHikeTitle}
            lastHikeMeta={lastHikeMeta}
            lastHikeEyebrow={showUnfinished ? 'Unfinished' : 'Last hike'}
            onLastHikePress={showUnfinished
              ? () => nav.navigate(topUnfinished!.activity_mode === 'running' ? 'Running' : 'Hiking')
              : undefined}
            bgAsset={bgTokens.bgAsset}
            bgTokens={bgTokens}
            forcedIsDark={bgTokens.variant.endsWith('-night')}
          />
          {/* DEV-only weather cycler — top-right circular button.
              TODO: LAUNCH_GATE — remove this block before App Store. */}
          {/* R21 (2026-08-17 user "homepage右上角有一个dev...debug模式开启的时候展示出来"):
              gate DEV menu on Settings debugMode (unlocked via 5-tap on
              About Cairn) instead of __DEV__. Ships on production builds
              but hidden until user opts in via Settings. */}
          {debugMode && (
            <View style={{ position: 'absolute', right: 20, top: 56 }}>
              <TouchableOpacity
                onPress={() => setDevMenuOpen(v => !v)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{
                  width: 34, height: 34, borderRadius: 17,
                  backgroundColor: 'rgba(255,255,255,0.7)',
                  alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: 'rgba(33,54,44,0.15)',
                }}
                accessibilityLabel="DEV weather cycler"
              >
                <Text style={{ fontSize: 10, fontWeight: '900', color: '#21362C', letterSpacing: 0.5 }}>DEV</Text>
              </TouchableOpacity>
              {devMenuOpen && (
                <View style={{
                  position: 'absolute', right: 0, top: 42,
                  backgroundColor: 'rgba(255,255,255,0.97)',
                  borderRadius: 12,
                  paddingVertical: 6,
                  paddingHorizontal: 8,
                  width: 230,
                  shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
                  elevation: 6,
                }}>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>
                    LOCATION
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                    {NZ_TEST_CITIES.map((city) => {
                      const active = locationOverride?.label === city.label;
                      return (
                        <TouchableOpacity
                          key={city.label}
                          onPress={() => {
                            // Second click = toggle off (real GPS)
                            if (active) {
                              setLocationOverride(null);
                            } else {
                              setLocationOverride({ label: city.label, lat: city.lat, lon: city.lon });
                            }
                            setDevMenuOpen(false);
                          }}
                          style={{
                            paddingVertical: 4, paddingHorizontal: 8,
                            borderRadius: 8,
                            backgroundColor: active ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C' }}>
                            {city.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>
                    WEATHER
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    {(['sunny','cloudy','rain','snow'] as const).map((c) => {
                      const active = conditionOverride === c;
                      return (
                        <TouchableOpacity
                          key={c}
                          onPress={() => {
                            setConditionOverride(active ? null : c);
                            setDevMenuOpen(false);
                          }}
                          style={{
                            flex: 1, paddingVertical: 4, paddingHorizontal: 4,
                            borderRadius: 8,
                            alignItems: 'center',
                            backgroundColor: active ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                          }}
                        >
                          <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C', textTransform: 'capitalize' }}>
                            {c}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                  <Text style={{ paddingHorizontal: 4, paddingTop: 2, paddingBottom: 3, fontSize: 9, fontWeight: '700', color: '#8A8F95', letterSpacing: 0.5 }}>
                    TIME
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        setDayNightOverride(dayNightOverride === 'day' ? null : 'day');
                        setDevMenuOpen(false);
                      }}
                      style={{
                        flex: 1, paddingVertical: 4, alignItems: 'center', borderRadius: 8,
                        backgroundColor: dayNightOverride === 'day' ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C' }}>Day</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        setDayNightOverride(dayNightOverride === 'night' ? null : 'night');
                        setDevMenuOpen(false);
                      }}
                      style={{
                        flex: 1, paddingVertical: 4, alignItems: 'center', borderRadius: 8,
                        backgroundColor: dayNightOverride === 'night' ? 'rgba(33,54,44,0.15)' : 'rgba(33,54,44,0.05)',
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#21362C' }}>Night</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  canvas: { overflow: 'hidden' },
});
