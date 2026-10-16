import type { Db } from './db';

export type SettingKey =
  | 'sensitivity'
  /** '0' turns off keeping the night's sound; unset or '1' means on. */
  | 'sound_recording'
  | 'landing_tab'
  | 'contribution'
  | 'pending_prefilled_for'
  | 'onboarding_complete'
  | 'device_id'
  | 'sync_cursor'
  | 'profile_synced_version'
  | 'bedtime_reminder'
  | 'health_prompted_after'
  | 'paywall_seen_for'
  | 'region'
  | 'catalogue_amazon_tags'
  | 'dev_paid'
  | 'contribution_seen'
  | 'health_enabled'
  | 'auto_stop_hour'
  | 'contribution_opted_in';

export async function getSetting(db: Db, key: SettingKey): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSetting(db: Db, key: SettingKey, value: string | null): Promise<void> {
  if (value === null) {
    await db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  } else {
    await db.runAsync(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }
}
