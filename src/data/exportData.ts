import type { Db } from './db';

const CSV_COLUMNS = [
  'date', 'started_at', 'ended_at', 'time_in_bed_min', 'score', 'score_version', 'pct_snoring', 'event_count',
  'loudest_db_above_floor', 'partial', 'typical', 'remedies', 'factors', 'spo2_min', 'spo2_dips', 'hr_mean', 'sleep_efficiency',
] as const;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface ExportNight {
  id: string;
  date: string;
  started_at: string;
  ended_at: string;
  time_in_bed_min: number;
  score: number;
  score_version: number;
  pct_snoring: number;
  event_count: number;
  loudest_db_above_floor: number;
  partial: boolean;
  typical: boolean | null;
  remedies: string[];
  factors: { id: string; value: string | null }[];
  health: { spo2_min: number | null; spo2_dips: number | null; hr_mean: number | null; sleep_efficiency: number | null } | null;
  events: { start_s: number; end_s: number; peak_db: number; intensity: string }[];
  /** The user's "was this snoring?" answers; `events` and `score` already include them. */
  answers: { start_s: number; end_s: number; label: string }[];
  score_before_answers: number | null;
}

/** Everything the user has, without audio: nights, logs, events, Health summaries, profile, experiments. */
export async function exportAll(db: Db): Promise<{ json: string; csv: string }> {
  const nights = await db.getAllAsync<Record<string, number | string | null>>('SELECT * FROM night ORDER BY started_at', []);
  const out: ExportNight[] = [];
  for (const n of nights) {
    const id = n.id as string;
    const remedies = await db.getAllAsync<{ remedy_id: string }>('SELECT remedy_id FROM remedy_log WHERE night_id = ?', [id]);
    const factors = await db.getAllAsync<{ factor_id: string; value: string | null }>('SELECT factor_id, value FROM factor_log WHERE night_id = ?', [id]);
    const health = await db.getFirstAsync<ExportNight['health']>('SELECT spo2_min, spo2_dips, hr_mean, sleep_efficiency FROM health_summary WHERE night_id = ?', [id]);
    const events = await db.getAllAsync<ExportNight['events'][number]>('SELECT start_s, end_s, peak_db, intensity FROM event WHERE night_id = ? ORDER BY start_s', [id]);
    const answers = await db.getAllAsync<ExportNight['answers'][number]>('SELECT start_s, end_s, label FROM sound_label WHERE night_id = ? ORDER BY created_at', [id]);
    out.push({
      id,
      date: n.date as string,
      started_at: new Date((n.started_at as number) * 1000).toISOString(),
      ended_at: new Date((n.ended_at as number) * 1000).toISOString(),
      time_in_bed_min: Math.round((n.time_in_bed_s as number) / 60),
      score: n.score as number,
      score_version: n.score_version as number,
      pct_snoring: n.pct_snoring as number,
      event_count: n.event_count as number,
      loudest_db_above_floor: n.max_db as number,
      partial: n.partial === 1,
      typical: n.typical === null ? null : n.typical === 1,
      remedies: remedies.map((r) => r.remedy_id),
      factors: factors.map((f) => ({ id: f.factor_id, value: f.value })),
      health,
      events,
      answers,
      score_before_answers: (n.detector_score as number | null) ?? null,
    });
  }
  const profile = await db.getFirstAsync<Record<string, unknown>>('SELECT * FROM profile WHERE id = 1', []);
  const experiments = await db.getAllAsync<Record<string, unknown>>('SELECT * FROM experiment', []);

  const rows = out.map((n) =>
    [
      n.date, n.started_at, n.ended_at, n.time_in_bed_min, n.score, n.score_version, n.pct_snoring.toFixed(3), n.event_count,
      n.loudest_db_above_floor.toFixed(1), n.partial, n.typical, n.remedies.join(';'),
      n.factors.map((f) => (f.value ? `${f.id}=${f.value}` : f.id)).join(';'),
      n.health?.spo2_min, n.health?.spo2_dips, n.health?.hr_mean, n.health?.sleep_efficiency,
    ]
      .map(csvCell)
      .join(','),
  );
  return {
    json: JSON.stringify({ exported_at: new Date().toISOString(), profile, experiments, nights: out }, null, 2),
    csv: [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n',
  };
}

/** Deletes every local row (Settings → Delete all local data). Clip and sound files are removed by the caller. */
export async function deleteAllLocalData(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of [
      'event', 'event_detected', 'sound_label', 'bin', 'health_sample', 'health_summary', 'remedy_log', 'factor_log', 'pending_log', 'experiment', 'snapshot',
      'clip', 'sound_segment', 'night_weather', 'session_weather', 'session_frame', 'session_gap', 'recording_session', 'sync_tombstone', 'cache', 'night', 'profile',
    ]) {
      await db.runAsync(`DELETE FROM ${t}`, []);
    }
    await db.runAsync("DELETE FROM settings WHERE key NOT IN ('device_id')", []);
  });
}
