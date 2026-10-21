import { MIN_NIGHT_S, MIN_NIGHTS_EACH_SIDE, type NightSummary, personalDifference } from '../../shared/remedyEffect';
import type { Verdict } from './experiment';
import type { ProfilePitch } from './pitch';

/**
 * The snore profile: clues to where someone's snoring may come from, read from what changes it
 * (position, the nose, the mouth and jaw, relaxed muscles) and from how it sounds (its pitch).
 * Each area is rated from the person's own nights, with the same within-person comparison used
 * everywhere else, and a finished remedy test counts for more than nights that were only logged.
 * It points to which remedies to try first; it is never a finding about the airway.
 */

export type ProfileArea = 'position' | 'nose' | 'mouth' | 'muscles';
export type Rating = 'strong' | 'some' | 'none' | 'more_nights';

/** A change in average score of at least this many points is a strong effect; at least SOME is some. */
export const STRONG_POINTS = 10;
export const SOME_POINTS = 5;
/** Nights where turning over stopped the snoring that make position a clue on their own. */
export const MIN_TURNED_OVER_NIGHTS = 3;

export const RATING_WORDS: Record<Rating, string> = {
  strong: 'Strong effect',
  some: 'Some effect',
  none: 'No clear effect yet',
  more_nights: 'Needs more nights',
};

const RANK: Record<Rating, number> = { more_nights: 0, none: 1, some: 2, strong: 3 };

/**
 * How each area is read. Remedies that work on it are a clue when the score is lower with them;
 * factors that weigh on it are a clue when the score is higher with them.
 */
export const AREAS: Record<ProfileArea, { name: string; remedies: readonly string[]; factors: readonly string[]; meaning: string }> = {
  position: {
    name: 'Position',
    remedies: ['side_sleeping', 'positional_trainer', 'tennis_ball', 'anti_snore_pillow', 'wedge_pillow', 'head_elevated'],
    factors: [],
    meaning: 'If lying on your side or raising your head quietens you, your snoring may depend on how you lie, as the tongue and soft palate fall back more on your back.',
  },
  nose: {
    name: 'Nose',
    remedies: ['nasal_strips', 'nasal_dilator', 'nasal_spray_saline', 'nasal_spray_decongestant', 'nasal_rinse'],
    factors: ['congestion', 'allergies'],
    meaning: 'If opening your nose helps, or a blocked nose makes it worse, your nose may be part of your snoring.',
  },
  mouth: {
    name: 'Mouth and jaw',
    remedies: ['mouth_tape', 'chin_strap', 'mad_device', 'tongue_retainer'],
    factors: [],
    meaning: 'If keeping your mouth closed or your jaw forward helps, breathing through your mouth or your jaw and tongue dropping back may be part of it.',
  },
  muscles: {
    name: 'Relaxed muscles',
    remedies: ['no_alcohol_evening'],
    factors: ['alcohol', 'very_tired', 'sleep_aid'],
    meaning: 'If alcohol, tiredness or a sleep aid makes it louder, the muscles in your throat may relax more on those nights.',
  },
};

export const AREA_ORDER: readonly ProfileArea[] = ['position', 'nose', 'mouth', 'muscles'];

export interface AreaResult {
  area: ProfileArea;
  name: string;
  rating: Rating;
  /** What the rating rests on, in words, strongest first. */
  evidence: string[];
  /** A finished remedy test is part of it (a fairer comparison than logged nights). */
  tested: boolean;
}

export interface SnoreProfile {
  pitch: ProfilePitch;
  areas: AreaResult[];
}

export interface ProfileInput {
  /** Every night, oldest first. */
  history: readonly NightSummary[];
  /** Finished remedy tests and their verdicts. */
  tests: readonly { remedyId: string; verdict: Verdict }[];
  /** Nights checked for movement, and how many of them had turning over stop the snoring. */
  turnedOver: { checkedNights: number; nights: number };
  pitch: ProfilePitch;
  /** Catalogue names by id. */
  names: ReadonlyMap<string, string>;
}

