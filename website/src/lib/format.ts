const number = new Intl.NumberFormat('en-GB');
const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
const longDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthYear = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthOnly = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' });

/** 21470 → "21,470" */
export const count = (n: number) => number.format(n);

/** 29.99 → "£29.99" */
export const price = (n: number) => money.format(n);

/** "2026-10-01" or a Date → "1 October 2026" */
export const date = (d: string | Date) => longDate.format(typeof d === 'string' ? new Date(d) : d);

/** "2026-10-01" → "October 2026" */
export const month = (d: string | Date) => monthYear.format(typeof d === 'string' ? new Date(d) : d);

/** "2026-10-01" → "October" */
export const monthName = (d: string | Date) => monthOnly.format(typeof d === 'string' ? new Date(d) : d);

/** "2026-07-01", "2026-09-30" → "1 July to 30 September 2026" */
export function dateRange(from: string, to: string) {
  const a = new Date(from);
  const b = new Date(to);
  const sameYear = a.getUTCFullYear() === b.getUTCFullYear();
  const start = sameYear
    ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(a)
    : longDate.format(a);
  return `${start} to ${longDate.format(b)}`;
}

/** -27 → "27% lower", 32 → "32% higher" */
export const change = (pct: number, noun = '') =>
  `${Math.abs(Math.round(pct))}% ${pct < 0 ? 'lower' : 'higher'}${noun ? ` ${noun}` : ''}`;

/** -27 → "−27%" with a real minus sign */
export const signedPct = (pct: number) => `${pct < 0 ? '−' : pct > 0 ? '+' : ''}${Math.abs(Math.round(pct))}%`;
