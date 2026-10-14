import type { Db } from '../data/db';
import { storeHealth } from '../data/healthRepo';
import type { NightRow } from '../data/nightRepo';
import { ALIGN_TOLERANCE_S, alignToNight, summariseHealth } from '../domain/health';
import type { HealthSource } from './source';

/**
 * Pulls the night's Health data the next morning and stores the aligned samples (on the phone
 * only) and the summary (which syncs). Returns false when there was no data at all, so the
 * overlay stays hidden for that night.
 */
export async function importHealthForNight(db: Db, source: HealthSource, night: NightRow): Promise<boolean> {
  const start = new Date((night.started_at - ALIGN_TOLERANCE_S) * 1000);
  const end = new Date((night.ended_at + ALIGN_TOLERANCE_S) * 1000);
  const raw = await source.read(start, end);
  const aligned = alignToNight(raw, night.started_at, night.duration_s);
  await storeHealth(db, night.id, aligned, summariseHealth(aligned, night.time_in_bed_s));
  return aligned.length > 0;
}
