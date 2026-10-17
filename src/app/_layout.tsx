import { Nunito_700Bold, Nunito_800ExtraBold, useFonts } from '@expo-google-fonts/nunito';
import { randomUUID } from 'expo-crypto';
import { router, Stack } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';

import { ExpoClipFiles } from '../clips/expoClipFiles';
import type { Db } from '../data/db';
import { initDatabase } from '../data/init';
import { tidySoundFiles } from '../native/soundWriter';
import { watchNotificationLinks } from '../notifications';
import { recoverAbandonedSessions } from '../recording/recordingSession';
import { AppProvider } from '../state/AppContext';
import { colors } from '../ui/theme';

async function onInit(db: Db) {
  await initDatabase(db);
  // A recording the app never got to stop (killed overnight) becomes a partial night.
  await recoverAbandonedSessions(db, randomUUID, new ExpoClipFiles());
  // Sound past its keeping period, and half-written segments, go. Never blocks opening the app.
  await tidySoundFiles(db).catch((e) => console.warn('Tidying sound files failed', e));
}

const header = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerShadowVisible: false,
} as const;

/** A tapped notification (the night recap) opens the screen it points at. */
function NotificationLinks() {
  useEffect(() => watchNotificationLinks((url) => router.push(url as Parameters<typeof router.push>[0])), []);
  return null;
}

export default function RootLayout() {
  // Headings use Nunito; wait for it (a moment on first launch) so text never jumps.
  const [fontsLoaded, fontError] = useFonts({ Nunito_700Bold, Nunito_800ExtraBold });
  if (!fontsLoaded && !fontError) return null;
  return (
    <SQLiteProvider databaseName="nightwatch.db" onInit={onInit}>
      <AppProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="recording" options={{ gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="paywall" options={{ presentation: 'modal' }} />
          <Stack.Screen name="settings" />
          <Stack.Screen name="night/[id]" options={{ ...header, title: '' }} />
          <Stack.Screen name="remedy/[id]" options={{ ...header, title: '' }} />
          <Stack.Screen name="experiment/[remedyId]" options={{ ...header, title: 'Remedy test', presentation: 'modal' }} />
          <Stack.Screen name="report" options={{ ...header, title: "Doctor's report" }} />
          <Stack.Screen name="auth" />
        </Stack>
        <NotificationLinks />
      </AppProvider>
    </SQLiteProvider>
  );
}
