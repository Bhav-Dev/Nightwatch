import { seedCatalogueIfEmpty } from '../src/data/catalogueRepo';
import { completeExperiment, listExperiments, runningExperiments, startExperiment, startTestGroup } from '../src/data/experimentRepo';
import { nightEvents, saveNight } from '../src/data/nightRepo';
import { saveSnorePitch } from '../src/data/pitchRepo';
import { migrate } from '../src/data/schema';
import { loadSnoreProfile } from '../src/data/snoreProfileRepo';
import { createPattern, EXPERIMENT_NIGHTS, type Verdict } from '../src/domain/experiment';
import type { ProfilePitch } from '../src/domain/pitch';
import { analyseNight } from '../src/domain/scoring';
import { AREAS, buildSnoreProfile, type ProfileArea, type ProfileInput, type SnoreProfile } from '../src/domain/snoreProfile';
import { TYPE_TEST_GROUP, TYPE_TESTS, typeTestPlans } from '../src/domain/typeTest';
import { reportHtml, type ReportData } from '../src/report/reportHtml';
import type { NightSummary } from '../shared/remedyEffect';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

const maxRun = (xs: readonly boolean[]) => {
  let best = 0;
  let run = 0;
  xs.forEach((x, i) => {
    run = i > 0 && x === xs[i - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
};

describe('find your type: the plans', () => {
  it.each([1, 2, 3])('gives each of %i tests 7 nights with and 7 without, never 4 the same in a row', (count) => {
    for (let seed = 1; seed <= 100; seed++) {
      const plans = typeTestPlans(seed, count);
      expect(plans).toHaveLength(count);
      for (const plan of plans) {
        expect(plan).toHaveLength(EXPERIMENT_NIGHTS);
        expect(plan.filter(Boolean)).toHaveLength(7);
        expect(maxRun(plan)).toBeLessThanOrEqual(3);
      }
    }
  });

  it.each([2, 3])('crosses every pair of %i tests, so one test’s nights are not mostly the other’s', (count) => {
    for (let seed = 1; seed <= 100; seed++) {
      const plans = typeTestPlans(seed, count);
      for (let a = 0; a < count; a++) {
        for (let b = a + 1; b < count; b++) {
          for (const x of [true, false]) {
            for (const y of [true, false]) {
              const nights = plans[a].filter((v, i) => v === x && plans[b][i] === y).length;
              expect(nights).toBeGreaterThanOrEqual(3);
              expect(nights).toBeLessThanOrEqual(4);
            }
          }
        }
      }
    }
  });

  it('is the same plan for the same seed, so the plan shown is the plan started', () => {
    expect(typeTestPlans(7, 3)).toEqual(typeTestPlans(7, 3));
    expect(typeTestPlans(7, 3)).not.toEqual(typeTestPlans(8, 3));
  });

  it('has one to three parts: position, the nose and the mouth', () => {
    expect(() => typeTestPlans(1, 0)).toThrow();
    expect(() => typeTestPlans(1, 4)).toThrow();
    expect(TYPE_TESTS.map((t) => t.area)).toEqual(['position', 'nose', 'mouth']);
    for (const t of TYPE_TESTS) expect(AREAS[t.area].remedies).toContain(t.remedyId);
  });
});

const names = new Map([
  ['side_sleeping', 'Slept on side'],
  ['mouth_tape', 'Mouth tape'],
  ['congestion', 'Blocked nose or cold'],
  ['alcohol', 'Alcohol'],
]);
const noPitch: ProfilePitch = { band: null, nights: 0 };

/** Twelve full nights, oldest first, scoring 52 unless `make` says otherwise. */
function nights(make: (i: number) => Partial<NightSummary>, count = 12): NightSummary[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    score: 52,
    pct_snoring: 0.3,
    duration_s: 8 * 3600,
    partial: false,
    typical: null,
    remedies: [],
    factors: [],
    ...make(i),
  }));
}
const profile = (over: Partial<ProfileInput>): SnoreProfile =>
  buildSnoreProfile({ history: [], tests: [], turnedOver: { checkedNights: 0, nights: 0 }, pitch: noPitch, names, ...over });
const area = (p: SnoreProfile, a: ProfileArea) => p.areas.find((x) => x.area === a)!;
const verdictOf = (kind: 'helped' | 'worse' | 'no_clear_difference', difference: number, confidence: 'high' | 'medium' | 'low' = 'high'): Verdict => ({
  kind,
  medianWith: 52 + difference,
  medianWithout: 52,
  difference,
  confidence,
  nightsWith: 7,
  nightsWithout: 7,
});

