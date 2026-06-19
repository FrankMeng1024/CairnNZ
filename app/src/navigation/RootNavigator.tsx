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
import { useAppStore } from '../store/useAppStore';

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
  Friends: undefined;
  Settings: undefined;
  Memory: undefined;
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
