/**
 * The morning summary: two to four sentences from fixed templates (no language model at
 * runtime). Rules from the spec, in order:
 * 1. Always: percent time snoring and where the snoring sat in the night.
 * 2. If Health data exists: SpO2 dips during the loudest stretch or heart-rate jumps after
 *    epic events, else "Your watch data showed no oxygen dips."
 * 3. If a factor logged that night has 5+ nights on each side: the one with the largest
 *    difference from the user's other nights.
 * 4. If a remedy was logged: its experiment day, or its running with/without difference.
 */
import { personalDifference, type NightSummary } from '../../shared/remedyEffect';
import { heartRateSpikes, spo2Dips, type AlignedSample } from './health';
import { shortLabel } from './labels';
import type { SnoreEvent } from './scoring';

export interface SummaryInput {
  startedAtEpochS: number;
  pctSnoring: number;
  events: readonly Pick<SnoreEvent, 'startS' | 'endS' | 'intensity'>[];
  health: { samples: readonly AlignedSample[]; hrMean: number | null } | null;
  factorsLogged: readonly { id: string; name: string }[];
  remediesLogged: readonly { id: string; name: string }[];
  /** All the user's nights including this one, for personal differences. */
  history: readonly NightSummary[];
  /** A running experiment on one of tonight's remedies. */
  experiment: { remedyId: string; day: number } | null;
}

/** Events no more than this far apart belong to one stretch. */
export const STRETCH_GAP_S = 20 * 60;
/** A stretch holding this share of events is "mostly". */
export const STRETCH_SHARE = 0.4;
/** Less snoring than this in total is described as brief, without a percentage. */
export const BRIEF_SNORING_S = 5 * 60;

export function clock(startedAtEpochS: number, offsetS: number): string {
  const d = new Date((startedAtEpochS + offsetS) * 1000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** The group of events (≤ 20 minutes apart) holding the most events. */
export function mainStretch(events: readonly { startS: number; endS: number }[]) {
  if (events.length === 0) return null;
  const sorted = [...events].sort((a, b) => a.startS - b.startS);
  const groups: { startS: number; endS: number; count: number }[] = [];
  for (const e of sorted) {
    const g = groups[groups.length - 1];
    if (g && e.startS - g.endS <= STRETCH_GAP_S) {
      g.endS = Math.max(g.endS, e.endS);
      g.count++;
    } else groups.push({ startS: e.startS, endS: e.endS, count: 1 });
  }
  return groups.reduce((a, b) => (b.count > a.count ? b : a));
}

function pointsPhrase(diff: number, direction: 'higher' | 'lower'): string {
  const n = Math.round(Math.abs(diff));
  return `${n} ${n === 1 ? 'point' : 'points'} ${direction}`;
}

export function morningSummary(input: SummaryInput): string[] {
  const out: string[] = [];
  const pct = Math.round(input.pctSnoring * 100);

  // 1
  const stretch = mainStretch(input.events);
  const snoringS = input.events.reduce((s, e) => s + (e.endS - e.startS), 0);
  if (!stretch) {
    out.push('No snoring was picked up last night.');
  } else if (snoringS < BRIEF_SNORING_S) {
    // A percentage and a "mostly between" range read oddly for a few seconds of snoring.
    const first = clock(input.startedAtEpochS, Math.min(...input.events.map((e) => e.startS)));
    out.push(
      input.events.length === 1
        ? `Snoring was picked up once, briefly, at ${first}.`
        : `Snoring was picked up ${input.events.length} times, briefly, adding up to under 5 minutes.`,
    );
  } else if (stretch.count / input.events.length >= STRETCH_SHARE) {
    const from = clock(input.startedAtEpochS, stretch.startS);
    const to = clock(input.startedAtEpochS, stretch.endS);
    out.push(`You snored for ${pct}% of the night, ${from === to ? `mostly around ${from}` : `mostly between ${from} and ${to}`}.`);
  } else {
    out.push(`You snored for ${pct}% of the night, spread across the night.`);
  }

  // 2
  if (input.health) {
    const window = stretch ?? { startS: 0, endS: Number.MAX_SAFE_INTEGER };
    const dips = spo2Dips(input.health.samples).filter((d) => d.startS < window.endS && d.endS > window.startS);
    const epic = input.events.filter((e) => e.intensity === 'epic');
    const spikes = heartRateSpikes(input.health.samples, epic, input.health.hrMean);
    const parts: string[] = [];
    if (dips.length > 0) parts.push(`Oxygen dipped ${times(dips.length)} during the loudest stretch`);
    if (spikes > 0) {
      const hr = `heart rate jumped during ${spikes} of your loudest moments`;
      parts.push(parts.length ? `and your ${hr}` : `Your ${hr}`);
    }
    out.push(parts.length ? `${parts.join(', ')}.` : 'Your watch data showed no oxygen dips.');
  }

  // 3
  let bestFactor: { name: string; diff: number } | null = null;
  for (const f of input.factorsLogged) {
    const diff = personalDifference(input.history, f.id);
    if (diff !== null && (!bestFactor || Math.abs(diff) > Math.abs(bestFactor.diff))) {
      bestFactor = { name: shortLabel(f.id, f.name), diff };
    }
  }
  if (bestFactor) {
    out.push(
      Math.round(Math.abs(bestFactor.diff)) < 2
        ? `You logged ${bestFactor.name}; your ${bestFactor.name} nights are about the same as your others.`
        : `You logged ${bestFactor.name}; your ${bestFactor.name} nights average ${pointsPhrase(bestFactor.diff, bestFactor.diff > 0 ? 'higher' : 'lower')}.`,
    );
  }

  // 4
  const exp = input.experiment && input.remediesLogged.find((r) => r.id === input.experiment!.remedyId);
  if (exp && input.experiment) {
    out.push(`Night ${input.experiment.day} of your ${shortLabel(exp.id, exp.name)} test.`);
  } else {
    for (const r of input.remediesLogged) {
      const diff = personalDifference(input.history, r.id);
      if (diff === null) continue;
      const name = shortLabel(r.id, r.name);
      out.push(
        Math.round(Math.abs(diff)) < 2
          ? `Your ${name} nights are about the same as your others so far.`
          : `Your ${name} nights average ${pointsPhrase(diff, diff > 0 ? 'higher' : 'lower')} so far.`,
      );
      break;
    }
  }
  return out;
}
