import { Redirect, Tabs } from 'expo-router';

import { useApp } from '../../state/AppContext';
import { colors } from '../../ui/theme';

export default function TabsLayout() {
  const { session } = useApp();
  // An account is always required; signing out (or a revoked session) lands back here.
  if (session === null) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="tonight" options={{ title: 'Tonight' }} />
      <Tabs.Screen name="morning" options={{ title: 'This Morning' }} />
      <Tabs.Screen name="remedies" options={{ title: 'Remedies' }} />
      <Tabs.Screen name="trends" options={{ title: 'Trends' }} />
    </Tabs>
  );
}
