import type { Frame } from '../../src/domain/scoring';

export interface FixtureEvent {
  startS: number;
  durationS: number;
  /** Level above the floor for every second of the event. */
  db: number;
}

export const FLOOR_DB = -60;

/**
 * A night of frames at the floor level with snoring events at fixed levels. Lets tests
 * state the expected score by hand.
 */
export function fixtureNight(durationS: number, events: FixtureEvent[]): Frame[] {
  const frames: Frame[] = [];
  for (let t = 0; t < durationS; t++) frames.push({ t, levelDb: FLOOR_DB, snoreProb: 0.05 });
  for (const e of events) {
    for (let t = e.startS; t < e.startS + e.durationS; t++) {
      frames[t] = { t, levelDb: FLOOR_DB + e.db, snoreProb: 0.95 };
    }
  }
  return frames;
}

/** Evenly spaced events (60 s apart) covering `pct` of the night at `db` above floor. */
export function evenNight(hours: number, pct: number, db: number, eventS = 120): Frame[] {
  const durationS = hours * 3600;
  const total = Math.round(pct * durationS);
  const count = Math.round(total / eventS);
  const spacing = count > 0 ? Math.floor(durationS / count) : durationS;
  const events: FixtureEvent[] = [];
  for (let i = 0; i < count; i++) events.push({ startS: i * spacing, durationS: eventS, db });
  return fixtureNight(durationS, events);
}
