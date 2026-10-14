/**
 * Guided 14-night remedy experiments: 7 nights with, 7 without, in a random order (no more
 * than 3 of the same in a row), then a verdict with a confidence level rather than a single
 * number.
 */
import { daysBetween, median } from '../../shared/stats';

export const EXPERIMENT_NIGHTS = 14;
export const MIN_EACH_SIDE = 5;

/** Small deterministic PRNG (mulberry32) so plans and verdicts are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function maxRun(xs: boolean[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < xs.length; i++) {
    run = i > 0 && xs[i] === xs[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** true = use the remedy that night. */
export function createPattern(seed: number): boolean[] {
  const rand = rng(seed);
  for (;;) {
    const p = [...Array(7).fill(true), ...Array(7).fill(false)] as boolean[];
    for (let i = p.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    if (maxRun(p) <= 3) return p;
  }
}

/** Night number (1 to 14) for a night date, or null outside the experiment. */
export function experimentDay(started: string, date: string): number | null {
  const d = daysBetween(started, date) + 1;
  return d >= 1 && d <= EXPERIMENT_NIGHTS ? d : null;
}

export function planFor(started: string, pattern: boolean[], date: string): 'with' | 'without' | null {
  const day = experimentDay(started, date);
  return day === null ? null : pattern[day - 1] ? 'with' : 'without';
}

export type Confidence = 'high' | 'medium' | 'low';

export type Verdict =
  | { kind: 'not_enough'; nightsWith: number; nightsWithout: number }
  | {
      kind: 'helped' | 'worse' | 'no_clear_difference';
      medianWith: number;
      medianWithout: number;
      difference: number;
      confidence: Confidence;
      nightsWith: number;
      nightsWithout: number;
    };

/** Difference in medians that counts as a real change in score. */
export const MEANINGFUL_POINTS = 5;

const meanOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Two-sided permutation test: how often a random relabelling of the same nights gives a
 * difference in means at least as large. Means, not medians: with 7 nights a side a median
 * moves in big jumps, so half of all relabellings can reproduce a median gap and even a
 * perfectly clean result would look uncertain. Seeded, so the same nights give the same verdict.
 */
export function permutationP(withScores: number[], withoutScores: number[], iterations = 2000, seed = 1): number {
  const observed = Math.abs(meanOf(withScores) - meanOf(withoutScores));
  const all = [...withScores, ...withoutScores];
  const rand = rng(seed);
  let extreme = 0;
  for (let k = 0; k < iterations; k++) {
    const a = [...all];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    const d = Math.abs(meanOf(a.slice(0, withScores.length)) - meanOf(a.slice(withScores.length)));
    if (d >= observed - 1e-9) extreme++;
  }
  return (extreme + 1) / (iterations + 1);
}

/** Verdict from the nights actually recorded (what was logged, not what was planned). */
export function verdict(withScores: number[], withoutScores: number[]): Verdict {
  if (withScores.length < MIN_EACH_SIDE || withoutScores.length < MIN_EACH_SIDE) {
    return { kind: 'not_enough', nightsWith: withScores.length, nightsWithout: withoutScores.length };
  }
  const mWith = median(withScores);
  const mWithout = median(withoutScores);
  const difference = mWith - mWithout;
  const p = permutationP(withScores, withoutScores);
  const confidence: Confidence = p < 0.05 ? 'high' : p < 0.2 ? 'medium' : 'low';
  const meaningful = Math.abs(difference) >= MEANINGFUL_POINTS && confidence !== 'low';
  return {
    kind: !meaningful ? 'no_clear_difference' : difference < 0 ? 'helped' : 'worse',
    medianWith: mWith,
    medianWithout: mWithout,
    difference,
    confidence,
    nightsWith: withScores.length,
    nightsWithout: withoutScores.length,
  };
}

export function verdictText(v: Verdict, remedyName: string): string {
  switch (v.kind) {
    case 'not_enough':
      return `Not enough nights yet: ${v.nightsWith} with ${remedyName} and ${v.nightsWithout} without. Each side needs at least ${MIN_EACH_SIDE}.`;
    case 'helped':
      return `Your score was ${Math.round(-v.difference)} points lower with ${remedyName} (${confidenceText(v.confidence)}).`;
    case 'worse':
      return `Your score was ${Math.round(v.difference)} points higher with ${remedyName} (${confidenceText(v.confidence)}).`;
    case 'no_clear_difference':
      return `No clear difference with ${remedyName}: ${Math.round(v.medianWith)} with, ${Math.round(v.medianWithout)} without.`;
  }
}

function confidenceText(c: Confidence): string {
  return c === 'high' ? 'high confidence' : c === 'medium' ? 'medium confidence' : 'low confidence';
}
