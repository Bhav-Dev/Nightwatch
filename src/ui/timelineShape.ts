/**
 * Geometry for the night timeline: a loudness outline mirrored around a centre line, like the
 * overview of a voice memo. It is drawn from the stored 5-minute bins (the audio itself is never
 * kept), so it shows how loud each stretch of the night was, not a recording. No React Native
 * imports, so it runs under plain Jest.
 */

/** Mean level above the night's floor that fills the full height. */
export const OUTLINE_FULL_SCALE_DB = 20;
/** A silent stretch still shows as a thin line rather than nothing. */
export const OUTLINE_MIN = 0.04;

/** Each bin's height as a share of the half-height, from its mean level above the floor. */
export function outlineAmplitudes(levelsDb: readonly number[], fullScaleDb = OUTLINE_FULL_SCALE_DB): number[] {
  return levelsDb.map((db) => Math.max(OUTLINE_MIN, Math.min(1, (Number.isFinite(db) ? Math.max(0, db) : 0) / fullScaleDb)));
}

const f = (n: number) => n.toFixed(1);

/**
 * Quadratic curves through the midpoints, with the points themselves as control points: smooth,
 * and never overshoots the data, so a quiet stretch never bulges.
 */
function smooth(points: readonly { x: number; y: number }[]): string {
  let d = '';
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i];
    const q = points[i + 1];
    d += ` Q${f(p.x)},${f(p.y)} ${f((p.x + q.x) / 2)},${f((p.y + q.y) / 2)}`;
  }
  const last = points[points.length - 1];
  return `${d} L${f(last.x)},${f(last.y)}`;
}

/**
 * Closed SVG path of the outline across the full width: the upper edge left to right through the
 * bin centres, then its mirror image below the centre line, right to left.
 */
export function outlinePath(amps: readonly number[], width: number, centreY: number, halfHeight: number): string {
  const n = amps.length;
  if (n === 0 || width <= 0) return '';
  const step = width / n;
  const edge = [{ x: 0, a: amps[0] }, ...amps.map((a, i) => ({ x: (i + 0.5) * step, a })), { x: width, a: amps[n - 1] }];
  const top = edge.map((p) => ({ x: p.x, y: centreY - p.a * halfHeight }));
  const bottom = [...edge].reverse().map((p) => ({ x: p.x, y: centreY + p.a * halfHeight }));
  return `M${f(top[0].x)},${f(top[0].y)}${smooth(top)} L${f(bottom[0].x)},${f(bottom[0].y)}${smooth(bottom)} Z`;
}

/** Consecutive bins with the same colour key, merged so the fill has no seams between bins. */
export function colourRuns<K extends string>(keys: readonly (K | null)[]): { start: number; end: number; key: K }[] {
  const runs: { start: number; end: number; key: K }[] = [];
  keys.forEach((key, i) => {
    if (key === null) return;
    const last = runs[runs.length - 1];
    if (last && last.key === key && last.end === i) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, key });
  });
  return runs;
}

/** An hour label's x, kept inside the chart so the first and last labels are never cut off. */
export function labelX(x: number, width: number, halfLabelWidth = 14): number {
  return Math.min(Math.max(x, halfLabelWidth), width - halfLabelWidth);
}
