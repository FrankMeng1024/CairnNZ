/**
 * RootNavigator
 *
 * v0.2.5 (legacy):  Auth → Home → (Hiking | Running | MapHistory | ...)
 *                   NO bottom tabs. All navigation from Home page.
 *
 * v0.2.6 (current): Auth → MainTabs (Trails | Friends | Memory | Settings)
 *                   AR feature sealed (entry removed; code retained).
 *                   HomeScreen kept in the codebase as a deprecated fallback;
 *                   not registered in the new navigator.
 *
 * The transition is controlled by NAVIGATOR_VERSION below — a single
 * source of truth that flips the entire shape of the app's nav. This is
 * intentionally NOT a runtime feature flag because navigation shape
 * changes deserve a deliberate code-level decision.
 */
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { AuthScreen } from '../screens/AuthScreen';
import { HikingScreen } from '../screens/HikingScreen';
import { RunningScreen } from '../screens/RunningScreen';
import { MapHistoryScreen } from '../screens/MapHistoryScreen';
import { MapScreen } from '../screens/MapScreen';
import { RoutesScreen } from '../screens/RoutesScreen';
import { RouteEditorScreen } from '../screens/RouteEditorScreen';
import { DebugScreen } from '../screens/DebugScreen';
import { PlantScreen } from '../screens/PlantScreen';
import { BottomTabNavigator } from './BottomTabNavigator';
import { useAppStore } from '../store/useAppStore';

export type RootStackParamList = {
  Auth: undefined;
  /** Tab bar root (4 tabs). Replaces the old "Home" stack screen. */
  MainTabs: undefined;
  Hiking: undefined;
  Running: undefined;
  MapHistory: { sessionId?: string } | undefined;
  Map: { focusLat?: number; focusLng?: number; focusMarkerId?: string } | undefined;
  Routes: { initialTab?: 'routes' | 'activities' | 'flags' } | undefined;
  RouteEditor: { routeId?: string; fromSessionId?: string } | undefined;
  Plant: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { isLoggedIn } = useAppStore();

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: 'ios_from_right',
          animationDuration: 320,
          // v242: disable swipe-back globally per PO. The left-edge swipe
          // was conflicting with in-screen drag gestures (trim slider's
          // green handle, scrollable cards). Users could trigger an
          // accidental back navigation by drag-starting too close to the
          // screen edge. Use the explicit BackButton instead.
          gestureEnabled: false,
        }}
      >
        {isLoggedIn ? (
          <>
            {/* MainTabs is the new root post-login. Friends/Settings are
                tabs and live INSIDE MainTabs — they're no longer stack
                screens. AR was here in v0.2.5 and is now removed. */}
            <Stack.Screen name="MainTabs" component={BottomTabNavigator} />
            <Stack.Screen name="Hiking"      component={HikingScreen} />
            <Stack.Screen name="Running"     component={RunningScreen} />
            <Stack.Screen name="Routes"      component={RoutesScreen} />
            <Stack.Screen name="MapHistory"  component={MapHistoryScreen} />
            <Stack.Screen name="Map"         component={MapScreen} />
            <Stack.Screen name="RouteEditor" component={RouteEditorScreen} />
            <Stack.Screen name="Plant"       component={PlantScreen} />
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
