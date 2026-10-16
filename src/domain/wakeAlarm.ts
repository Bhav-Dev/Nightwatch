/**
 * The wake-up alarm. It is added to the phone's own Clock app when recording starts, so it rings
 * even if Nightwatch is stopped overnight, and the recording stops just before it goes off.
 */
export type WakeTime = { hour: number; minute: number };

/** Stopping a little early keeps the alarm out of the recording, and the night is ready as it rings. */
export const STOP_BEFORE_ALARM_MS = 30_000;

/** The alarm's label in the Clock app. */
export const ALARM_LABEL = 'Nightwatch';

export const DEFAULT_WAKE_TIME: WakeTime = { hour: 7, minute: 0 };

/** Stored as "HH:MM" (24-hour); anything else means no alarm. */
export function parseWakeTime(value: string | null): WakeTime | null {
  const m = value?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const [hour, minute] = [Number(m[1]), Number(m[2])];
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export const wakeSetting = ({ hour, minute }: WakeTime): string => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** When the alarm next rings after `now`, as the Clock app counts it: later today, or else tomorrow. */
export function nextAlarm(now: Date, wake: WakeTime): Date {
  const t = new Date(now);
  t.setHours(wake.hour, wake.minute, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t;
}

/** The wake time as a clock reading, in the phone's 12 or 24-hour style (the date part is unused). */
export const wakeDate = (wake: WakeTime): Date => new Date(2000, 0, 1, wake.hour, wake.minute);