function ratingFor(effect: number): Rating {
  return effect >= STRONG_POINTS ? 'strong' : effect >= SOME_POINTS ? 'some' : 'none';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Clue {
  rating: Rating;
  /** Points of score, for ordering clues of the same rating. */
  effect: number;
  words: string;
  tested: boolean;
}

/** A finished test's clue for its remedy, or null while it has too few nights to say. */
function testClue(name: string, v: Verdict): Clue | null {
  if (v.kind === 'not_enough') return null;
  const points = Math.round(Math.abs(v.difference));
  if (v.kind === 'helped') {
    const effect = -v.difference;
    return {
      rating: effect >= STRONG_POINTS && v.confidence === 'high' ? 'strong' : 'some',
      effect,
      words: `${name}: ${points} points lower in your test (${v.confidence} confidence)`,
      tested: true,
    };
  }
  if (v.kind === 'worse') return { rating: 'none', effect: -v.difference, words: `${name}: ${points} points higher in your test`, tested: true };
  return { rating: 'none', effect: 0, words: `${name}: no clear difference in your test`, tested: true };
}

/** A logged remedy's or factor's clue, from the person's own nights with and without it. */
function loggedClue(history: readonly NightSummary[], id: string, name: string, kind: 'remedy' | 'factor'): Clue | null {
  const counted = history.filter((n) => !n.partial && n.duration_s >= MIN_NIGHT_S);
  const has = (n: NightSummary) => (kind === 'remedy' ? n.remedies.includes(id) : n.factors.some((f) => f.id === id));
  const nightsWith = counted.filter(has).length;
  if (nightsWith === 0) return null;
  const diff = personalDifference(history, id);
  if (diff === null) {
    return {
      rating: 'more_nights',
      effect: 0,
      words: `${name}: ${plural(nightsWith, 'night', 'nights')} so far, ${MIN_NIGHTS_EACH_SIDE} each way to compare`,
      tested: false,
    };
  }
  // A remedy helps when the score is lower with it; a factor weighs in when the score is higher.
  const effect = kind === 'remedy' ? -diff : diff;
  const points = Math.round(Math.abs(diff));
  const direction = diff < 0 ? 'lower' : 'higher';
  return {
    rating: ratingFor(effect),
    effect,
    words: points < 2 ? `${name}: about the same over ${plural(nightsWith, 'night', 'nights')}` : `${name}: ${points} points ${direction} over ${plural(nightsWith, 'night', 'nights')}`,
    tested: false,
  };
}

/** Builds the profile from the person's nights, tests and what was heard in their nights. */
export function buildSnoreProfile(input: ProfileInput): SnoreProfile {
  const testsByRemedy = new Map<string, Verdict>();
  // The latest finished test of a remedy is the one that counts.
  for (const t of input.tests) testsByRemedy.set(t.remedyId, t.verdict);
  const nameOf = (id: string) => input.names.get(id) ?? id;

  const areas = AREA_ORDER.map((area): AreaResult => {
    const def = AREAS[area];
    const clues: Clue[] = [];
    for (const id of def.remedies) {
      const verdict = testsByRemedy.get(id);
      // A remedy's finished test replaces its logged nights: the test is the fairer comparison.
      const fromTest = verdict ? testClue(nameOf(id), verdict) : null;
      const clue = fromTest ?? loggedClue(input.history, id, nameOf(id), 'remedy');
      if (clue) clues.push(clue);
    }
    for (const id of def.factors) {
      const clue = loggedClue(input.history, id, nameOf(id), 'factor');
      if (clue) clues.push(clue);
    }
    if (area === 'position' && input.turnedOver.nights >= MIN_TURNED_OVER_NIGHTS) {
      clues.push({
        rating: 'some',
        effect: SOME_POINTS,
        words: `Turned over and the snoring stopped on ${plural(input.turnedOver.nights, 'night', 'nights')}`,
        tested: false,
      });
    }
    clues.sort((a, b) => RANK[b.rating] - RANK[a.rating] || b.effect - a.effect);
    return {
      area,
      name: def.name,
      rating: clues[0]?.rating ?? 'more_nights',
      evidence: clues.map((c) => c.words),
      tested: clues.some((c) => c.tested),
    };
  });
  return { pitch: input.pitch, areas };
}
