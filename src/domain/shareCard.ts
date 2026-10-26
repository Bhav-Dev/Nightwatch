/**
 * What a share card says: the one line that makes a night, a week or a month worth posting.
 * Pure, so it can be tested; the card itself is drawn in src/ui/ShareCard.tsx.
 *
 * Cards carry snoring figures only: never watch data, audio or anything about a partner.
 */
import { scoreLabel, type ScoreLabel } from './scoring';

export type ShareKind = 'night' | 'week' | 'month';

/** Days a period card covers. */
export const SHARE_DAYS: Record<Exclude<ShareKind, 'night'>, number> = { week: 7, month: 30 };

/** A night is only called the quietest in a run this long or longer. */
export const QUIETEST_MIN_NIGHTS = 7;
/** A change smaller than this against an average is not worth a headline. */
export const NOTABLE_CHANGE = 3;

export interface NightShareInput {
  score: number;
  pctSnoring: number;
  /** Counted toward averages (3 hours or more in bed). */
  counts: boolean;
  /** The 7-night average shown on This Morning, if there is one. */
  average7: number | null;
  /** Earlier counted nights' scores, most recent first (this night not included). */
  earlierScores: readonly number[];
  /** Names of the remedies logged for the night. */
  tried: readonly string[];
}

/** "nasal strips" from "Nasal strips", keeping names like "CPAP" as they are. */
function lowerFirst(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

function joinNames(names: readonly string[]): string {
  const n = names.slice(0, 2).map(lowerFirst);
  return n.length === 2 ? `${n[0]} and ${n[1]}` : n[0];
}

/** How many nights in a row, counting this one, it is the quietest of (1 when an earlier night was as quiet). */
export function quietestRun(score: number, earlierScores: readonly number[]): number {
  let run = 1;
  for (const s of earlierScores) {
    if (s <= score) break;
    run++;
  }
  return run;
}

/** The night card's headline. */
export function nightHighlight(n: NightShareInput): string {
  if (n.counts) {
    const run = quietestRun(n.score, n.earlierScores);
    if (run >= QUIETEST_MIN_NIGHTS) return `My quietest night in ${run} nights`;
  }
  if (n.counts && n.average7 !== null) {
    const delta = Math.round(n.score - n.average7);
    if (delta <= -NOTABLE_CHANGE && n.tried.length > 0) return `${-delta} below my average, with ${joinNames(n.tried)}`;
    if (Math.abs(delta) >= NOTABLE_CHANGE) return `${delta < 0 ? '↓' : '↑'} ${Math.abs(delta)} vs my 7-night average`;
  }
  return `Snoring ${Math.round(n.pctSnoring * 100)}% of the night`;
}

export interface PeriodPoint {
  /** Local date the night started, yyyy-mm-dd (a "#2" suffix for a second night is allowed). */
  date: string;
  score: number;
  counts: boolean;
}

export interface PeriodSummary {
  /** One entry per day, oldest first, with that day's night (the later one if there were two). */
  days: { key: string; score: number | null }[];
  /** Mean score of the counted nights, rounded; null with none. */
  average: number | null;
  label: ScoreLabel | null;
  /** Nights recorded in the period. */
  nights: number;
  /** Mean of the period before, rounded; null with no counted nights then. */
  previousAverage: number | null;
  /** The counted night with the lowest score. */
  quietest: { key: string; score: number } | null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const mean = (xs: readonly number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/**
 * The last `days` days up to today, and the `days` before them for comparison. `points` may
 * cover both periods or more; nights outside them are ignored.
 */
export function periodSummary(points: readonly PeriodPoint[], days: number, today = new Date()): PeriodSummary {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const prevStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() - days);
  const fromKey = dayKey(start);
  const prevKey = dayKey(prevStart);
  const toKey = dayKey(today);
  const inPeriod = points.filter((p) => p.date.slice(0, 10) >= fromKey && p.date.slice(0, 10) <= toKey);
  const before = points.filter((p) => p.date.slice(0, 10) >= prevKey && p.date.slice(0, 10) < fromKey);

  const byDay = new Map<string, PeriodPoint>();
  for (const p of inPeriod) byDay.set(p.date.slice(0, 10), p);
  const dayList = Array.from({ length: days }, (_, i) => {
    const key = dayKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    return { key, score: byDay.get(key)?.score ?? null };
  });

  const counted = inPeriod.filter((p) => p.counts);
  const average = mean(counted.map((p) => p.score));
  const quiet = counted.reduce<PeriodPoint | null>((q, p) => (q === null || p.score < q.score ? p : q), null);
  return {
    days: dayList,
    average,
    label: average === null ? null : scoreLabel(average),
    nights: inPeriod.length,
    previousAverage: mean(before.filter((p) => p.counts).map((p) => p.score)),
    quietest: quiet ? { key: quiet.date.slice(0, 10), score: quiet.score } : null,
  };
}

/** The week or month card's headline. */
export function periodHighlight(s: PeriodSummary, kind: Exclude<ShareKind, 'night'>): string {
  const before = kind === 'week' ? 'the week before' : 'the month before';
  if (s.average !== null && s.previousAverage !== null) {
    const diff = s.average - s.previousAverage;
    if (Math.abs(diff) >= 2) return `${diff < 0 ? '↓' : '↑'} ${Math.abs(diff)} vs ${before}`;
    return `About the same as ${before}`;
  }
  const total = s.days.length;
  return s.nights >= total ? 'Recorded every night' : `${s.nights} of ${total} nights recorded`;
}