describe('the snore profile', () => {
  /** Side sleeping on the first six nights, 12 points lower. */
  const onSide = nights((i) => (i < 6 ? { remedies: ['side_sleeping'], score: 40 } : {}));

  it('says it needs more nights until there is something to go on', () => {
    const p = profile({ pitch: { band: 'low', hz: 140, nights: 4, spread: [{ band: 'low', nights: 4 }] } });
    expect(p.areas.map((a) => [a.area, a.rating, a.evidence, a.tested])).toEqual([
      ['position', 'more_nights', [], false],
      ['nose', 'more_nights', [], false],
      ['mouth', 'more_nights', [], false],
      ['muscles', 'more_nights', [], false],
    ]);
    expect(p.pitch).toEqual({ band: 'low', hz: 140, nights: 4, spread: [{ band: 'low', nights: 4 }] });
  });

  it('reads a remedy from the person’s own nights with and without it', () => {
    const p = profile({ history: onSide });
    expect(area(p, 'position')).toEqual({ area: 'position', name: 'Position', rating: 'strong', evidence: ['Slept on side: 12 points lower over 6 nights'], tested: false });
    expect(area(p, 'nose').rating).toBe('more_nights');
  });

  it('counts a factor when the score is higher with it, and a remedy only when lower', () => {
    // A blocked nose and mouth tape on the same nights, 8 points higher.
    const p = profile({ history: nights((i) => (i < 6 ? { factors: [{ id: 'congestion', value: null }], remedies: ['mouth_tape'], score: 60 } : {})) });
    expect(area(p, 'nose')).toMatchObject({ rating: 'some', evidence: ['Blocked nose or cold: 8 points higher over 6 nights'] });
    expect(area(p, 'mouth')).toMatchObject({ rating: 'none', evidence: ['Mouth tape: 8 points higher over 6 nights'] });
    // Alcohol nights that scored lower are no sign of relaxed muscles.
    const lower = profile({ history: nights((i) => (i < 6 ? { factors: [{ id: 'alcohol', value: '3_plus' }], score: 44 } : {})) });
    expect(area(lower, 'muscles').rating).toBe('none');
  });

  it('needs five nights each way before it compares', () => {
    const p = profile({ history: nights((i) => (i < 3 ? { remedies: ['side_sleeping'], score: 40 } : {})) });
    expect(area(p, 'position')).toMatchObject({ rating: 'more_nights', evidence: ['Slept on side: 3 nights so far, 5 each way to compare'] });
  });

  it('lets a finished test count for more than nights that were only logged', () => {
    const same = profile({ history: onSide, tests: [{ remedyId: 'side_sleeping', verdict: verdictOf('no_clear_difference', -2) }] });
    expect(area(same, 'position')).toMatchObject({ rating: 'none', evidence: ['Slept on side: no clear difference in your test'], tested: true });

    const rating = (v: Verdict) => area(profile({ tests: [{ remedyId: 'side_sleeping', verdict: v }] }), 'position').rating;
    expect(rating(verdictOf('helped', -12))).toBe('strong');
    expect(rating(verdictOf('helped', -12, 'medium'))).toBe('some');
    expect(rating(verdictOf('helped', -6))).toBe('some');
    expect(rating(verdictOf('worse', 7))).toBe('none');
    expect(area(profile({ tests: [{ remedyId: 'side_sleeping', verdict: verdictOf('helped', -12) }] }), 'position').evidence).toEqual([
      'Slept on side: 12 points lower in your test (high confidence)',
    ]);
  });

  it('uses the latest test of a remedy, and logged nights while a test had too few', () => {
    const tests = [
      { remedyId: 'side_sleeping', verdict: verdictOf('helped', -12) },
      { remedyId: 'side_sleeping', verdict: verdictOf('no_clear_difference', 0) },
    ];
    expect(area(profile({ tests }), 'position').rating).toBe('none');
    const notEnough: Verdict = { kind: 'not_enough', nightsWith: 3, nightsWithout: 6 };
    expect(area(profile({ history: onSide, tests: [{ remedyId: 'side_sleeping', verdict: notEnough }] }), 'position')).toMatchObject({
      rating: 'strong',
      tested: false,
    });
  });

  it('takes turning over and the snoring stopping as a clue to position', () => {
    expect(area(profile({ turnedOver: { checkedNights: 10, nights: 2 } }), 'position').rating).toBe('more_nights');
    expect(area(profile({ turnedOver: { checkedNights: 10, nights: 3 } }), 'position')).toMatchObject({
      rating: 'some',
      evidence: ['Turned over and the snoring stopped on 3 nights'],
    });
    // The strongest clue comes first.
    expect(area(profile({ history: onSide, turnedOver: { checkedNights: 10, nights: 4 } }), 'position').evidence).toEqual([
      'Slept on side: 12 points lower over 6 nights',
      'Turned over and the snoring stopped on 4 nights',
    ]);
  });
});

