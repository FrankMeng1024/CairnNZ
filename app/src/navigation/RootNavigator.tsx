/**
 * RootNavigator
 *
 * v0.2.5: Auth → Home → (Hiking | Running | MapHistory | ...). NO bottom
 *         tabs. Navigation from HomeScreen's ToolsRow.
 *
 * v0.2.6.4: Restored v0.2.5 model after user feedback. The brief
 * stint with BottomTabNavigator was a misread of the spec — the
 * intent is "Routes is renamed Trails, AR is renamed Memory" inside
 * the existing tools row, not a wholesale tab-bar swap.
 */
import React from 'react';
import { Platform } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

// v405: expose nav ref to Playwright web replay for asserting current
// route name after auto-nav. Guarded on Platform.OS==='web' — native
// bundle 不创建 ref instance,dSYM 里也不出现 navigationRef 符号。
// v407 fix #8: v405 只 guard 了 onReady 里的 __cairnStores 挂载,
// 但 module-level createNavigationContainerRef() 无 Platform 门,native
// 依然 create ref 对象。现在 Platform.OS === 'web' 才创建。
export const navigationRef = Platform.OS === 'web'
  ? createNavigationContainerRef()
  : null as unknown as ReturnType<typeof createNavigationContainerRef>;

import { AuthScreen } from '../screens/AuthScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { HikingScreen } from '../screens/HikingScreen';
import { RunningScreen } from '../screens/RunningScreen';
import { MapHistoryScreen } from '../screens/MapHistoryScreen';
import { MapScreen } from '../screens/MapScreen';
import { RoutesScreen } from '../screens/RoutesScreen';
import { RouteEditorScreen } from '../screens/RouteEditorScreen';
import { DebugScreen } from '../screens/DebugScreen';
import { PlantScreen } from '../screens/PlantScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { MemoryScreen } from '../features/memory/screens/MemoryScreen';
import { MarkDetailDevPreviewScreen } from '../features/marks/dev/MarkDetailDevPreviewScreen';
import { MarkerDetailScreen } from '../screens/MarkerDetailScreen';
import { useAppStore } from '../store/useAppStore';
import { markBootPhase } from '../services/bootDiagnostics';

// v302: mark immediately after all transitive imports above resolved.
// If app dies between `render_about_to_mount_root` (App.tsx) and
// `navigator_module_loaded` (here), some Screen's module-level code crashed.
markBootPhase('navigator_module_loaded');

export type RootStackParamList = {
  Auth: undefined;
  Home: undefined;
  Hiking: undefined;
  Running: undefined;
  MapHistory: { sessionId?: string } | undefined;
  Map: { focusLat?: number; focusLng?: number; focusMarkerId?: string } | undefined;
  Routes: { initialTab?: 'routes' | 'activities' | 'flags' } | undefined;
  RouteEditor: { routeId?: string; fromSessionId?: string } | undefined;
  Plant: undefined;
  MarkerDetail: { markerId: string };
  Friends: undefined;
  Settings: undefined;
  Memory: undefined;
  Debug: undefined;
  /** Sprint 68 STORY-00532: dev-only preview for MarkDetailSheet 4 forms. */
  MarkDetailDevPreview: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isLoggedIn } = useAppStore();
  markBootPhase('navigator_body_running', { isLoggedIn: !!isLoggedIn });

  // v312 anchor: just before NavigationContainer JSX. If we see this
  // beacon but no `navigation_container_ready`, the death is inside
  // NavigationContainer's mount.
  markBootPhase('navigator_before_jsx');

  return (
    <NavigationContainer
      ref={navigationRef ?? undefined}
      onReady={() => {
        markBootPhase('navigation_container_ready', { isLoggedIn: !!isLoggedIn });
        // v405: expose nav helpers to __cairnStores for Playwright replay
        try {
          if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
            const stores = (globalThis as unknown as { __cairnStores?: Record<string, unknown> }).__cairnStores ?? {};
            stores.navigationRef = navigationRef;
            stores.getCurrentRoute = () => navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : null;
            // v446: expose settings + sim-walker stores for Playwright web QA.
            // Lazy-require so production bundles that lock-tree-shake these
            // can't accidentally include them.
            try {
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useSettingsStore = require('../store/useSettingsStore').useSettingsStore;
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.useSimWalkerStore = require('../dev/simWalker/useSimWalkerStore').useSimWalkerStore;
              // eslint-disable-next-line @typescript-eslint/no-require-imports
              stores.gpsInjector = require('../dev/simWalker/gpsInjector').gpsInjector;
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
        {isLoggedIn ? (
          <>
            <Stack.Screen name="Home"        component={HomeScreen} />
            <Stack.Screen name="Hiking"      component={HikingScreen} />
            <Stack.Screen name="Running"     component={RunningScreen} />
            <Stack.Screen name="Routes"      component={RoutesScreen} />
            <Stack.Screen name="MapHistory"  component={MapHistoryScreen} />
            <Stack.Screen name="Map"         component={MapScreen} />
            <Stack.Screen name="RouteEditor" component={RouteEditorScreen} />
            <Stack.Screen name="Plant"       component={PlantScreen} />
            <Stack.Screen name="MarkerDetail" component={MarkerDetailScreen} />
            <Stack.Screen name="Friends"     component={FriendsScreen} />
            <Stack.Screen name="Settings"    component={SettingsScreen} />
            <Stack.Screen name="Memory"      component={MemoryScreen} />
            <Stack.Screen name="Debug"       component={DebugScreen} />
            <Stack.Screen name="MarkDetailDevPreview" component={MarkDetailDevPreviewScreen} />
          </>
        ) : (
          <Stack.Screen
            name="Auth"
            component={AuthScreen}
            options={{ animation: 'fade', animationDuration: 280 }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
