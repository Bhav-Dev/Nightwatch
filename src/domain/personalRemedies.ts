import { eligibleNights, MIN_NIGHT_S, type Delta, type NightSummary, withinUserDelta } from '../../shared/remedyEffect';
import { mean } from '../../shared/stats';

export interface PersonalRemedy {
  remedyId: string;
  nightsWith: number;
  nightsWithout: number;
  avgWith: number | null;
  avgWithout: number | null;
  /** Scores of the most recent nights with the remedy, oldest first, for the sparkline. */
  recentWith: number[];
  /** Logged on every counted night: there is nothing to compare against. */
  everyNight: boolean;
  /** The same within-person comparison the community figures use (null below 5 a side). */
  delta: Delta | null;
}

/** "Mine": every remedy the user has logged, with their own before and after. */
export function personalRemedies(history: readonly NightSummary[]): PersonalRemedy[] {
  const counted = history.filter((n) => !n.partial && n.duration_s >= MIN_NIGHT_S);
  const eligible = eligibleNights(history);
  const ids = [...new Set(history.flatMap((n) => n.remedies))];
  return ids
    .map((remedyId) => {
      const w = counted.filter((n) => n.remedies.includes(remedyId));
      const o = counted.filter((n) => !n.remedies.includes(remedyId));
      return {
        remedyId,
        nightsWith: w.length,
        nightsWithout: o.length,
        avgWith: w.length ? mean(w.map((n) => n.score)) : null,
        avgWithout: o.length ? mean(o.map((n) => n.score)) : null,
        recentWith: w.slice(-14).map((n) => n.score),
        everyNight: w.length > 0 && o.length === 0,
        delta: eligible.length ? withinUserDelta(eligible, remedyId) : null,
      };
    })
    .sort((a, b) => b.nightsWith - a.nightsWith);
}
