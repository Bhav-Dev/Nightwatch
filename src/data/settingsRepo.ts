import type { Db } from './db';

export type SettingKey =
  | 'sensitivity'
  /** '0' turns off keeping the night's sound; unset or '1' means on. */
  | 'sound_recording'
  /** Sleep sounds to play while falling asleep: 'white' | 'pink' | 'brown'; unset means off. */
  | 'sleep_sound'
  | 'sleep_sound_minutes'
  /** Weather on This Morning: 'on' (location allowed) | 'off'; unset means not asked yet. */
  | 'weather'
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
  | 'contribution_opted_in'
  /** When the night recap arrives: '10:00' | '12:30' | '18:30' | 'off'; unset means 12:30. */
  | 'recap_time'
  /** When we asked for an app store review: a JSON list of epoch seconds. */
  | 'review_asked_at'
  /** Anonymous usage counts (PostHog): '0' is off; unset or '1' is on. */
  | 'usage_analytics'
  /** The random id usage counts are sent under; never the account. Removed when usage counts are turned off. */
  | 'analytics_install_id'
  /**
   * Labelling mode, internal builds only: '1' keeps every second of the night's sound (not only
   * the parts with sound) so volunteers' nights can be exported and labelled; unset or '0' is off.
   */
  | 'labelling_mode';

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
