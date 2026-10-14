import type { HealthSummaryDto } from '../../shared/api';
import type { AlignedSample } from '../domain/health';
import type { Db } from './db';

/** Replaces a night's Health samples and summary (import can be re-run). */
export async function storeHealth(db: Db, nightId: string, samples: readonly AlignedSample[], summary: HealthSummaryDto): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM health_sample WHERE night_id = ?', [nightId]);
    for (const s of samples) {
      await db.runAsync('INSERT INTO health_sample (night_id, kind, start_s, end_s, value, stage) VALUES (?, ?, ?, ?, ?, ?)', [
        nightId,
        s.kind,
        s.startS,
        s.endS,
        s.value,
        s.stage,
      ]);
    }
    await db.runAsync(
      `INSERT INTO health_summary (night_id, sleep_efficiency, spo2_min, spo2_dips, hr_mean, hr_max, hrv_mean, resp_mean)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(night_id) DO UPDATE SET sleep_efficiency = excluded.sleep_efficiency, spo2_min = excluded.spo2_min,
         spo2_dips = excluded.spo2_dips, hr_mean = excluded.hr_mean, hr_max = excluded.hr_max,
         hrv_mean = excluded.hrv_mean, resp_mean = excluded.resp_mean`,
      [nightId, summary.sleep_efficiency, summary.spo2_min, summary.spo2_dips, summary.hr_mean, summary.hr_max, summary.hrv_mean, summary.resp_mean],
    );
    const now = Math.floor(Date.now() / 1000);
    await db.runAsync('UPDATE night SET health_imported_at = ?, updated_at = MAX(updated_at + 1, ?) WHERE id = ?', [now, now, nightId]);
  });
}

export async function healthSamples(db: Db, nightId: string): Promise<AlignedSample[]> {
  const rows = await db.getAllAsync<{ kind: AlignedSample['kind']; start_s: number; end_s: number; value: number | null; stage: AlignedSample['stage'] }>(
    'SELECT kind, start_s, end_s, value, stage FROM health_sample WHERE night_id = ? ORDER BY start_s',
    [nightId],
  );
  return rows.map((r) => ({ kind: r.kind, startS: r.start_s, endS: r.end_s, value: r.value, stage: r.stage }));
}

export async function healthSummary(db: Db, nightId: string): Promise<HealthSummaryDto | null> {
  return db.getFirstAsync<HealthSummaryDto>(
    'SELECT sleep_efficiency, spo2_min, spo2_dips, hr_mean, hr_max, hrv_mean, resp_mean FROM health_summary WHERE night_id = ?',
    [nightId],
  );
}
