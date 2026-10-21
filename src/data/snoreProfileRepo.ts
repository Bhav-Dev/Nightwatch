import { turnedOverAndQuiet } from '../domain/activity';
import { profilePitch } from '../domain/pitch';
import { buildSnoreProfile, type SnoreProfile } from '../domain/snoreProfile';
import { listActiveCatalogue } from './catalogueRepo';
import type { Db } from './db';
import { listExperiments } from './experimentRepo';
import { nightSummaries } from './historyRepo';
import { nightlyPitch } from './pitchRepo';

/** The profile's pitch looks at the most recent nights with one, as snoring can change. */
export const PROFILE_PITCH_NIGHTS = 60;

type Span = { night_id: string; start_s: number; end_s: number };

function byNight(rows: readonly Span[]): Map<string, { startS: number; endS: number }[]> {
  const out = new Map<string, { startS: number; endS: number }[]>();
  for (const r of rows) {
    const list = out.get(r.night_id);
    const span = { startS: r.start_s, endS: r.end_s };
    if (list) list.push(span);
    else out.set(r.night_id, [span]);
  }
  return out;
}

/** Nights checked for movement, and how many had turning over stop the snoring for a while. */
export async function turnedOverNights(db: Db): Promise<{ checkedNights: number; nights: number }> {
  const nights = await db.getAllAsync<{ id: string; started_at: number; ended_at: number }>(
    "SELECT id, started_at, ended_at FROM night WHERE activity_checked = 1 AND source = 'local'",
    [],
  );
  if (nights.length === 0) return { checkedNights: 0, nights: 0 };
  const events = byNight(await db.getAllAsync<Span>('SELECT night_id, start_s, end_s FROM event', []));
  const moves = byNight(await db.getAllAsync<Span>("SELECT night_id, start_s, end_s FROM night_activity WHERE kind = 'movement'", []));
  const quiet = nights.filter((n) => turnedOverAndQuiet(moves.get(n.id) ?? [], events.get(n.id) ?? [], n.ended_at - n.started_at) !== null);
  return { checkedNights: nights.length, nights: quiet.length };
}

/** The snore profile from everything on this phone. */
export async function loadSnoreProfile(db: Db): Promise<SnoreProfile> {
  const [history, experiments, turnedOver, pitch, catalogue] = await Promise.all([
    nightSummaries(db),
    listExperiments(db),
    turnedOverNights(db),
    nightlyPitch(db),
    listActiveCatalogue(db),
  ]);
  const tests = experiments
    .filter((e) => e.status === 'complete' && e.verdict !== null)
    .reverse() // oldest first, so a remedy's latest test is the one that counts
    .map((e) => ({ remedyId: e.remedyId, verdict: e.verdict! }));
  const recent = pitch
    .map((p) => p.pitch)
    .filter((p) => p !== null)
    .slice(-PROFILE_PITCH_NIGHTS);
  return buildSnoreProfile({
    history,
    tests,
    turnedOver,
    pitch: profilePitch(recent),
    names: new Map(catalogue.map((c) => [c.id, c.name])),
  });
}
