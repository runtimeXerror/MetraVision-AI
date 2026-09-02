import { Ionicons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '../constants/theme';
import { HistoryScreen } from '../screens/HistoryScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { InspectionDetailsScreen } from '../screens/inspection/InspectionDetailsScreen';

import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Inspect: { active: 'scan-circle', inactive: 'scan-circle-outline' },
  History: { active: 'time', inactive: 'time-outline' },
  Reports: { active: 'document-text', inactive: 'document-text-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

export function TabNavigator() {
  const insets = useSafeAreaInsets();

  // SDK 54 draws Android edge-to-edge, so the gesture bar overlays the tab bar
  // unless the inset is paid explicitly. Deriving the height from the inset
  // keeps one rule for both platforms instead of two hardcoded numbers.
  const barPaddingBottom = Math.max(insets.bottom, spacing.sm);

  return (
    <Tab.Navigator
      /**
       * Back returns to the tab you came from, not to Home.
       *
       * React Navigation defaults to `firstRoute`, which meant an officer who
       * tapped "Violations" on the Dashboard, read the list, and pressed back
       * landed on Home — two tabs from where they were working, with the
       * dashboard they were reading gone. Every drill-through in the app
       * crosses tabs, so the default was wrong for all of them.
       */
      backBehavior="history"
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.navy,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 58 + barPaddingBottom,
          paddingTop: spacing.sm,
          paddingBottom: barPaddingBottom,
        },
        tabBarLabelStyle: { ...typography.caption, fontSize: 11 },
        tabBarIcon: ({ focused, color, size }) => {
          const icon = ICONS[route.name];
          return (
            <Ionicons
              name={focused ? icon.active : icon.inactive}
              size={size - 2}
              color={color}
            />
          );
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Inspect"
        component={InspectionDetailsScreen}
        options={{ title: 'Inspect' }}
      />
      <Tab.Screen name="History" component={HistoryScreen} />
      {/* Labelled for what the screen is. It has shown a dashboard — KPIs,
          trends, violation types — since Phase 3; "Reports" described the
          filed-report list at the bottom of it and sent officers there looking
          for a single record, which lives under History. The route keeps its
          name so every existing `navigate('Reports')` still resolves. */}
      <Tab.Screen name="Reports" component={ReportsScreen} options={{ title: 'Dashboard' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
