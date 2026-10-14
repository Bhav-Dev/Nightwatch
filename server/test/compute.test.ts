import { describe, expect, it } from 'vitest';

import { EMPTY_PROFILE } from '../../shared/profile.ts';
import type { NightSummary } from '../../shared/remedyEffect.ts';
import { computeAggregates, type ContributorInput } from '../src/jobs/aggregateJob.ts';

const NOW = new Date('2026-10-14T04:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() - offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Noise-free contributors: `remedy` on alternate nights over 200 days, lowering the score by
 * `early` points until 90 days ago and by `recent` points since.
 */
function people(count: number, remedy: string, early: number, recent: number): ContributorInput[] {
  return Array.from({ length: count }, (_, i) => {
    const nights: NightSummary[] = [];
    for (let d = 200; d >= 1; d--) {
      const on = d % 2 === 0;
      nights.push({
        id: `${i}-${d}`,
        date: day(d),
        score: 50 + (on ? (d > 90 ? early : recent) : 0),
        pct_snoring: 0.2,
        duration_s: 8 * 3600,
        partial: false,
        typical: true,
        remedies: on ? [remedy] : [],
        factors: [],
      });
    }
    return { contributorId: `c${i}`, nights, profile: { ...EMPTY_PROFILE, sex: 'female' } };
  });
}

const row = (r: ReturnType<typeof computeAggregates>, w: string, id: string, segment = 'all') =>
  r.rows.find((x) => x.segment === segment && x.time_window === w && x.remedy_id === id)!;

describe('computeAggregates', () => {
  it('marks a remedy that helps less lately as worse', () => {
    const r = computeAggregates(people(12, 'nasal_strips', -15, -5), ['nasal_strips'], NOW);
    expect(row(r, 'all', 'nasal_strips')).toMatchObject({ status: 'early', median_delta: -15, trend: 'worse' });
    expect(row(r, '90d', 'nasal_strips')).toMatchObject({ median_delta: -5, trend: 'worse' });
    // 12 people is enough for the sex:female segment to be published.
    expect(row(r, 'all', 'nasal_strips', 'sex:female').users).toBe(12);
    expect(r.snapshots.map((s) => `${s.segment}/${s.time_window}`).sort()).toEqual([
      'all/90d',
      'all/all',
      'sex:female/90d',
      'sex:female/all',
    ]);
  });

  it('marks a remedy that helps more lately as better, and leaves small groups without a trend', () => {
    const r = computeAggregates(people(12, 'nasal_strips', -5, -15), ['nasal_strips'], NOW);
    expect(row(r, 'all', 'nasal_strips').trend).toBe('better');
    const few = computeAggregates(people(9, 'nasal_strips', -5, -15), ['nasal_strips'], NOW);
    expect(row(few, 'all', 'nasal_strips')).toMatchObject({ status: 'hidden', users: 9, trend: null, median_delta: null });
    expect(few.rows.some((x) => x.segment !== 'all')).toBe(false);
  });

  it('fails the sanity check when side sleeping makes snoring worse', () => {
    const r = computeAggregates(people(30, 'side_sleeping', 10, 10), ['side_sleeping'], NOW);
    expect(row(r, 'all', 'side_sleeping').status).toBe('ok');
    expect(r.sanityFailures).toEqual(['side_sleeping median delta 10.00 is not negative']);
    expect(computeAggregates(people(30, 'side_sleeping', -10, -10), ['side_sleeping'], NOW).sanityFailures).toEqual([]);
  });
});
