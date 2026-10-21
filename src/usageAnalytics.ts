import Constants from 'expo-constants';
import { randomUUID } from 'expo-crypto';
import { AppState, Platform } from 'react-native';

import { setAnalyticsSink } from './analytics';
import { config } from './config';
import type { Db } from './data/db';
import { getSetting, setSetting } from './data/settingsRepo';
import { PostHogClient } from './posthog';

/**
 * Anonymous usage counts (the events in analytics.ts) to PostHog, from release builds that have
 * a key. Development builds keep printing events to the console. On unless the person turns it
 * off in Settings; the choice and a random install id live in the settings table.
 */
const client =
  config.posthogKey && !__DEV__
    ? new PostHogClient({
        apiKey: config.posthogKey,
        host: config.posthogHost,
        properties: {
          $os: Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : Platform.OS,
          $os_version: String(Platform.Version),
          $app_version: Constants.expoConfig?.version ?? null,
          internal_build: config.internalTools,
        },
      })
    : null;

if (client) {
  // Set at import, so events from the first render wait for start() instead of being lost.
  setAnalyticsSink(client.sink);
  AppState.addEventListener('change', (s) => {
    if (s === 'background') void client.flush();
  });
}

export async function usageAnalyticsOn(db: Db): Promise<boolean> {
  return (await getSetting(db, 'usage_analytics')) !== '0';
}

async function installId(db: Db): Promise<string> {
  let id = await getSetting(db, 'analytics_install_id');
  if (!id) {
    id = randomUUID();
    await setSetting(db, 'analytics_install_id', id);
  }
  return id;
}

/** Once the database is open: sends the waiting events, or drops them if usage counts are off. */
export async function startUsageAnalytics(db: Db): Promise<void> {
  if (!client) return;
  const on = await usageAnalyticsOn(db);
  client.start(on ? await installId(db) : '', on);
}

/** The Settings switch. Turning it off also forgets the install id, so turning it back on starts afresh. */
export async function setUsageAnalytics(db: Db, on: boolean): Promise<void> {
  await setSetting(db, 'usage_analytics', on ? '1' : '0');
  if (!on) await setSetting(db, 'analytics_install_id', null);
  if (!client) return;
  if (on) client.start(await installId(db), true);
  else client.setEnabled(false);
}
