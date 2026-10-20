import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { Pressable } from 'react-native';

import { colors } from '../../ui/theme';

/**
 * Settings is a stack of its own, so its first screen has nothing behind it in this stack and the
 * platform draws no back button there. This one leaves Settings (or goes to the start screen
 * when Settings was opened with nothing behind it).
 */
function LeaveSettings() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={12}
      onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      style={{ paddingRight: 8 }}
    >
      <Ionicons name="chevron-back" size={28} color={colors.text} />
    </Pressable>
  );
}

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
      <Stack.Screen name="index" options={{ title: 'Settings', headerLeft: () => <LeaveSettings /> }} />
      <Stack.Screen name="profile" options={{ title: 'About you' }} />
      <Stack.Screen name="sharing" options={{ title: 'Data and sharing' }} />
    </Stack>
  );
}
