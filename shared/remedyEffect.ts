/**
 * The remedy-effect algorithm (spec: "Aggregation algorithm", steps 1 to 4). Pure functions
 * over night summaries, shared by the nightly job (every contributor) and the app (the user's
 * own "your result" and experiment verdicts), so both always agree.
 */
import { daysBetween, median, quantile } from './stats';

export interface NightSummary {
  id: string;
  /** Local date the recording started, yyyy-mm-dd (a "#n" suffix is allowed). */
  date: string;
  score: number;
  /** 0 to 1. */
  pct_snoring: number;
  /** Time in bed in seconds. */
  duration_s: number;
  partial: boolean;
  typical: boolean | null;
  remedies: string[];
  factors: { id: string; value: string | null }[];
}

export const MIN_NIGHT_S = 3 * 3600;
export const SKIP_FIRST_NIGHTS = 2;
export const MIN_ELIGIBLE_NIGHTS = 7;
export const MIN_NIGHTS_EACH_SIDE = 5;
export const CO_INTRODUCTION_DAYS = 14;
export const MIN_PAIRS = 5;
/**
 * A co-introduced remedy logged on at least this share of nights both with and without the
 * remedy being measured is background (an everyday pillow): it sits on both sides equally, so
 * it does not exclude any nights. Without this, anything logged from a user's first night
 * would block every remedy they try in their first two weeks from ever being measured.
 */
export const BACKGROUND_SHARE = 0.8;

/** Step 1: nights that count, oldest first. Empty if the contributor has too few. */
export function eligibleNights(nights: readonly NightSummary[]): NightSummary[] {
  const ok = [...nights]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .filter((n) => !n.partial && n.duration_s >= MIN_NIGHT_S && n.typical !== false)
    .slice(SKIP_FIRST_NIGHTS);
  return ok.length >= MIN_ELIGIBLE_NIGHTS ? ok : [];
}

const has = (n: NightSummary, id: string) => n.remedies.includes(id) || n.factors.some((f) => f.id === id);
const alcoholBand = (n: NightSummary) => n.factors.find((f) => f.id === 'alcohol')?.value ?? 'none';
const congested = (n: NightSummary) => n.factors.some((f) => f.id === 'congestion');

export interface Delta {
  remedy_id: string;
  delta_score: number;
  delta_pct: number;
  nights_with: number;
  nights_without: number;
  matched: boolean;
  /** Dates of the nights counted on the "with" side (for windowing). */
  with_dates: string[];
}

export interface DeltaOptions {
  /** Treat the id as a lifestyle factor: no co-introduction rule (alcohol is not "introduced"). */
  isFactor?: boolean;
  /** Only count "with" nights on or after this date (the 90-day window). */
  withSince?: string;
}

/**
 * Step 2: one contributor's change in score with a remedy, against their own nights without
 * it. Returns null when either side has fewer than 5 nights.
 */
export function withinUserDelta(
  eligible: readonly NightSummary[],
  remedyId: string,
  opts: DeltaOptions = {},
): Delta | null {
  let withN = eligible.filter((n) => has(n, remedyId));
  if (opts.withSince) withN = withN.filter((n) => n.date >= opts.withSince!);

  let excluded = new Set<string>();
  if (!opts.isFactor) {
    // Remedies first logged within 14 days of this one: their nights do not count as "without".
    const firstLogged = new Map<string, string>();
    for (const n of eligible) for (const r of n.remedies) if (!firstLogged.has(r)) firstLogged.set(r, n.date);
    const introduced = firstLogged.get(remedyId);
    if (introduced) {
      const others = eligible.filter((n) => !has(n, remedyId));
      const share = (set: readonly NightSummary[], r: string) => (set.length ? set.filter((n) => n.remedies.includes(r)).length / set.length : 0);
      excluded = new Set(
        [...firstLogged]
          .filter(([r, d]) => r !== remedyId && Math.abs(daysBetween(introduced, d)) <= CO_INTRODUCTION_DAYS)
          .filter(([r]) => !(share(withN, r) >= BACKGROUND_SHARE && share(others, r) >= BACKGROUND_SHARE))
          .map(([r]) => r),
      );
    }
  }
  const withoutN = eligible.filter((n) => !has(n, remedyId) && !n.remedies.some((r) => excluded.has(r)));

  if (withN.length < MIN_NIGHTS_EACH_SIDE || withoutN.length < MIN_NIGHTS_EACH_SIDE) return null;

  // Matched comparison: each "with" night against the nearest unused "without" night that has
  // the same alcohol band and congestion flag.
  const used = new Set<string>();
  const pairs: [NightSummary, NightSummary][] = [];
  for (const w of withN) {
    let best: NightSummary | null = null;
    let bestGap = Infinity;
    for (const o of withoutN) {
      if (used.has(o.id) || alcoholBand(o) !== alcoholBand(w) || congested(o) !== congested(w)) continue;
      const gap = Math.abs(daysBetween(w.date, o.date));
      if (gap < bestGap) {
        best = o;
        bestGap = gap;
      }
    }
    if (best) {
      used.add(best.id);
      pairs.push([w, best]);
    }
  }

  const matched = pairs.length >= MIN_PAIRS;
  const a = matched ? pairs.map((p) => p[0]) : withN;
  const b = matched ? pairs.map((p) => p[1]) : withoutN;
  return {
    remedy_id: remedyId,
    delta_score: median(a.map((n) => n.score)) - median(b.map((n) => n.score)),
    delta_pct: median(a.map((n) => n.pct_snoring)) - median(b.map((n) => n.pct_snoring)),
    nights_with: withN.length,
    nights_without: withoutN.length,
    matched,
    with_dates: withN.map((n) => n.date),
  };
}

