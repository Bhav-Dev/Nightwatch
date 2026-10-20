import { clockTimeAt } from './interruption';

/**
 * The night as a list of moments the morning screen can step through with previous and next:
 * each stretch of snoring, each loud sound that was not counted as snoring, each movement, each
 * time the person was possibly awake, and any other recorded sound in between. Quiet stretches
 * are skipped.
 */
export type MomentKind = 'snore' | 'other' | 'move' | 'awake' | 'sound';

/**
 * The kinds the morning screen colours, filters, lists and steps through. Recorded sound with
 * nothing else in it ('sound') is only on the timeline, where dragging plays it.
 */
export type ShownKind = Exclude<MomentKind, 'sound'>;
export const SHOWN_KINDS: readonly ShownKind[] = ['snore', 'move', 'awake', 'other'];

export interface Moment {
  startS: number;
  endS: number;
  kind: MomentKind;
  /** Loudness above the night's floor, when known. */
  peakDb: number | null;
  /** The user answered "snoring" or "not snoring" for (part of) this moment. */
  answered: boolean;
}

/** Recorded sound shorter than this, once everything else is taken out, is not a moment. */
export const MIN_SOUND_MOMENT_S = 5;

interface Range {
  startS: number;
  endS: number;
}

function subtract(range: Range, taken: readonly Range[]): Range[] {
  let pieces = [range];
  for (const t of taken) {
    pieces = pieces.flatMap((p) => {
      if (t.endS <= p.startS || t.startS >= p.endS) return [p];
      const out: Range[] = [];
      if (p.startS < t.startS) out.push({ startS: p.startS, endS: t.startS });
      if (p.endS > t.endS) out.push({ startS: t.endS, endS: p.endS });
      return out;
    });
  }
  return pieces;
}

const overlaps = (a: Range, b: Range) => a.startS < b.endS && a.endS > b.startS;

export function buildMoments(input: {
  /** Snoring after the user's answers. */
  snoring: readonly (Range & { peakDb: number })[];
  /** Loud moments kept as "other sounds", and stretches the user said were not snoring. */
  other: readonly (Range & { peakDb: number | null })[];
  /** Stretches of recorded sound. */
  recorded: readonly Range[];
  /** Stretches the user has answered for. */
  answered: readonly Range[];
  /** Movement heard in the audio (left out on nights that were not checked for it). */
  movement?: readonly (Range & { peakDb?: number | null })[];
  /** When the person was possibly awake. These can run over other moments. */
  awake?: readonly Range[];
}): Moment[] {
  const snoring = input.snoring.map((s) => ({ ...s, kind: 'snore' as const }));
  const other = input.other
    .filter((o) => !snoring.some((s) => overlaps(s, o)))
    .map((o) => ({ ...o, kind: 'other' as const }));
  // Overlapping "other" stretches (a clip inside an answered stretch) become one.
  const otherMerged: typeof other = [];
  for (const o of [...other].sort((a, b) => a.startS - b.startS)) {
    const last = otherMerged[otherMerged.length - 1];
    if (last && o.startS < last.endS) {
      last.endS = Math.max(last.endS, o.endS);
      last.peakDb = last.peakDb === null ? o.peakDb : o.peakDb === null ? last.peakDb : Math.max(last.peakDb, o.peakDb);
    } else otherMerged.push({ ...o });
  }
  const movement = (input.movement ?? []).map((m) => ({ startS: m.startS, endS: m.endS, peakDb: m.peakDb ?? null, kind: 'move' as const }));
  const awake = (input.awake ?? []).map((a) => ({ startS: a.startS, endS: a.endS, peakDb: null, kind: 'awake' as const }));
  const taken: Range[] = [...snoring, ...otherMerged, ...movement];
  const sound = input.recorded
    .flatMap((r) => subtract(r, taken))
    .filter((r) => r.endS - r.startS >= MIN_SOUND_MOMENT_S)
    .map((r) => ({ ...r, kind: 'sound' as const, peakDb: null }));
  // Only snoring and other sounds can be answered for.
  const canAnswer = (kind: MomentKind) => kind === 'snore' || kind === 'other' || kind === 'sound';
  return [...snoring, ...otherMerged, ...sound, ...movement, ...awake]
    .map((m) => ({
      startS: m.startS,
      endS: m.endS,
      kind: m.kind,
      peakDb: m.peakDb,
      answered: canAnswer(m.kind) && input.answered.some((a) => overlaps(a, m)),
    }))
    .sort((a, b) => a.startS - b.startS);
}

/** The moments of the kinds picked on the morning screen, in order (never recorded sound alone). */
export function shownMoments(moments: readonly Moment[], show: ReadonlySet<ShownKind>): Moment[] {
  return moments.filter((m) => m.kind !== 'sound' && show.has(m.kind));
}

/** How many moments of each kind the night has. */
export function countByKind(moments: readonly Moment[]): Record<ShownKind, number> {
  const counts: Record<ShownKind, number> = { snore: 0, move: 0, awake: 0, other: 0 };
  for (const m of moments) if (m.kind !== 'sound') counts[m.kind]++;
  return counts;
}

/**
 * The moment containing a second, or null. A stretch of possibly being awake can hold other
 * moments; the shortest one wins, so a snore inside it is still found.
 */
export function momentAt(moments: readonly Moment[], atS: number): Moment | null {
  let best: Moment | null = null;
  for (const m of moments) {
    if (atS >= m.startS && atS < m.endS && (!best || m.endS - m.startS < best.endS - best.startS)) best = m;
  }
  return best;
}

/** The next moment starting after `atS`, or the previous one ending before it. */
export function neighbour(moments: readonly Moment[], atS: number, direction: 1 | -1): Moment | null {
  if (direction === 1) return moments.find((m) => m.startS > atS) ?? null;
  const current = momentAt(moments, atS);
  const before = moments.filter((m) => m.startS < (current ? current.startS : atS));
  return before[before.length - 1] ?? null;
}

/** Each moment's clock time; moments that start in the same minute show seconds, so they never look like duplicates. */
export function momentTimes(moments: readonly Moment[], startedAtS: number): string[] {
  const minutes = moments.map((m) => clockTimeAt(startedAtS, m.startS));
  return moments.map((m, i) =>
    minutes.filter((x) => x === minutes[i]).length > 1 ? clockTimeAt(startedAtS, m.startS, { seconds: true }) : minutes[i],
  );
}
