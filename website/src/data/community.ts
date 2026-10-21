/**
 * Every community figure the site shows is in this file.
 *
 * SAMPLE NUMBERS. SnoreHive has not published community results yet, so the figures below are
 * made up to show the layout. While `sample` is true, every page that shows them says so.
 * When the nightly aggregates exist, copy the real figures in from the aggregate job's output,
 * check each short answer still matches its numbers, and set `sample` to false.
 */
export const sample = true;

/** The sample-size rules from /methods. */
export const rules = {
  fullPeople: 30,
  fullNights: 300,
  earlyPeople: 10,
  /** Groups (age band, sleep position and so on) with fewer people are never shown. */
  minGroupPeople: 10,
};

export type Tier = 'full' | 'early' | 'testing';

/** Full results are ranked; early data is shown muted and unranked; under 10 people, no figure. */
export function tier(people: number, nights: number): Tier {
  if (people >= rules.fullPeople && nights >= rules.fullNights) return 'full';
  if (people >= rules.earlyPeople) return 'early';
  return 'testing';
}

export interface GroupResult {
  label: string;
  /** Median change in snore score, in percent. Negative is less snoring. null: not enough people yet. */
  changePct: number | null;
}

export interface RemedyResult {
  people: number;
  nights: number;
  /** Median of each person's own change in snore score, in percent. Negative is less snoring. */
  changePct: number;
  /** Share of people whose own two-week test said it helped, in percent. */
  helpedPct: number;
  /** One or two plain sentences that the figures support. Rewrite when the figures change. */
  shortAnswer: string;
  groups: GroupResult[];
  /** When the figures were last rebuilt (ISO date). */
  updated: string;
}

/** Keyed by the remedy page's file name in src/content/remedies. */
export const remedies: Record<string, RemedyResult> = {
  'side-sleeping': {
    people: 1206,
    nights: 18340,
    changePct: -36,
    helpedPct: 71,
    shortAnswer:
      'For most people it made a clear difference. It helped people who snore mostly on their back the most, and changed little for people who already sleep on their side.',
    groups: [
      { label: 'Snore mostly on the back', changePct: -44 },
      { label: 'Aged 50 and over', changePct: -29 },
      { label: 'Breathe through the mouth at night', changePct: -21 },
    ],
    updated: '2026-10-01',
  },
  'mouth-tape': {
    people: 412,
    nights: 5980,
    changePct: -27,
    helpedPct: 58,
    shortAnswer:
      'For most people it made a moderate difference. It helped people who breathe through the mouth at night the most, and did little for people who snore on their back.',
    groups: [
      { label: 'Breathe through the mouth at night', changePct: -38 },
      { label: 'Snore mostly on the back', changePct: -11 },
      { label: 'Aged 50 and over', changePct: null },
    ],
    updated: '2026-10-01',
  },
  'nasal-strips': {
    people: 268,
    nights: 3410,
    changePct: -19,
    helpedPct: 46,
    shortAnswer:
      'For most people it made a small difference. It helped people who breathe through the mouth at night the most.',
    groups: [
      { label: 'Breathe through the mouth at night', changePct: -24 },
      { label: 'Snore mostly on the back', changePct: -9 },
      { label: 'Aged 50 and over', changePct: null },
    ],
    updated: '2026-10-01',
  },
  'anti-snore-pillows': {
    people: 22,
    nights: 260,
    changePct: -9,
    helpedPct: 41,
    shortAnswer:
      'Too few people have tested a pillow for a firm answer yet. Designs vary a lot, so these early figures mix very different pillows.',
    groups: [
      { label: 'Snore mostly on the back', changePct: null },
      { label: 'Aged 50 and over', changePct: null },
    ],
    updated: '2026-10-01',
  },
};

/** Factors are things people log that are not remedies, shown after the remedies on the home page. */
export const factors = {
  alcohol: {
    label: 'After alcohol',
    nights: 21470,
    /** Median change in snore score on nights after drinks, in percent. Positive is more snoring. */
    changePct: 32,
  },
};

/** The figures behind "Does alcohol make snoring worse?" */
export const alcohol = {
  people: 1830,
  nights: 21470,
  from: '2026-07-01',
  to: '2026-09-30',
  /** Average snore score (0 to 100) by drinks that evening, compared within each person. */
  byDrinks: [
    { band: 'None', label: 'None', score: 23, nights: 12960 },
    { band: '1–2', label: '1 to 2 drinks', score: 31, nights: 4870 },
    { band: '3–4', label: '3 to 4 drinks', score: 43, nights: 2410 },
    { band: '5+', label: '5 or more', score: 53, nights: 1230 },
  ],
  /** Share of each hour spent snoring, in percent, by hours since going to bed (hour 1 first). */
  byHour: {
    afterDrinks: [16.7, 23.3, 25.7, 22.0, 16.7, 13.3, 11.3, 10.0],
    noDrinks: [9.0, 11.0, 12.0, 11.7, 10.7, 10.0, 9.3, 8.7],
  },
  /** Share of people whose own nights showed higher scores after drinks, in percent. */
  showedEffectPct: 64,
  /** Extra points on the snore score after drinks, by group. null: not enough people yet. */
  groups: [
    { label: 'Snore mostly on the back', phrase: 'people who snore mostly on their back', points: 9 },
    { label: 'Aged 50 and over', phrase: 'people aged 50 and over', points: 7 },
    { label: 'Drinks within 2 hours of bed', phrase: 'people whose drinks were within 2 hours of bed', points: 11 },
    { label: 'Quiet snorers on other nights', phrase: 'quiet snorers', points: null },
  ] as { label: string; phrase: string; points: number | null }[],
};

/** Figures worked out from the alcohol data, so the text always matches the charts. */
export function alcoholFindings() {
  const none = alcohol.byDrinks[0];
  const heavy = alcohol.byDrinks.filter((d) => d.band === '3–4' || d.band === '5+');
  const heavyNights = heavy.reduce((n, d) => n + d.nights, 0);
  const heavyScore = heavy.reduce((s, d) => s + d.score * d.nights, 0) / heavyNights;
  const gaps = alcohol.byHour.afterDrinks.map((v, i) => v - alcohol.byHour.noDrinks[i]);
  const peakIndex = gaps.indexOf(Math.max(...gaps));
  const shown = alcohol.groups.filter((g) => g.points !== null) as { label: string; phrase: string; points: number }[];
  const top = shown.reduce((a, b) => (b.points > a.points ? b : a), shown[0]);
  return {
    /** Extra points after 3 or more drinks, against nights with none. */
    points: Math.round(heavyScore - none.score),
    /** The hour after bedtime with the widest gap (1-based). */
    peakHour: peakIndex + 1,
    hours: gaps.length,
    peakGap: Math.round(gaps[peakIndex] * 10) / 10,
    lastGap: Math.round(gaps[gaps.length - 1] * 10) / 10,
    topGroup: top,
  };
}