describe('the snore profile from the phone', () => {
  it('starts the tests together and reads a finished one into the profile', async () => {
    const db = openTestDb();
    await migrate(db);
    await seedCatalogueIfEmpty(db);
    const empty = await loadSnoreProfile(db);
    expect(empty.pitch).toEqual({ band: null, nights: 0 });
    expect(empty.areas.map((a) => a.rating)).toEqual(['more_nights', 'more_nights', 'more_nights', 'more_nights']);

    // A running test of one of the remedies is replaced by the group's.
    await startExperiment(db, { id: 'old', remedyId: 'nasal_strips', started: '2026-09-01', pattern: createPattern(1) });
    const plans = typeTestPlans(42, 3);
    await startTestGroup(
      db,
      TYPE_TEST_GROUP,
      '2026-10-01',
      TYPE_TESTS.map((t, i) => ({ id: `t${i}`, remedyId: t.remedyId, pattern: plans[i] })),
    );
    const running = await runningExperiments(db);
    expect(running.map((e) => [e.remedyId, e.group, e.started]).sort()).toEqual([
      ['mouth_tape', 'type', '2026-10-01'],
      ['nasal_strips', 'type', '2026-10-01'],
      ['side_sleeping', 'type', '2026-10-01'],
    ]);
    expect(running.find((e) => e.remedyId === 'side_sleeping')?.pattern).toEqual(plans[0]);
    expect((await listExperiments(db)).find((e) => e.id === 'old')?.status).toBe('cancelled');

    await completeExperiment(db, 't0', verdictOf('helped', -14));
    const hive = await loadSnoreProfile(db);
    expect(area(hive, 'position')).toEqual({
      area: 'position',
      name: 'Position',
      rating: 'strong',
      evidence: ['Slept on side: 14 points lower in your test (high confidence)'],
      tested: true,
    });
    expect(hive.lockedVerdicts).toBe(0);
    // A Bee runs the tests too; the verdict is part of the Hive, so the profile leaves it out.
    const bee = await loadSnoreProfile(db, { verdicts: false });
    expect(area(bee, 'position')).toMatchObject({ rating: 'more_nights', evidence: [], tested: false });
    expect(bee.lockedVerdicts).toBe(1);
  });

  it('describes the pitch once three nights have one', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const newId = () => `x${++n}`;
    for (const [day, hz] of [
      [10, 140],
      [11, 1300],
      [12, 150],
    ]) {
      const startedAt = new Date(2026, 9, day, 23, 0);
      const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.2, 15) });
      const id = `night${day}`;
      await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
      const events = await nightEvents(db, id);
      await saveSnorePitch(
        db,
        id,
        events.slice(0, 2).map((e) => ({ startS: e.start_s, endS: e.end_s, hz, seconds: 20 })),
      );
      if (day === 11) expect((await loadSnoreProfile(db)).pitch).toEqual({ band: null, nights: 2 });
    }
    expect((await loadSnoreProfile(db)).pitch).toEqual({
      band: 'low',
      hz: 150,
      nights: 3,
      spread: [
        { band: 'low', nights: 2 },
        { band: 'high', nights: 1 },
      ],
    });
  });
});

describe('the snore profile in the doctor report', () => {
  const base: ReportData = {
    from: '2026-10-01',
    to: '2026-10-20',
    generatedAt: new Date('2026-10-21T08:00:00Z'),
    nights: [{ date: '2026-10-01', score: 60, pctSnoring: 0.3, timeInBedS: 8 * 3600, partial: false, events: { quiet: 1, light: 2, loud: 3, epic: 1 }, spo2Dips: null, spo2Min: null }],
    factors: [],
    remedies: [],
    profile: { ageBand: null, pausesReported: null },
  };

  it('words the profile and heavy breathing as clues for discussion', () => {
    const html = reportHtml({
      ...base,
      snoreProfile: {
        pitch: { band: 'low', hz: 142, nights: 9, spread: [{ band: 'low', nights: 7 }, { band: 'mid', nights: 2 }] },
        areas: [
          { name: 'Position', rating: 'strong', evidence: ['Slept on side: 14 points lower in your test (high confidence)'] },
          { name: 'Nose', rating: 'more_nights', evidence: [] },
        ],
      },
      breathing: { checkedNights: 12, nights: 3, minutes: 41 },
    });
    expect(html).toContain('<h2>Snore profile</h2>');
    expect(html).toContain('<b>low and fluttery</b>, around 140 Hz, from 9 nights (low and fluttery on 7 nights, mid-pitched on 2 nights).');
    expect(html).toContain('<td>Position</td><td>Strong effect</td><td>Slept on side: 14 points lower in your test (high confidence)</td>');
    expect(html).toContain('<td>Nose</td><td>Needs more nights</td><td><span class="muted">Nothing logged</span></td>');
    expect(html).toContain('was heard on 3 of 12 nights in this period, 41 minutes in all.');
    expect(html).toContain('None of this shows where the snoring comes from.');
    expect(html).not.toMatch(/diagnos(is|ed)\b|apnoea detected|sleep apnea/i);
  });

  it('says when there are too few nights with a pitch, and leaves the section out with nothing to show', () => {
    const html = reportHtml({ ...base, snoreProfile: { pitch: { band: null, nights: 1 }, areas: [] }, breathing: { checkedNights: 0, nights: 0, minutes: 0 } });
    expect(html).toContain('Not enough nights with a measured pitch yet.');
    expect(html).not.toContain('Heavy breathing');
    expect(reportHtml(base)).not.toContain('Snore profile');
  });
});
