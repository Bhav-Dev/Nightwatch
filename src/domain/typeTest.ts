import { EXPERIMENT_NIGHTS, rng } from './experiment';
import type { ProfileArea } from './snoreProfile';

/**
 * "Find your type": up to three remedy tests run together for 14 nights, one each for position,
 * the nose and the mouth. Each is an ordinary remedy test (7 nights with, 7 without, a verdict at
 * the end), so Tonight, the morning and the verdict work as for any test. Their plans are crossed:
 * every pair of tests meets in each combination on 3 or 4 nights, so the nights with a nasal strip
 * are not also mostly the nights on your side, and each verdict stands on its own.
 */
export const TYPE_TEST_GROUP = 'type';

export interface TypeTest {
  area: ProfileArea;
  remedyId: string;
  /** What the test is called on its own. */
  name: string;
  /** Tonight's instruction on a night with it, and on a night without. */
  withText: string;
  withoutText: string;
}

export const TYPE_TESTS: readonly TypeTest[] = [
  {
    area: 'position',
    remedyId: 'side_sleeping',
    name: 'Side sleeping',
    withText: 'Sleep on your side. A pillow behind your back helps you stay there.',
    withoutText: 'Sleep the way you usually do.',
  },
  {
    area: 'nose',
    remedyId: 'nasal_strips',
    name: 'Nasal strip',
    withText: 'Wear a nasal strip.',
    withoutText: 'No nasal strip.',
  },
  {
    area: 'mouth',
    remedyId: 'mouth_tape',
    name: 'Mouth tape',
    withText: 'Use mouth tape. If your nose is blocked, skip it and log the blocked nose.',
    withoutText: 'No mouth tape.',
  },
];

function maxRun(xs: readonly boolean[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < xs.length; i++) {
    run = i > 0 && xs[i] === xs[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Plans for `count` tests (1 to 3) run together: `count` lists of 14 nights, true = with. Every
 * combination of the tests is repeated to make 16 nights, then one combination and its opposite
 * are dropped, which leaves each test 7 nights with and 7 without and every pair crossed on 3 or
 * 4 nights. The order is shuffled until no test has more than 3 nights the same in a row.
 * Seeded, so a plan can be shown before it is started and started exactly as shown.
 */
export function typeTestPlans(seed: number, count: number): boolean[][] {
  if (count < 1 || count > 3) throw new Error('A type test has 1 to 3 parts');
  const rand = rng(seed);
  const combos = Array.from({ length: 2 ** count }, (_, c) => Array.from({ length: count }, (_, j) => ((c >> j) & 1) === 1));
  const nights: boolean[][] = [];
  while (nights.length < EXPERIMENT_NIGHTS + 2) nights.push(...combos.map((c) => [...c]));
  const dropped = combos[Math.floor(rand() * combos.length)];
  for (const drop of [dropped, dropped.map((x) => !x)]) {
    nights.splice(
      nights.findIndex((n) => n.every((x, j) => x === drop[j])),
      1,
    );
  }
  let columns: boolean[][] = [];
  for (let attempt = 0; attempt < 10_000; attempt++) {
    for (let i = nights.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [nights[i], nights[j]] = [nights[j], nights[i]];
    }
    columns = Array.from({ length: count }, (_, j) => nights.map((n) => n[j]));
    if (columns.every((c) => maxRun(c) <= 3)) break;
  }
  return columns;
}
