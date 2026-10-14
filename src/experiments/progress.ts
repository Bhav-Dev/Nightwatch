import { completeExperiment, type Experiment, runningExperiments } from '../data/experimentRepo';
import type { Db } from '../data/db';
import { nightSummaries } from '../data/historyRepo';
import { EXPERIMENT_NIGHTS, experimentDay, verdict, type Verdict } from '../domain/experiment';
import { MIN_NIGHT_S } from '../../shared/remedyEffect';
import { daysBetween } from '../../shared/stats';

export interface ExperimentProgress {
  day: number;
  nightsWith: number;
  nightsWithout: number;
  /** Present once the 14 nights are over. */
  verdict: Verdict | null;
}

/**
 * Scores an experiment from the nights actually recorded in its window: what was logged, not
 * what was planned (a missed night or a swapped one still counts on the side it really was).
 */
export async function experimentProgress(db: Db, e: Experiment, today: string): Promise<ExperimentProgress> {
  const nights = (await nightSummaries(db)).filter((n) => {
    const d = experimentDay(e.started, n.date.slice(0, 10));
    return d !== null && !n.partial && n.duration_s >= MIN_NIGHT_S;
  });
  const withScores = nights.filter((n) => n.remedies.includes(e.remedyId)).map((n) => n.score);
  const withoutScores = nights.filter((n) => !n.remedies.includes(e.remedyId)).map((n) => n.score);
  const day = Math.min(EXPERIMENT_NIGHTS, Math.max(1, daysBetween(e.started, today) + 1));
  const over = daysBetween(e.started, today) >= EXPERIMENT_NIGHTS;
  return { day, nightsWith: withScores.length, nightsWithout: withoutScores.length, verdict: over || e.verdict ? (e.verdict ?? verdict(withScores, withoutScores)) : null };
}

/** Completes every running experiment whose 14 nights are over. */
export async function finishDueExperiments(db: Db, today: string): Promise<number> {
  let done = 0;
  for (const e of await runningExperiments(db)) {
    const p = await experimentProgress(db, e, today);
    if (p.verdict) {
      await completeExperiment(db, e.id, p.verdict);
      done++;
    }
  }
  return done;
}
