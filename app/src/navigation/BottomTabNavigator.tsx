/**
 * BottomTabNavigator — v0.2.6 introduces a 4-tab bottom bar:
 *   Trails | Friends | Memory | Settings
 *
 * The previous Home page (HomeScreen) is no longer used as a hub — its
 * activity-card content (Hiking / Running buttons) moves into the
 * Trails tab. The AR tool button is gone (AR feature sealed in v0.2.6).
 *
 * This component is plugged into RootNavigator after the Auth stack
 * — see RootNavigator.tsx for the integration point.
 *
 * Tabs are described declaratively in TAB_CONFIG so adding/reordering
 * doesn't require editing JSX. Each tab points to a screen component
 * and a tabBarIcon.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TrailsScreen } from '../screens/TrailsScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { MemoryScreen } from '../features/memory/screens/MemoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Text } from 'react-native';
import { MemoryColors } from '../features/memory/config/memoryConfig';

const Tab = createBottomTabNavigator();

interface TabDef {
  name: string;
  component: React.ComponentType<any>;
  icon: string;
  label: string;
}

const TAB_CONFIG: TabDef[] = [
  { name: 'Trails',   component: TrailsScreen,   icon: '🥾', label: 'Trails' },
  { name: 'Friends',  component: FriendsScreen,  icon: '👥', label: 'Friends' },
  { name: 'Memory',   component: MemoryScreen,   icon: '📓', label: 'Memory' },
  { name: 'Settings', component: SettingsScreen, icon: '⚙️', label: 'Settings' },
];

export function BottomTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: MemoryColors.sepia,
        tabBarInactiveTintColor: '#b5a890',
        tabBarStyle: {
          backgroundColor: '#fff',
          borderTopColor: '#e8dfc8',
        },
      }}
    >
      {TAB_CONFIG.map((tab) => (
        <Tab.Screen
          key={tab.name}
          name={tab.name}
          component={tab.component}
          options={{
            tabBarLabel: tab.label,
            tabBarIcon: () => <Text style={{ fontSize: 18 }}>{tab.icon}</Text>,
          }}
        />
      ))}
    </Tab.Navigator>
  );
}
