import { Tabs } from 'expo-router';

import { colors } from '../../ui/theme';

export default function TabsLayout() {
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
