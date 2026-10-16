import Ionicons from '@expo/vector-icons/Ionicons';
import { Redirect, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

import { useApp } from '../../state/AppContext';
import { colors, fonts } from '../../ui/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

function icon(outline: IconName, filled: IconName) {
  return function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? filled : outline} size={size - 2} color={color} />;
  };
}

export default function TabsLayout() {
  const { session } = useApp();
  // An account is always required; signing out (or a revoked session) lands back here.
  if (session === null) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.tabBar, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarLabelStyle: { fontSize: 12, fontFamily: fonts.headingSemi },
      }}
    >
      <Tabs.Screen name="tonight" options={{ title: 'Tonight', tabBarIcon: icon('moon-outline', 'moon') }} />
      <Tabs.Screen name="morning" options={{ title: 'This Morning', tabBarIcon: icon('sunny-outline', 'sunny') }} />
      <Tabs.Screen name="remedies" options={{ title: 'Remedies', tabBarIcon: icon('leaf-outline', 'leaf') }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends', tabBarIcon: icon('stats-chart-outline', 'stats-chart') }} />
    </Tabs>
  );
}