/** Step 4: a pair of remedies logged together, against nights with neither. */
export function withinUserStackDelta(eligible: readonly NightSummary[], a: string, b: string): Delta | null {
  const both = eligible.filter((n) => n.remedies.includes(a) && n.remedies.includes(b));
  const neither = eligible.filter((n) => !n.remedies.includes(a) && !n.remedies.includes(b));
  if (both.length < MIN_NIGHTS_EACH_SIDE || neither.length < MIN_NIGHTS_EACH_SIDE) return null;
  return {
    remedy_id: stackId(a, b),
    delta_score: median(both.map((n) => n.score)) - median(neither.map((n) => n.score)),
    delta_pct: median(both.map((n) => n.pct_snoring)) - median(neither.map((n) => n.pct_snoring)),
    nights_with: both.length,
    nights_without: neither.length,
    matched: false,
    with_dates: both.map((n) => n.date),
  };
}

export const stackId = (a: string, b: string) => (a < b ? `${a}+${b}` : `${b}+${a}`);

export type AggregateStatus = 'ok' | 'early' | 'hidden';

export const OK_USERS = 30;
export const OK_NIGHTS = 300;
export const EARLY_USERS = 10;

export function statusFor(users: number, nights: number): AggregateStatus {
  if (users >= OK_USERS && nights >= OK_NIGHTS) return 'ok';
  if (users >= EARLY_USERS) return 'early';
  return 'hidden';
}

export interface CommunityFigure {
  users: number;
  nights: number;
  median_delta: number;
  p25: number;
  p75: number;
  median_delta_pct: number;
  /** Null when no contributor had enough matched nights to tell. */
  holds_without_alcohol: boolean | null;
  status: AggregateStatus;
}

/** Step 3: one row per contributor in, one community figure out. */
export function communityFigure(deltas: readonly Delta[]): CommunityFigure {
  const scores = deltas.map((d) => d.delta_score);
  const m = median(scores);
  const matched = deltas.filter((d) => d.matched).map((d) => d.delta_score);
  let holds: boolean | null = null;
  if (matched.length > 0) {
    const mm = median(matched);
    holds = Math.sign(mm) === Math.sign(m) && Math.abs(mm) >= Math.abs(m) / 2;
  }
  const nights = deltas.reduce((s, d) => s + d.nights_with, 0);
  return {
    users: deltas.length,
    nights,
    median_delta: m,
    p25: quantile(scores, 0.25),
    p75: quantile(scores, 0.75),
    median_delta_pct: median(deltas.map((d) => d.delta_pct)),
    holds_without_alcohol: holds,
    status: statusFor(deltas.length, nights),
  };
}

/** Histogram of per-contributor deltas in 5-point buckets from −50 to +50 (clamped). */
export function distribution(deltas: readonly Delta[]): { bucket: number; count: number }[] {
  const counts = new Map<number, number>();
  for (let b = -50; b <= 45; b += 5) counts.set(b, 0);
  for (const d of deltas) {
    const b = Math.max(-50, Math.min(45, Math.floor(d.delta_score / 5) * 5));
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts].map(([bucket, count]) => ({ bucket, count }));
}

/**
 * The user's own average difference for a factor or remedy (mean with − mean without), used
 * by the morning summary ("your alcohol nights average 22 points higher"). Null below 5 a side.
 */
export function personalDifference(nights: readonly NightSummary[], id: string): number | null {
  const ok = nights.filter((n) => !n.partial && n.duration_s >= MIN_NIGHT_S);
  const w = ok.filter((n) => has(n, id)).map((n) => n.score);
  const o = ok.filter((n) => !has(n, id)).map((n) => n.score);
  if (w.length < MIN_NIGHTS_EACH_SIDE || o.length < MIN_NIGHTS_EACH_SIDE) return null;
  return w.reduce((s, x) => s + x, 0) / w.length - o.reduce((s, x) => s + x, 0) / o.length;
}
