import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import { initDatabase } from '../data/init';
import { colors } from '../ui/theme';

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="nightwatch.db" onInit={initDatabase}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="recording" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen
          name="settings"
          options={{
            headerShown: true,
            title: 'Settings',
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.text,
          }}
        />
      </Stack>
    </SQLiteProvider>
  );
}
