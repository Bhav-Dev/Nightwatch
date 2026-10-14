/**
 * Two-way sync of night summaries (never audio, never raw Health samples). Free of React
 * Native imports so it is tested against node:sqlite with a fake API.
 *
 * Push: nights whose synced_at is null or older than updated_at, in batches; deletions from
 * sync_tombstone; the profile when its local version is ahead of the last synced version.
 * Pull: nights changed on the server since the stored cursor (other devices).
 */
import type { NightDto } from '../../shared/api';
import type { ApiClient } from '../api/client';
import type { Db } from '../data/db';
import { getProfile, saveProfile } from '../data/profileRepo';
import { getSetting, setSetting } from '../data/settingsRepo';

export const PUSH_BATCH = 50;

type Api = Pick<ApiClient, 'pushNights' | 'pullNights' | 'deleteNight' | 'putProfile' | 'getProfile'>;

interface NightRowForSync {
  id: string;
  date: string;
  duration_s: number;
  time_in_bed_s: number;
  score: number;
  score_version: number;
  pct_snoring: number;
  event_count: number;
  max_db: number;
  partial: number;
  typical: number | null;
  updated_at: number;
}

async function toDto(db: Db, n: NightRowForSync): Promise<NightDto> {
  const remedies = await db.getAllAsync<{ remedy_id: string }>('SELECT remedy_id FROM remedy_log WHERE night_id = ?', [n.id]);
  const factors = await db.getAllAsync<{ factor_id: string; value: string | null }>('SELECT factor_id, value FROM factor_log WHERE night_id = ?', [n.id]);
  const health = await db.getFirstAsync<NonNullable<NightDto['health']>>(
    'SELECT sleep_efficiency, spo2_min, spo2_dips, hr_mean, hr_max, hrv_mean, resp_mean FROM health_summary WHERE night_id = ?',
    [n.id],
  );
  return {
    id: n.id,
    date: n.date,
    duration_s: n.duration_s,
    time_in_bed_s: n.time_in_bed_s,
    score: n.score,
    score_version: n.score_version,
    pct_snoring: n.pct_snoring,
    event_count: n.event_count,
    max_db: n.max_db,
    partial: n.partial === 1,
    typical: n.typical === null ? null : n.typical === 1,
    health: health ?? null,
    remedies: remedies.map((r) => r.remedy_id),
    factors: factors.map((f) => ({ id: f.factor_id, value: f.value })),
    updated_at: new Date(n.updated_at * 1000).toISOString(),
  };
}

export interface SyncResult {
  pushed: number;
  rejected: { id: string; reason: string }[];
  deleted: number;
  pulled: number;
  profile: 'pushed' | 'pulled' | 'unchanged';
}

export async function syncNow(db: Db, api: Api, deviceId: string): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, rejected: [], deleted: 0, pulled: 0, profile: 'unchanged' };

  // Deletions first, so a deleted night is never re-pushed or re-pulled.
  const tombstones = await db.getAllAsync<{ night_id: string }>('SELECT night_id FROM sync_tombstone', []);
  for (const t of tombstones) {
    await api.deleteNight(t.night_id);
    await db.runAsync('DELETE FROM sync_tombstone WHERE night_id = ?', [t.night_id]);
    result.deleted++;
  }

  for (;;) {
    const dirty = await db.getAllAsync<NightRowForSync>(
      `SELECT id, date, duration_s, time_in_bed_s, score, score_version, pct_snoring, event_count, max_db, partial, typical, updated_at
       FROM night WHERE source = 'local' AND (synced_at IS NULL OR synced_at < updated_at) ORDER BY started_at LIMIT ?`,
      [PUSH_BATCH],
    );
    if (dirty.length === 0) break;
    const res = await api.pushNights({ device_id: deviceId, nights: await Promise.all(dirty.map((n) => toDto(db, n))) });
    // synced_at records the version that was sent, so an edit made meanwhile stays dirty.
    const sentVersion = new Map(dirty.map((d) => [d.id, d.updated_at]));
    for (const id of res.accepted) {
      await db.runAsync('UPDATE night SET synced_at = ? WHERE id = ?', [sentVersion.get(id) ?? 0, id]);
    }
    result.pushed += res.accepted.length;
    result.rejected.push(...res.rejected);
    // A rejected version is not retried, so one bad row does not block the queue forever.
    for (const r of res.rejected) await db.runAsync('UPDATE night SET synced_at = ? WHERE id = ?', [sentVersion.get(r.id) ?? 0, r.id]);
    if (dirty.length < PUSH_BATCH) break;
  }

  const cursor = await getSetting(db, 'sync_cursor');
  const pulled = await api.pullNights(cursor);
  for (const n of pulled.nights) {
    if (await upsertRemoteNight(db, n)) result.pulled++;
  }
  await setSetting(db, 'sync_cursor', pulled.cursor);

  const local = await getProfile(db);
  const syncedVersion = Number((await getSetting(db, 'profile_synced_version')) ?? '0');
  if (local.version > syncedVersion) {
    const res = await api.putProfile({ ...local.profile, version: local.version });
    await setSetting(db, 'profile_synced_version', String(res.version));
    result.profile = 'pushed';
  } else {
    const remote = await api.getProfile().catch(() => null);
    if (remote && remote.version > local.version) {
      const { version, ...bands } = remote;
      await saveProfile(db, bands, version);
      await setSetting(db, 'profile_synced_version', String(version));
      result.profile = 'pulled';
    }
  }
  return result;
}

