/**
 * RootNavigator
 *
 * v0.2.5: Auth → Home → (Hiking | Running | MapHistory | ...). NO bottom
 *         tabs. Navigation from HomeScreen's ToolsRow.
 *
 * v0.2.6.4: Restored v0.2.5 model after user feedback. The brief
 * stint with BottomTabNavigator was a misread of the spec — the
 * intent is "Routes is renamed Trails, Memory replaces the old AR screen"
 * inside the existing tools row, not a wholesale tab-bar swap.
 */
import React from 'react';
import { Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// R113 restore: navigationRef for Playwright web QA (Round loop). Removed
// in O11 pre-launch cleanup (commit 6bb108e), restored here for the 433-
// case reverse-test loop. Guarded on Platform.OS==='web' — native/production
// bundles get null because Metro tree-shakes Platform.OS branches.
// MUST DELETE before App Store submission (production build).
// Track memory feedback_sleep_map_round_2026_08_05.md.
export const navigationRef = Platform.OS === 'web'
  ? createNavigationContainerRef()
  : null as unknown as ReturnType<typeof createNavigationContainerRef>;

import { AuthScreen } from '../screens/AuthScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { HikingScreen } from '../screens/HikingScreen';
import { RunningScreen } from '../screens/RunningScreen';
import { MapHistoryScreen } from '../screens/MapHistoryScreen';
import { RoutesScreen } from '../screens/RoutesScreen';
import { RouteEditorScreen } from '../screens/RouteEditorScreen';
import { DebugScreen } from '../screens/DebugScreen';
import { PlantScreen } from '../screens/PlantScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { FriendsPreviewScreen } from '../screens/FriendsPreviewScreen';
import { HomePreviewScreen } from '../screens/HomePreviewScreen';
import { HikingPreviewScreen } from '../screens/HikingPreviewScreen';
import { RunningPreviewScreen } from '../screens/RunningPreviewScreen';
import { RoutesPreviewScreen } from '../screens/RoutesPreviewScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MemoryScreen } from '../features/memory/screens/MemoryScreen';
import { MarkDetailDevPreviewScreen } from '../features/marks/dev/MarkDetailDevPreviewScreen';
import { Gate1IconSheetScreen } from '../screens/Gate1IconSheetScreen';
import { MarkerDetailScreen } from '../screens/MarkerDetailScreen';
import { OnboardingModal, hasCompletedOnboarding } from '../features/onboarding/OnboardingModal';
import { OfflineBanner } from '../components/OfflineBanner';
import { useAppStore } from '../store/useAppStore';
// R21 (2026-08-17): isPlaywrightBypass import removed — no more bypass in
// nav gate. Real login flow only.
import { markBootPhase } from '../services/bootDiagnostics';
import { useVisualTheme } from '../hooks/useVisualTheme';

// v302: mark immediately after all transitive imports above resolved.
// If app dies between `render_about_to_mount_root` (App.tsx) and
// `navigator_module_loaded` (here), some Screen's module-level code crashed.
markBootPhase('navigator_module_loaded');

export type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  Hiking: undefined;
  Running: undefined;
  MapHistory: { sessionId?: string; routeId?: string } | undefined;
  Routes: { initialTab?: 'routes' | 'activities' | 'flags' } | undefined;
  RouteEditor: { routeId?: string; fromSessionId?: string } | undefined;
  Plant: undefined;
  MarkerDetail: { markerId: string };
  Friends: undefined;
  /** dev-only preview: renders the auto-generated FriendsScreen from spec.json.
   *  Query param 'state' picks which of F0-F6 to render. */
  FriendsPreview: { state?: string } | undefined;
  /** dev-only preview: renders the auto-generated HomeScreen from Home.spec.json. */
  HomePreview: { state?: string } | undefined;
  /** dev-only preview: renders the auto-generated HikingScreen from Hiking.spec.json.
   *  Query param 'state' picks which of H0-H4 to render. */
  HikingPreview: { state?: string } | undefined;
  /** dev-only preview: renders the auto-generated RunningScreen from Running.spec.json.
   *  Query param 'state' picks which of R0-R4 to render. */
  RunningPreview: { state?: string } | undefined;
  /** dev-only preview: renders the auto-generated RoutesScreen from Routes.spec.json.
   *  Query param 'state' picks which of R0-R9 to render (10 Trails-Flow screens). */
  RoutesPreview: { state?: string } | undefined;
  Settings: undefined;
  Memory: undefined;
  Debug: undefined;
  /** Sprint 68 STORY-00532: dev-only preview for MarkDetailSheet 4 forms. */
  MarkDetailDevPreview: undefined;
  Gate1IconSheet: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isLoggedIn, user } = useAppStore();
  const visualTheme = useVisualTheme();
  markBootPhase('navigator_body_running', { isLoggedIn: !!isLoggedIn });

  // v312 anchor: just before NavigationContainer JSX. If we see this
  // beacon but no `navigation_container_ready`, the death is inside
  // NavigationContainer's mount.
  markBootPhase('navigator_before_jsx');

  // Batch 6.0 (ONB-01/02/04): show onboarding once per install for
  // authenticated users. We hydrate the flag lazily so the initial mount
  // isn't blocked — `onboardingChecked === false` means "still checking"
  // and no modal renders. Once checked, `showOnboarding` decides.
  const [onboardingChecked, setOnboardingChecked] = React.useState(false);
  const [showOnboarding, setShowOnboarding] = React.useState(false);
  React.useEffect(() => {
    if (!isLoggedIn) {
      // Signed out — reset so a fresh sign-in re-checks the flag.
      setOnboardingChecked(false);
      setShowOnboarding(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // R114 (2026-08-07): per-account onboarding key.
      const uid = useAppStore.getState().user?.id;
      const done = await hasCompletedOnboarding(uid);
      if (cancelled) return;
      setShowOnboarding(!done);
      setOnboardingChecked(true);
    })();
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  return (
    <NavigationContainer
      theme={{
        ...DefaultTheme,
        dark: visualTheme.mode === 'night',
        colors: {
          ...DefaultTheme.colors,
          primary: visualTheme.primary,
          background: visualTheme.background,
          card: visualTheme.surfaceElevated,
          text: visualTheme.foreground,
          border: visualTheme.border,
          notification: visualTheme.accent,
        },
      }}
      ref={navigationRef ?? undefined}
      onReady={() => {
        markBootPhase('navigation_container_ready', { isLoggedIn: !!isLoggedIn });
        // R113 restore: expose nav helpers + settings/sim-walker stores
        // to __cairnStores for Playwright web QA. Guarded on Platform.OS==='web'.
        try {
          if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
            const stores = (globalThis as unknown as { __cairnStores?: Record<string, unknown> }).__cairnStores ?? {};
            stores.navigationRef = navigationRef;
            stores.getCurrentRoute = () => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const ref: any = navigationRef;
              if (!ref || typeof ref.isReady !== 'function' || !ref.isReady()) return null;
              const r = ref.getCurrentRoute();
              return r ? r.name : null;
            };
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useSettingsStore = require('../store/useSettingsStore').useSettingsStore;
              // Visual-migration QA: force weather and day/night without
              // changing production weather-fetch semantics. Web-only and
              // available through the existing Playwright store bridge.
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useWeatherStore = require('../store/useWeatherStore').useWeatherStore;
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useSimWalkerStore = require('../dev/simWalker/useSimWalkerStore').useSimWalkerStore;
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.gpsInjector = require('../dev/simWalker/gpsInjector').gpsInjector;
              // Route-following: exposed so Playwright can drive turn-by-turn
              // scenarios without going through the simWalker UI. Both stores
              // stay accessible for the whole session; test cleans up.
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useTrackingStore = require('../store/useTrackingStore').useTrackingStore;
              // Auth screen QA hook — expose useAppStore so Playwright can
              // toggle isLoggedIn / setUser(null) to preview Auth without
              // going through the real sign-in flow. 2026-08-15 sleep run.
              stores.useAppStore = useAppStore;
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useRouteStore = require('../store/useRouteStore').useRouteStore;
              // Gate-1 proof fixtures use direct, in-memory Zustand setState
              // so screenshots exercise active production screens without
              // writing synthetic data to the backend.
              stores.useFriendStore = require('../store/useFriendStore').useFriendStore;
              stores.useMemoryStore = require('../features/memory/store/useMemoryStore').useMemoryStore;
              stores.useMemorySettingsStore = require('../features/memory/store/useMemorySettingsStore').useMemorySettingsStore;
              stores.useMarkerStore = require('../store/useMarkerStore').useMarkerStore;
            } catch { /* ignore */ }
            (globalThis as unknown as { __cairnStores?: unknown }).__cairnStores = stores;
          }
        } catch { /* ignore */ }
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 320,
          gestureEnabled: false,
        }}
      >
        {/* R21 (2026-08-17): removed isPlaywrightBypass gate. The bypass
            let a non-authenticated user reach Home/Settings without a real
            user object, which broke Profile / Sign out state assumptions
            downstream. Real flow only: no token → Auth; token → app.
            R21 review fix: also require `user` to be non-null so screens
            that dereference user (e.g. Settings user!.name) don't crash
            during the race window where setLoggedIn(true) fires before
            setUser is called. */}
        {(isLoggedIn && user) ? (
          <>
            <Stack.Screen name="Home"        component={HomeScreen} />
            <Stack.Screen name="Hiking"      component={HikingScreen} />
            <Stack.Screen name="Running"     component={RunningScreen} />
            <Stack.Screen name="Routes"      component={RoutesScreen} />
            <Stack.Screen name="MapHistory"  component={MapHistoryScreen} />
            <Stack.Screen name="RouteEditor" component={RouteEditorScreen} />
            <Stack.Screen name="Plant"       component={PlantScreen} />
            <Stack.Screen name="MarkerDetail" component={MarkerDetailScreen} />
            <Stack.Screen name="Friends"     component={FriendsScreen} />
            {__DEV__ && <Stack.Screen name="FriendsPreview" component={FriendsPreviewScreen} />}
            {__DEV__ && <Stack.Screen name="HomePreview" component={HomePreviewScreen} />}
            {__DEV__ && <Stack.Screen name="HikingPreview" component={HikingPreviewScreen} />}
            {__DEV__ && <Stack.Screen name="RunningPreview" component={RunningPreviewScreen} />}
            {__DEV__ && <Stack.Screen name="RoutesPreview" component={RoutesPreviewScreen} />}
            <Stack.Screen name="Settings"    component={SettingsScreen} />
            <Stack.Screen name="Memory"      component={MemoryScreen} />
            <Stack.Screen name="Debug"       component={DebugScreen} />
            {__DEV__ && <Stack.Screen name="MarkDetailDevPreview" component={MarkDetailDevPreviewScreen} />}
            {__DEV__ && <Stack.Screen name="Gate1IconSheet" component={Gate1IconSheetScreen} />}
          </>
        ) : (
          <Stack.Screen
            name="Auth"
            component={AuthScreen}
            options={{ animation: 'fade', animationDuration: 280 }}
          />
        )}
      </Stack.Navigator>
      {isLoggedIn && onboardingChecked && (
        <OnboardingModal
          visible={showOnboarding}
          onFinish={() => setShowOnboarding(false)}
        />
      )}
      {/* HOME-06: global offline banner — visible on every authenticated
          screen when the device drops offline. Hidden when logged out
          (Auth screen has no offline-dependent actions worth flagging). */}
      {isLoggedIn && <OfflineBanner />}
    </NavigationContainer>
  );
}
