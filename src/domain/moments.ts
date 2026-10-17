/**
 * The night as a list of moments the morning screen can step through with previous and next:
 * each stretch of snoring, each loud sound that was not counted as snoring, and any other
 * recorded sound in between. Quiet stretches are skipped.
 */
export type MomentKind = 'snore' | 'other' | 'sound';

export interface Moment {
  startS: number;
  endS: number;
  kind: MomentKind;
  /** Loudness above the night's floor, when known. */
  peakDb: number | null;
  /** The user answered "snoring" or "not snoring" for (part of) this moment. */
  answered: boolean;
}

/** Recorded sound shorter than this, once snoring and other sounds are taken out, is not a moment. */
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
  const taken: Range[] = [...snoring, ...otherMerged];
  const sound = input.recorded
    .flatMap((r) => subtract(r, taken))
    .filter((r) => r.endS - r.startS >= MIN_SOUND_MOMENT_S)
    .map((r) => ({ ...r, kind: 'sound' as const, peakDb: null }));
  return [...snoring, ...otherMerged, ...sound]
    .map((m) => ({ startS: m.startS, endS: m.endS, kind: m.kind, peakDb: m.peakDb, answered: input.answered.some((a) => overlaps(a, m)) }))
    .sort((a, b) => a.startS - b.startS);
}

/** The moment containing a second, or null. */
export function momentAt(moments: readonly Moment[], atS: number): Moment | null {
  return moments.find((m) => atS >= m.startS && atS < m.endS) ?? null;
}

/** The next moment starting after `atS`, or the previous one ending before it. */
export function neighbour(moments: readonly Moment[], atS: number, direction: 1 | -1): Moment | null {
  if (direction === 1) return moments.find((m) => m.startS > atS) ?? null;
  const current = momentAt(moments, atS);
  const before = moments.filter((m) => m.startS < (current ? current.startS : atS));
  return before[before.length - 1] ?? null;
}
