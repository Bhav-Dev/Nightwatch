import { MIN_NIGHT_S, MIN_NIGHTS_EACH_SIDE, type NightSummary, personalDifference } from '../../shared/remedyEffect';
import { mean } from '../../shared/stats';

/** A night with the morning check-in, for comparing how rested the person felt. */
export type NightWithCheckIn = NightSummary & { rested: number | null };

export interface Pattern {
  id: string;
  nightsWith: number;
  nightsWithout: number;
  /** Average score with minus without (null below 5 nights each way). */
  scoreDiff: number | null;
  /** Average rested (1 to 5) with minus without, over nights with a check-in (null below 5 each way). */
  restedDiff: number | null;
}

/**
 * How each factor (logged, weather or read from the night) goes with the person's own nights:
 * the same within-person comparison as the summary, plus how rested they felt. Factors with a
 * result come first, biggest difference first; the rest by how often they were logged.
 */
export function patterns(history: readonly NightWithCheckIn[], ignore: ReadonlySet<string> = new Set()): Pattern[] {
  const counted = history.filter((n) => !n.partial && n.duration_s >= MIN_NIGHT_S);
  const has = (n: NightSummary, id: string) => n.factors.some((f) => f.id === id);
  const ids = [...new Set(history.flatMap((n) => n.factors.map((f) => f.id)))].filter((id) => !ignore.has(id));
  return ids
    .map((id) => {
      const w = counted.filter((n) => has(n, id));
      const o = counted.filter((n) => !has(n, id));
      const rw = w.map((n) => n.rested).filter((r): r is number => r !== null);
      const ro = o.map((n) => n.rested).filter((r): r is number => r !== null);
      return {
        id,
        nightsWith: w.length,
        nightsWithout: o.length,
        scoreDiff: personalDifference(history, id),
        restedDiff: rw.length >= MIN_NIGHTS_EACH_SIDE && ro.length >= MIN_NIGHTS_EACH_SIDE ? mean(rw) - mean(ro) : null,
      };
    })
    .filter((p) => p.nightsWith > 0)
    .sort((a, b) => {
      if ((a.scoreDiff === null) !== (b.scoreDiff === null)) return a.scoreDiff === null ? 1 : -1;
      if (a.scoreDiff !== null && b.scoreDiff !== null) return Math.abs(b.scoreDiff) - Math.abs(a.scoreDiff);
      return b.nightsWith - a.nightsWith;
    });
}
