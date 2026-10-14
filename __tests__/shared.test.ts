import { amazonUrl, marketplaceFor } from '../shared/amazon';
import { bmiBand, EMPTY_PROFILE, segmentKey, segmentsFor } from '../shared/profile';
import {
  communityFigure,
  distribution,
  eligibleNights,
  type NightSummary,
  personalDifference,
  statusFor,
  withinUserDelta,
  withinUserStackDelta,
} from '../shared/remedyEffect';
import { daysBetween, median, quantile } from '../shared/stats';

describe('stats', () => {
  it('uses linear-interpolated quantiles', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    expect(quantile([10, 20], 0.75)).toBe(17.5);
    expect(Number.isNaN(median([]))).toBe(true);
  });
  it('counts days between dates, ignoring suffixes', () => {
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(daysBetween('2026-10-15#2', '2026-10-15')).toBe(0);
  });
});

describe('profile bands and segments', () => {
  const p = { ...EMPTY_PROFILE, age_band: '40-49' as const, bmi_band: '25-30' as const, position: 'back' as const };
  it('builds the "people like you" key in a fixed order', () => {
    expect(segmentKey(p)).toBe('age:40-49|bmi:25-30|position:back');
    expect(segmentKey({ ...p, position: null })).toBeNull();
  });
  it('lists single-dimension segments plus the combination', () => {
    expect(segmentsFor(p).sort()).toEqual(['age:40-49', 'age:40-49|bmi:25-30|position:back', 'bmi:25-30', 'position:back']);
  });
  it('computes BMI bands', () => {
    expect(bmiBand(180, 70)).toBe('<25');
    expect(bmiBand(175, 85)).toBe('25-30');
    expect(bmiBand(170, 110)).toBe('35+');
  });
});

describe('amazon links', () => {
  const tags = { GB: 'nightwatch-21', US: 'nightwatch-20' };
  it('uses the ASIN when one exists for the marketplace, else a search', () => {
    const product = { search: 'nasal strips', asin: { US: 'B000TEST' } };
    expect(amazonUrl(product, 'US', tags)).toBe('https://www.amazon.com/dp/B000TEST?tag=nightwatch-20');
    expect(amazonUrl(product, 'GB', tags)).toBe('https://www.amazon.co.uk/s?k=nasal%20strips&tag=nightwatch-21');
  });
  it('never shows an untagged link', () => {
    expect(amazonUrl({ search: 'x' }, 'DE', tags)).toBeNull();
  });
  it('falls back to the UK store for unknown regions', () => {
    expect(marketplaceFor('ZZ')).toBe('GB');
    expect(marketplaceFor(null)).toBe('GB');
  });
});

/** A contributor's nights: day i on 2026-01-(i+1), with a remedy on some days. */
function nights(
  count: number,
  make: (i: number) => Partial<NightSummary>,
): NightSummary[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    return {
      id: `n${i}`,
      date: d.toISOString().slice(0, 10),
      score: 50,
      pct_snoring: 0.3,
      duration_s: 8 * 3600,
      partial: false,
      typical: null,
      remedies: [],
      factors: [],
      ...make(i),
    };
  });
}

describe('eligible nights', () => {
  it('drops partial, short and atypical nights and the first two', () => {
    const n = nights(12, (i) => ({ partial: i === 5, duration_s: i === 6 ? 3600 : 8 * 3600, typical: i === 7 ? false : null }));
    const e = eligibleNights(n);
    expect(e.map((x) => x.id)).toEqual(['n2', 'n3', 'n4', 'n8', 'n9', 'n10', 'n11']);
  });
  it('is empty below 7 eligible nights', () => {
    expect(eligibleNights(nights(8, () => ({})))).toEqual([]);
  });
});

