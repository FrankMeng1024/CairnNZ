/**
 * BottomTabNavigator — v0.2.6.1: 4-tab bottom bar with restored icons.
 *
 *   Trails (= v0.2.5 HomeScreen) | Friends | Memory | Settings
 *
 * Per user feedback (2026-06-19): emoji icons looked cheap. Replaced
 * with the same Lucide icons used elsewhere in the app, so the bottom
 * bar matches the rest of the visual system. Labels stay as the
 * v0.2.6 names.
 */

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { FriendsScreen } from '../screens/FriendsScreen';
import { MemoryScreen } from '../features/memory/screens/MemoryScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { Icon } from '../components/Icon';
import { Colors } from '../components/tokens';

const Tab = createBottomTabNavigator();

interface TabDef {
  name: string;
  component: React.ComponentType<any>;
  iconName: 'Mountain' | 'Users' | 'BookOpen' | 'Settings2';
  label: string;
}

const TAB_CONFIG: TabDef[] = [
  { name: 'Trails',   component: HomeScreen,     iconName: 'Mountain',   label: 'Trails' },
  { name: 'Friends',  component: FriendsScreen,  iconName: 'Users',      label: 'Friends' },
  { name: 'Memory',   component: MemoryScreen,   iconName: 'BookOpen',   label: 'Memory' },
  { name: 'Settings', component: SettingsScreen, iconName: 'Settings2',  label: 'Settings' },
];

export function BottomTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: {
          backgroundColor: Colors.surface,
          borderTopColor: Colors.border,
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
            tabBarIcon: ({ color, size }) => (
              <Icon name={tab.iconName} size={size ?? 22} color={color} strokeWidth={2} />
            ),
          }}
        />
      ))}
    </Tab.Navigator>
  );
}
