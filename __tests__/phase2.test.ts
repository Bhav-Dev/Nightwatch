import type { NightSummary } from '../shared/remedyEffect';
import { createPattern, experimentDay, permutationP, planFor, verdict, verdictText } from '../src/domain/experiment';
import { alignToNight, heartRateSpikes, spo2Dips, summariseHealth, type AlignedSample } from '../src/domain/health';
import { mainStretch, morningSummary, type SummaryInput } from '../src/domain/summary';
import { REPORT_HEADER, reportHtml } from '../src/report/reportHtml';

// 2026-10-14 23:00 local (the summary prints local clock times).
const START = Math.floor(new Date(2026, 9, 14, 23, 0, 0).getTime() / 1000);
const H = 3600;

const ev = (startS: number, mins: number, intensity: 'quiet' | 'light' | 'loud' | 'epic' = 'loud') => ({
  startS,
  endS: startS + mins * 60,
  intensity,
});

function history(perFactor: Record<string, [number, number]>, count = 12): NightSummary[] {
  // First half of nights have each factor with score a, second half without at score b.
  return Array.from({ length: count }, (_, i) => {
    const factors: { id: string; value: string | null }[] = [];
    const remedies: string[] = [];
    let score = 50;
    for (const [id, [withScore, withoutScore]] of Object.entries(perFactor)) {
      const on = i < count / 2;
      if (on) (id.startsWith('r:') ? remedies.push(id.slice(2)) : factors.push({ id, value: null }));
      score = on ? withScore : withoutScore;
    }
    return { id: `h${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, score, pct_snoring: 0.3, duration_s: 8 * H, partial: false, typical: null, remedies, factors };
  });
}

const base: SummaryInput = {
  startedAtEpochS: START,
  pctSnoring: 0.38,
  events: [],
  health: null,
  factorsLogged: [],
  remediesLogged: [],
  history: [],
  experiment: null,
};

function spo2(startS: number, values: number[], everyS = 30): AlignedSample[] {
  return values.map((v, i) => ({ kind: 'spo2', startS: startS + i * everyS, endS: startS + i * everyS, value: v, stage: null }));
}
function hr(startS: number, value: number): AlignedSample {
  return { kind: 'hr', startS, endS: startS, value, stage: null };
}

describe('morning summary (20 fixture nights)', () => {
  const cases: [string, Partial<SummaryInput>, string[]][] = [
    ['no snoring', { events: [], pctSnoring: 0 }, ['No snoring was picked up last night.']],
    ['one stretch holds everything', { events: [ev(2 * H + 40 * 60, 20), ev(3 * H, 30)] }, ['You snored for 38% of the night, mostly between 1:40 and 2:30.']],
    ['spread across the night', { events: [ev(0, 5), ev(2 * H, 5), ev(4 * H, 5), ev(6 * H, 5)] }, ['You snored for 38% of the night, spread across the night.']],
    ['exactly 40% in one stretch', { events: [ev(0, 5), ev(10 * 60, 5), ev(2 * H, 5), ev(4 * H, 5), ev(6 * H, 5)] }, ['You snored for 38% of the night, mostly between 23:00 and 23:15.']],
    ['rounds percent', { pctSnoring: 0.126, events: [ev(H, 10)] }, ['You snored for 13% of the night, mostly between 0:00 and 0:10.']],
    [
      'watch: two dips in the stretch',
      { events: [ev(2 * H + 40 * 60, 50)], health: { samples: [...spo2(2 * H + 45 * 60, [88, 88]), ...spo2(3 * H + 10 * 60, [87, 86])], hrMean: 60 } },
      ['You snored for 38% of the night, mostly between 1:40 and 2:30.', 'Oxygen dipped twice during the loudest stretch.'],
    ],
    [
      'watch: dip outside the stretch does not count',
      { events: [ev(2 * H, 30)], health: { samples: spo2(6 * H, [85, 85]), hrMean: 60 } },
      ['You snored for 38% of the night, mostly between 1:00 and 1:30.', 'Your watch data showed no oxygen dips.'],
    ],
    [
      'watch: heart rate jumps after epic events',
      { events: [ev(2 * H, 5, 'epic'), ev(2 * H + 10 * 60, 5, 'epic')], health: { samples: [hr(2 * H + 30, 82), hr(2 * H + 10 * 60 + 20, 80)], hrMean: 60 } },
      ['You snored for 38% of the night, mostly between 1:00 and 1:15.', 'Your heart rate jumped during 2 of your loudest moments.'],
    ],
    [
      'watch: dips and heart rate',
      { events: [ev(2 * H, 30, 'epic')], health: { samples: [...spo2(2 * H + 60, [88, 88]), hr(2 * H + 30, 90)], hrMean: 60 } },
      ['You snored for 38% of the night, mostly between 1:00 and 1:30.', 'Oxygen dipped once during the loudest stretch, and your heart rate jumped during 1 of your loudest moments.'],
    ],
    [
      'watch: small heart rate rise is not a jump',
      { events: [ev(2 * H, 30, 'epic')], health: { samples: [hr(2 * H + 30, 70)], hrMean: 60 } },
      ['You snored for 38% of the night, mostly between 1:00 and 1:30.', 'Your watch data showed no oxygen dips.'],
    ],
    [
      'watch present, no snoring',
      { events: [], pctSnoring: 0, health: { samples: [], hrMean: null } },
      ['No snoring was picked up last night.', 'Your watch data showed no oxygen dips.'],
    ],
    [
      'factor higher',
      { events: [ev(H, 30)], factorsLogged: [{ id: 'alcohol', name: 'Alcohol' }], history: history({ alcohol: [72, 50] }) },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'You logged alcohol; your alcohol nights average 22 points higher.'],
    ],
    [
      'factor lower, singular point',
      { events: [ev(H, 30)], factorsLogged: [{ id: 'exercise', name: 'Exercised today' }], history: history({ exercise: [49, 50] }) },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'You logged exercise; your exercise nights are about the same as your others.'],
    ],
    [
      'factor with too few nights is skipped',
      { events: [ev(H, 30)], factorsLogged: [{ id: 'alcohol', name: 'Alcohol' }], history: history({ alcohol: [72, 50] }, 8) },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.'],
    ],
    [
      'largest factor wins',
      {
        events: [ev(H, 30)],
        factorsLogged: [{ id: 'late_meal', name: 'Ate within 2 hours of bed' }, { id: 'congestion', name: 'Blocked nose or cold' }],
        history: [
          ...history({ late_meal: [55, 50] }).map((n) => n),
          ...history({ congestion: [70, 50] }).map((n, i) => ({ ...n, id: `c${i}`, date: `2026-08-${String(i + 1).padStart(2, '0')}` })),
        ],
      },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'You logged blocked-nose; your blocked-nose nights average 18 points higher.'],
    ],
    [
      'remedy running difference',
      { events: [ev(H, 30)], remediesLogged: [{ id: 'mouth_tape', name: 'Mouth tape' }], history: history({ 'r:mouth_tape': [41, 50] }) },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'Your mouth tape nights average 9 points lower so far.'],
    ],
    [
      'remedy in an experiment',
      { events: [ev(H, 30)], remediesLogged: [{ id: 'mouth_tape', name: 'Mouth tape' }], experiment: { remedyId: 'mouth_tape', day: 3 } },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'Night 3 of your mouth tape test.'],
    ],
    [
      'remedy without enough nights says nothing',
      { events: [ev(H, 30)], remediesLogged: [{ id: 'nasal_strips', name: 'Nasal strips' }] },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.'],
    ],
    [
      'short label for habits',
      { events: [ev(H, 30)], remediesLogged: [{ id: 'side_sleeping', name: 'Slept on side' }], history: history({ 'r:side_sleeping': [35, 50] }) },
      ['You snored for 38% of the night, mostly between 0:00 and 0:30.', 'Your side-sleeping nights average 15 points lower so far.'],
    ],
    [
      'all four sentences',
      {
        events: [ev(2 * H + 40 * 60, 50, 'epic')],
        health: { samples: [...spo2(2 * H + 45 * 60, [88, 88])], hrMean: 60 },
        factorsLogged: [{ id: 'alcohol', name: 'Alcohol' }],
        remediesLogged: [{ id: 'mouth_tape', name: 'Mouth tape' }],
        history: history({ alcohol: [72, 50] }),
        experiment: { remedyId: 'mouth_tape', day: 6 },
      },
      [
        'You snored for 38% of the night, mostly between 1:40 and 2:30.',
        'Oxygen dipped once during the loudest stretch.',
        'You logged alcohol; your alcohol nights average 22 points higher.',
        'Night 6 of your mouth tape test.',
      ],
    ],
  ];

  it('has 20 fixtures', () => expect(cases).toHaveLength(20));
  it.each(cases)('%s', (_name, input, expected) => {
    expect(morningSummary({ ...base, ...input })).toEqual(expected);
  });

  it('describes a few minutes of snoring as brief, without a percentage or a range', () => {
    expect(morningSummary({ ...base, pctSnoring: 0.001, events: [ev(5 * H, 0.5)] })[0]).toBe('Snoring was picked up once, briefly, at 4:00.');
    expect(morningSummary({ ...base, pctSnoring: 0.003, events: [ev(5 * H, 1), ev(H, 0.5), ev(3 * H, 1)] })[0]).toBe(
      'Snoring was picked up 3 times, briefly, adding up to under 5 minutes.',
    );
  });

  it('says "around" when the main stretch starts and ends in the same minute', () => {
    expect(morningSummary({ ...base, events: [ev(H, 0.5), ev(4 * H, 6)] })[0]).toBe('You snored for 38% of the night, mostly around 0:00.');
  });

  it('groups events up to 20 minutes apart into one stretch', () => {
    expect(mainStretch([ev(0, 5), ev(25 * 60, 5), ev(2 * H, 5)])).toMatchObject({ startS: 0, endS: 30 * 60, count: 2 });
  });
});

describe('health', () => {
  const night = Math.floor(Date.UTC(2026, 9, 14, 22) / 1000);
  const at = (s: number) => new Date((night + s) * 1000);

  it('aligns samples to the night within 60 seconds and normalises SpO2 fractions', () => {
    const a = alignToNight(
      [
        { kind: 'spo2', start: at(-50), end: at(-50), value: 0.95 },
        { kind: 'spo2', start: at(-120), end: at(-120), value: 0.95 },
        { kind: 'hr', start: at(100), end: at(100), value: 55 },
        { kind: 'hr', start: at(8 * H + 30), end: at(8 * H + 30), value: 60 },
      ],
      night,
      8 * H,
    );
    expect(a).toEqual([
      { kind: 'spo2', startS: 0, endS: 0, value: 95, stage: null },
      { kind: 'hr', startS: 100, endS: 100, value: 55, stage: null },
      { kind: 'hr', startS: 8 * H, endS: 8 * H, value: 60, stage: null },
    ]);
  });

  it('counts SpO2 dips below 90% lasting 10 seconds or more', () => {
    const samples: AlignedSample[] = [
      { kind: 'spo2', startS: 0, endS: 5, value: 85, stage: null }, // 5 s: too short
      { kind: 'spo2', startS: 100, endS: 100, value: 89, stage: null }, // point: held until next
      { kind: 'spo2', startS: 130, endS: 130, value: 95, stage: null },
      { kind: 'spo2', startS: 300, endS: 330, value: 80, stage: null },
    ];
    expect(spo2Dips(samples).map((d) => [d.startS, d.endS])).toEqual([
      [100, 130],
      [300, 330],
    ]);
  });

  it('summarises a night', () => {
    const s = summariseHealth(
      [
        { kind: 'sleep_stage', startS: 0, endS: 3 * H, value: null, stage: 'light' },
        { kind: 'sleep_stage', startS: 2 * H, endS: 6 * H, value: null, stage: 'deep' },
        { kind: 'sleep_stage', startS: 6 * H, endS: 7 * H, value: null, stage: 'awake' },
        hr(10, 50),
        hr(20, 70),
        { kind: 'hrv', startS: 0, endS: 0, value: 40, stage: null },
        { kind: 'spo2', startS: 0, endS: 0, value: 93, stage: null },
      ],
      8 * H,
    );
    expect(s).toEqual({ sleep_efficiency: 0.75, spo2_min: 93, spo2_dips: 0, hr_mean: 60, hr_max: 70, hrv_mean: 40, resp_mean: null });
  });

  it('a night with no Health data has an all-null summary', () => {
    expect(Object.values(summariseHealth([], 8 * H)).every((v) => v === null)).toBe(true);
  });

  it('counts heart-rate jumps only within 60 seconds after an epic event', () => {
    // 30 s after the first event counts; 100 s after the second does not.
    expect(heartRateSpikes([hr(30, 90), hr(500, 90)], [{ startS: 0 }, { startS: 400 }], 60)).toBe(1);
  });
});

describe('experiments', () => {
  it('plans 7 with and 7 without, no more than 3 alike in a row, reproducibly', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const p = createPattern(seed);
      expect(p.filter(Boolean)).toHaveLength(7);
      expect(p.join()).not.toMatch(/(true,){3}true|(false,){3}false/);
      expect(createPattern(seed)).toEqual(p);
    }
  });

  it('maps dates to experiment nights', () => {
    expect(experimentDay('2026-10-01', '2026-10-01')).toBe(1);
    expect(experimentDay('2026-10-01', '2026-10-14')).toBe(14);
    expect(experimentDay('2026-10-01', '2026-10-15')).toBeNull();
    const p = createPattern(5);
    expect(planFor('2026-10-01', p, '2026-10-03')).toBe(p[2] ? 'with' : 'without');
  });

  it('says not enough nights below 5 a side', () => {
    expect(verdict([40, 40, 40, 40], [60, 60, 60, 60, 60, 60])).toEqual({ kind: 'not_enough', nightsWith: 4, nightsWithout: 6 });
  });

  it('gives the correct medians and a confident verdict on a clear fixture', () => {
    const v = verdict([30, 32, 35, 31, 33, 34, 29], [55, 52, 58, 50, 54, 57, 53]);
    expect(v).toMatchObject({ kind: 'helped', medianWith: 32, medianWithout: 54, difference: -22, confidence: 'high' });
    expect(verdictText(v, 'mouth tape')).toBe('Your score was 22 points lower with mouth tape (high confidence).');
  });

  it('finds no clear difference in noise', () => {
    const v = verdict([50, 42, 58, 47, 53, 49, 51], [48, 55, 44, 52, 50, 46, 54]);
    expect(v.kind).toBe('no_clear_difference');
  });

  it('permutation p is reproducible', () => {
    expect(permutationP([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])).toBe(permutationP([1, 2, 3, 4, 5], [6, 7, 8, 9, 10]));
  });
});

describe('doctor report', () => {
  it('carries the compliance header, range, counts, chart and factor table', () => {
    const html = reportHtml({
      from: '2026-09-01',
      to: '2026-09-30',
      generatedAt: new Date('2026-10-01T08:00:00Z'),
      nights: [
        { date: '2026-09-01', score: 60, pctSnoring: 0.3, timeInBedS: 8 * H, partial: false, events: { quiet: 1, light: 2, loud: 3, epic: 1 }, spo2Dips: 2, spo2Min: 86 },
        { date: '2026-09-02', score: 40, pctSnoring: 0.2, timeInBedS: 2 * H, partial: true, events: { quiet: 0, light: 1, loud: 0, epic: 0 }, spo2Dips: null, spo2Min: null },
      ],
      factors: [{ name: 'Alcohol', nightsWith: 6, nightsWithout: 9, difference: 18.4 }],
      remedies: [{ name: 'Mouth tape <b>', nightsWith: 2, nightsWithout: 9, difference: null }],
      profile: { ageBand: '40-49', pausesReported: 'yes' },
    });
    expect(html).toContain(REPORT_HEADER);
    expect(html).toContain('2026-09-01 to 2026-09-30');
    expect(html).toContain('<td>1</td><td>3</td><td>3</td><td>1</td>');
    expect(html).toContain('<svg');
    expect(html).toContain('+18.4');
    expect(html).toContain('Not enough nights');
    expect(html).toContain('Mouth tape &lt;b&gt;');
    expect(html).toContain('1 of 1 nights with watch data');
    expect(html).not.toMatch(/diagnos(is|ed)\b|sleep apnoea detected/i);
  });
});
