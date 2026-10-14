/**
 * Statistics used identically by the app and the aggregation job. Quantiles use linear
 * interpolation between closest ranks (the "type 7" definition used by R and NumPy), so a
 * reference implementation in either can be compared to 0.1.
 */

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export const median = (values: readonly number[]) => quantile(values, 0.5);

export function mean(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, x) => s + x, 0) / values.length;
}

/** Whole days between two yyyy-mm-dd dates (b − a). Suffixed keys ("2026-10-14#2") are fine. */
export function daysBetween(a: string, b: string): number {
  const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}
