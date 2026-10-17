/** Local calendar date (yyyy-mm-dd) a recording started on; nights are keyed by it. */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * A second recording on the same date gets the date plus a suffix ("2026-10-14#2")
 * and is merged with the first in the UI.
 */
export function nightDateWithSuffix(date: string, existingOnDate: number): string {
  return existingOnDate === 0 ? date : `${date}#${existingOnDate + 1}`;
}

/**
 * A moment as local time with its UTC offset, e.g. "2026-10-15T23:04:12+01:00". The offset is
 * the phone's for that moment unless given (minutes east of UTC).
 */
export function localIsoWithOffset(epochMs: number, offsetMin = -new Date(epochMs).getTimezoneOffset()): string {
  const local = new Date(Math.floor(epochMs / 1000) * 1000 + offsetMin * 60_000).toISOString().slice(0, 19);
  const abs = Math.abs(offsetMin);
  const hhmm = `${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${local}${offsetMin < 0 ? '-' : '+'}${hhmm}`;
}
