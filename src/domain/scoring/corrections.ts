/**
 * The user's "was this snoring?" answers, applied to a night.
 *
 * Each answer covers a stretch of the night (a clip, or a moment picked on the timeline):
 * - "not snoring" cuts that stretch out of the detected snoring (an event can be split);
 * - "snoring" adds the stretch as snoring, merging with any snoring it touches.
 * Answers apply in the order they were given, so a later answer for the same stretch wins.
 * The night's score, time snoring and timeline are then worked out again from the result with
 * the usual formula. The detector's own events are never changed in storage, so every answer
 * can be undone, and the answers are kept as labelled examples for training the detector.
 */
import { BIN_S, MIN_EVENT_S } from './constants';
import { intensityFor } from './events';
import { meanEventDb, scoreLabel, snoreScore } from './score';
import type { ScoreLabel, SnoreEvent } from './types';

export type SoundLabelValue = 'snore' | 'not_snore';

export interface SoundLabel {
  startS: number;
  endS: number;
  label: SoundLabelValue;
  /** Loudness of the stretch above the night's floor, used when it is added as snoring. */
  peakDb: number;
  meanDb: number;
}

type Span = Omit<SnoreEvent, 'intensity'>;

function withIntensity(s: Span): SnoreEvent {
  return { ...s, intensity: intensityFor(s.peakDb) };
}

/** Removes [startS, endS) from every event; leftover pieces shorter than an event are dropped. */
function cut(events: Span[], startS: number, endS: number): Span[] {
  const out: Span[] = [];
  for (const e of events) {
    if (e.endS <= startS || e.startS >= endS) {
      out.push(e);
      continue;
    }
    // The pieces keep the event's loudness: the loudness inside the event is not stored per second.
    if (e.startS < startS) out.push({ ...e, endS: startS });
    if (e.endS > endS) out.push({ ...e, startS: endS });
  }
  return out.filter((e) => e.endS - e.startS >= MIN_EVENT_S);
}

/** Adds [startS, endS) as snoring, merged with any event it overlaps or touches. */
function add(events: Span[], s: Span): Span[] {
  let merged = { ...s };
  const rest: Span[] = [];
  for (const e of events) {
    if (e.endS < merged.startS || e.startS > merged.endS) {
      rest.push(e);
      continue;
    }
    const d1 = merged.endS - merged.startS;
    const d2 = e.endS - e.startS;
    merged = {
      startS: Math.min(merged.startS, e.startS),
      endS: Math.max(merged.endS, e.endS),
      peakDb: Math.max(merged.peakDb, e.peakDb),
      meanDb: d1 + d2 > 0 ? (merged.meanDb * d1 + e.meanDb * d2) / (d1 + d2) : merged.meanDb,
    };
  }
  return [...rest, merged];
}

/** The night's snoring after the user's answers, in time order. */
export function applyLabels(detected: readonly SnoreEvent[], labels: readonly SoundLabel[]): SnoreEvent[] {
  let spans: Span[] = detected.map(({ startS, endS, peakDb, meanDb }) => ({ startS, endS, peakDb, meanDb }));
  for (const l of labels) {
    if (l.endS <= l.startS) continue;
    spans =
      l.label === 'not_snore'
        ? cut(spans, l.startS, l.endS)
        : add(spans, { startS: l.startS, endS: l.endS, peakDb: l.peakDb, meanDb: l.meanDb });
  }
  return spans.sort((a, b) => a.startS - b.startS).map(withIntensity);
}

export interface Rescored {
  score: number;
  label: ScoreLabel;
  pctSnoring: number;
  maxDb: number;
  eventCount: number;
  /** Seconds of snoring in each 5-minute bin. */
  binSnoreS: number[];
}

/** Score, time snoring and timeline from a night's (corrected) events. */
export function rescoreNight(events: readonly SnoreEvent[], timeInBedS: number, binCount: number): Rescored {
  const snoringS = events.reduce((s, e) => s + (e.endS - e.startS), 0);
  const pctSnoring = timeInBedS > 0 ? Math.min(1, snoringS / timeInBedS) : 0;
  const score = snoreScore(pctSnoring, meanEventDb([...events]));
  const binSnoreS = new Array<number>(binCount).fill(0);
  for (const e of events) {
    for (let b = Math.floor(e.startS / BIN_S); b < binCount && b * BIN_S < e.endS; b++) {
      const from = Math.max(e.startS, b * BIN_S);
      const to = Math.min(e.endS, (b + 1) * BIN_S);
      if (to > from) binSnoreS[b] += to - from;
    }
  }
  return {
    score,
    label: scoreLabel(score),
    pctSnoring,
    maxDb: events.reduce((m, e) => Math.max(m, e.peakDb), 0),
    eventCount: events.length,
    binSnoreS: binSnoreS.map((s) => Math.min(BIN_S, s)),
  };
}

/** Whether a stretch counts as snoring after the answers (any overlap with snoring). */
export function isSnoringAt(events: readonly { startS: number; endS: number }[], startS: number, endS: number): boolean {
  return events.some((e) => e.startS < endS && e.endS > startS);
}