describe('within-user delta', () => {
  it('compares with against without nights using medians, matched where possible', () => {
    // Nasal strips on odd days: score 40 instead of 60.
    const n = nights(24, (i) => (i % 2 ? { remedies: ['nasal_strips'], score: 40 } : { score: 60 }));
    const d = withinUserDelta(eligibleNights(n), 'nasal_strips')!;
    expect(d).toMatchObject({ delta_score: -20, matched: true, nights_with: 11, nights_without: 11 });
  });

  it('needs 5 nights on each side', () => {
    const n = nights(12, (i) => (i < 4 ? { remedies: ['mouth_tape'] } : {}));
    expect(withinUserDelta(eligibleNights(n), 'mouth_tape')).toBeNull();
  });

  it('falls back to unmatched when alcohol bands do not line up', () => {
    const n = nights(20, (i) =>
      i % 2
        ? { remedies: ['side_sleeping'], score: 30 }
        : { score: 50, factors: [{ id: 'alcohol', value: '3-4' }] },
    );
    const d = withinUserDelta(eligibleNights(n), 'side_sleeping')!;
    expect(d.matched).toBe(false);
    expect(d.delta_score).toBe(-20);
  });

  it('does not count nights with a co-introduced remedy as "without"', () => {
    // Days 0-9 nothing (score 60); from day 10 both A and B; on days 20+ only B (score 45).
    const n = nights(30, (i) =>
      i < 10 ? { score: 60 } : i < 20 ? { remedies: ['a', 'b'], score: 40 } : { remedies: ['b'], score: 45 },
    );
    const d = withinUserDelta(eligibleNights(n), 'a')!;
    expect(d.nights_without).toBe(8); // days 2-9 only; B-only nights excluded
    expect(d.delta_score).toBe(-20);
  });

  it('can be limited to recent "with" nights', () => {
    const n = nights(30, (i) => (i % 2 ? { remedies: ['r'], score: 40 } : { score: 60 }));
    const d = withinUserDelta(eligibleNights(n), 'r', { withSince: '2026-01-20' })!;
    expect(d.with_dates.every((x) => x >= '2026-01-20')).toBe(true);
  });

  it('computes stacks against nights with neither remedy', () => {
    const n = nights(30, (i) =>
      i % 3 === 0 ? { remedies: ['a', 'b'], score: 30 } : i % 3 === 1 ? { score: 60 } : { remedies: ['a'], score: 50 },
    );
    expect(withinUserStackDelta(eligibleNights(n), 'b', 'a')).toMatchObject({ remedy_id: 'a+b', delta_score: -30 });
  });
});

describe('community figure', () => {
  const delta = (s: number, matched = true, nightsWith = 10) => ({
    remedy_id: 'r',
    delta_score: s,
    delta_pct: s / 100,
    nights_with: nightsWith,
    nights_without: 10,
    matched,
    with_dates: [],
  });

  it('takes the median and interquartile range over contributors', () => {
    const f = communityFigure([-30, -20, -10, 0, 10].map((s) => delta(s)));
    expect(f).toMatchObject({ users: 5, nights: 50, median_delta: -10, p25: -20, p75: 0, status: 'hidden', holds_without_alcohol: true });
  });

  it('says the effect does not hold when matched contributors disagree', () => {
    const f = communityFigure([delta(-20, false), delta(-20, false), delta(-20, false), delta(5, true)]);
    expect(f.holds_without_alcohol).toBe(false);
    expect(communityFigure([delta(-5, false)]).holds_without_alcohol).toBeNull();
  });

  it('applies the sample-size rules', () => {
    expect(statusFor(30, 300)).toBe('ok');
    expect(statusFor(30, 299)).toBe('early');
    expect(statusFor(10, 50)).toBe('early');
    expect(statusFor(9, 500)).toBe('hidden');
  });

  it('buckets the distribution in 5-point steps, clamped', () => {
    const dist = distribution([delta(-12), delta(-10), delta(80), delta(-99)]);
    expect(dist.find((b) => b.bucket === -15)?.count).toBe(1);
    expect(dist.find((b) => b.bucket === -10)?.count).toBe(1);
    expect(dist.find((b) => b.bucket === 45)?.count).toBe(1);
    expect(dist.find((b) => b.bucket === -50)?.count).toBe(1);
  });
});

describe('personal difference', () => {
  it('is the mean with minus the mean without, for the summary sentence', () => {
    const n = nights(12, (i) => (i < 6 ? { factors: [{ id: 'alcohol', value: '3-4' }], score: 70 } : { score: 48 }));
    expect(personalDifference(n, 'alcohol')).toBe(22);
    expect(personalDifference(n.slice(0, 8), 'alcohol')).toBeNull();
  });
});

describe('background remedies', () => {
  it('an everyday remedy logged from the first night does not block a later one', () => {
    const n = nights(20, (i) => (i % 2 ? { remedies: ['pillow', 'strips'], score: 30 } : { remedies: ['pillow'], score: 50 }));
    expect(withinUserDelta(eligibleNights(n), 'strips')).toMatchObject({ delta_score: -20 });
  });
});
