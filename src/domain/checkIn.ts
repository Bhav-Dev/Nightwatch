/**
 * The morning check-in: how rested the person feels, and how their partner slept. A quieter
 * night matters less if it does not feel better, so remedies and patterns are compared on this
 * too. Kept on this phone.
 */

export const RESTED_OPTIONS = [
  { value: 1, label: 'Worn out' },
  { value: 2, label: 'Tired' },
  { value: 3, label: 'OK' },
  { value: 4, label: 'Rested' },
  { value: 5, label: 'Refreshed' },
] as const;

export const PARTNER_OPTIONS = [
  { value: 1, label: 'Badly' },
  { value: 2, label: 'OK' },
  { value: 3, label: 'Well' },
] as const;

/** The catalogue factor for sleeping alone: no partner question that night. */
export const SLEPT_ALONE_ID = 'partner_absent';

export const restedLabel = (value: number | null): string | null => RESTED_OPTIONS.find((o) => o.value === value)?.label ?? null;
