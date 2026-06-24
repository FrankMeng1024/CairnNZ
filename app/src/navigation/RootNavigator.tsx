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
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

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
      onReady={() => {
        markBootPhase('navigation_container_ready', { isLoggedIn: !!isLoggedIn });
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
