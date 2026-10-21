import { personalDifference } from '../../shared/remedyEffect';
import { listActiveCatalogue } from '../data/catalogueRepo';
import type { Db } from '../data/db';
import { nightSummaries } from '../data/historyRepo';
import { getProfile } from '../data/profileRepo';
import { loadSnoreProfile } from '../data/snoreProfileRepo';
import type { ReportComparison, ReportData, ReportNight } from './reportHtml';

/** Gathers a date range's nights into report data (all on the phone; nothing is uploaded). */
export async function buildReportData(db: Db, from: string, to: string): Promise<ReportData> {
  const rows = await db.getAllAsync<{
    id: string;
    date: string;
    score: number;
    pct_snoring: number;
    time_in_bed_s: number;
    partial: number;
    spo2_dips: number | null;
    spo2_min: number | null;
  }>(
    `SELECT n.id, n.date, n.score, n.pct_snoring, n.time_in_bed_s, n.partial, h.spo2_dips, h.spo2_min
     FROM night n LEFT JOIN health_summary h ON h.night_id = n.id
     WHERE substr(n.date, 1, 10) BETWEEN ? AND ? ORDER BY n.started_at`,
    [from, to],
  );
  const counts = await db.getAllAsync<{ night_id: string; intensity: string; n: number }>(
    `SELECT e.night_id, e.intensity, COUNT(*) AS n FROM event e JOIN night n ON n.id = e.night_id
     WHERE substr(n.date, 1, 10) BETWEEN ? AND ? GROUP BY e.night_id, e.intensity`,
    [from, to],
  );
  const nights: ReportNight[] = rows.map((r) => {
    const ev = { quiet: 0, light: 0, loud: 0, epic: 0 };
    for (const c of counts) if (c.night_id === r.id) ev[c.intensity as keyof typeof ev] = c.n;
    return {
      date: r.date.slice(0, 10),
      score: r.score,
      pctSnoring: r.pct_snoring,
      timeInBedS: r.time_in_bed_s,
      partial: r.partial === 1,
      events: ev,
      spo2Dips: r.spo2_dips,
      spo2Min: r.spo2_min,
    };
  });

  const history = (await nightSummaries(db)).filter((n) => n.date.slice(0, 10) >= from && n.date.slice(0, 10) <= to);
  const catalogue = await listActiveCatalogue(db);
  const compare = (type: 'remedy' | 'factor'): ReportComparison[] =>
    catalogue
      .filter((c) => c.type === type)
      .map((c) => {
        const has = (n: (typeof history)[number]) => (type === 'remedy' ? n.remedies.includes(c.id) : n.factors.some((f) => f.id === c.id));
        const w = history.filter(has).length;
        return { name: c.name, nightsWith: w, nightsWithout: history.length - w, difference: personalDifference(history, c.id) };
      })
      .filter((r) => r.nightsWith > 0)
      .sort((a, b) => b.nightsWith - a.nightsWith);

  const { profile } = await getProfile(db);
  const snore = await loadSnoreProfile(db);
  // Heavy breathing in the period, on the nights that were checked for it.
  const checked = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM night WHERE breathing_checked = 1 AND substr(date, 1, 10) BETWEEN ? AND ?',
    [from, to],
  );
  const heard = await db.getFirstAsync<{ nights: number; seconds: number | null }>(
    `SELECT COUNT(DISTINCT a.night_id) AS nights, SUM(a.end_s - a.start_s) AS seconds FROM night_activity a JOIN night n ON n.id = a.night_id
     WHERE a.kind = 'breathing' AND n.breathing_checked = 1 AND substr(n.date, 1, 10) BETWEEN ? AND ?`,
    [from, to],
  );
  return {
    from,
    to,
    generatedAt: new Date(),
    nights,
    factors: compare('factor'),
    remedies: compare('remedy'),
    profile: { ageBand: profile.age_band, pausesReported: profile.pauses_reported },
    snoreProfile: { pitch: snore.pitch, areas: snore.areas.map((a) => ({ name: a.name, rating: a.rating, evidence: a.evidence })) },
    breathing: { checkedNights: checked?.n ?? 0, nights: heard?.nights ?? 0, minutes: Math.round((heard?.seconds ?? 0) / 60) },
  };
}
