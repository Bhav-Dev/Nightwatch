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