/**
 * Applies a night from another device. A night recorded here is the source of truth for its
 * audio-derived numbers, so only its log and typical flag are taken from the server, and only
 * when the server copy is newer.
 */
export async function upsertRemoteNight(db: Db, n: NightDto): Promise<boolean> {
  const updatedS = Math.floor(new Date(n.updated_at).getTime() / 1000);
  const existing = await db.getFirstAsync<{ updated_at: number; source: string }>('SELECT updated_at, source FROM night WHERE id = ?', [n.id]);
  if (existing && existing.updated_at >= updatedS) return false;
  if (await db.getFirstAsync<{ night_id: string }>('SELECT night_id FROM sync_tombstone WHERE night_id = ?', [n.id])) return false;

  await db.withTransactionAsync(async () => {
    if (!existing) {
      const started = Math.floor(new Date(`${n.date.slice(0, 10)}T23:00:00`).getTime() / 1000);
      await db.runAsync(
        `INSERT INTO night (id, date, started_at, ended_at, duration_s, time_in_bed_s, score, score_version, pct_snoring,
           event_count, max_db, floor_db, partial, counts_toward_averages, typical, updated_at, synced_at, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'remote')`,
        [
          n.id, n.date, started, started + n.duration_s, n.duration_s, n.time_in_bed_s, n.score, n.score_version, n.pct_snoring,
          n.event_count, n.max_db, n.partial ? 1 : 0, n.partial && n.time_in_bed_s < 3 * 3600 ? 0 : 1,
          n.typical === null ? null : n.typical ? 1 : 0, updatedS, updatedS,
        ],
      );
    } else {
      await db.runAsync('UPDATE night SET typical = ?, updated_at = ?, synced_at = ? WHERE id = ?', [
        n.typical === null ? null : n.typical ? 1 : 0,
        updatedS,
        updatedS,
        n.id,
      ]);
    }
    await db.runAsync('DELETE FROM remedy_log WHERE night_id = ?', [n.id]);
    await db.runAsync('DELETE FROM factor_log WHERE night_id = ?', [n.id]);
    for (const r of n.remedies) await db.runAsync('INSERT INTO remedy_log (night_id, remedy_id) VALUES (?, ?)', [n.id, r]);
    for (const f of n.factors) await db.runAsync('INSERT INTO factor_log (night_id, factor_id, value) VALUES (?, ?, ?)', [n.id, f.id, f.value]);
    if (n.health && !existing) {
      const h = n.health;
      await db.runAsync(
        'INSERT OR REPLACE INTO health_summary (night_id, sleep_efficiency, spo2_min, spo2_dips, hr_mean, hr_max, hrv_mean, resp_mean) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [n.id, h.sleep_efficiency, h.spo2_min, h.spo2_dips, h.hr_mean, h.hr_max, h.hrv_mean, h.resp_mean],
      );
    }
  });
  return true;
}
