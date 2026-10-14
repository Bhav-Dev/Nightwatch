import { Stack } from 'expo-router';

import { colors } from '../../ui/theme';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
      <Stack.Screen name="profile" options={{ title: 'About you' }} />
      <Stack.Screen name="sharing" options={{ title: 'Data and sharing' }} />
    </Stack>
  );
}
