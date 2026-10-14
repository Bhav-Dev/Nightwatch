import { randomUUID } from 'expo-crypto';
import { Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';

import type { Db } from '../data/db';
import { initDatabase } from '../data/init';
import { recoverAbandonedSessions } from '../recording/recordingSession';
import { colors } from '../ui/theme';

async function onInit(db: Db) {
  await initDatabase(db);
  // A recording the app never got to stop (killed overnight) becomes a partial night.
  await recoverAbandonedSessions(db, randomUUID);
}

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName="nightwatch.db" onInit={onInit}>
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
