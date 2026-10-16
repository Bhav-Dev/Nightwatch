/**
 * The wake-up alarm is the phone's own: whichever alarm its Clock app (or another alarm app) rings
 * next. Nightwatch reads it, adds one to the Clock app if there is none, and stops the recording
 * just before it. The Clock app rings it whatever happens to Nightwatch overnight.
 */
export type WakeTime = { hour: number; minute: number };

/** Stopping a little early keeps the alarm out of the recording, and the night is ready as it rings. */
export const STOP_BEFORE_ALARM_MS = 30_000;

/** An alarm this soon after starting is not the wake-up alarm (a bedtime reminder, say). */
export const MIN_SLEEP_BEFORE_ALARM_MS = 3600_000;

/** On Tonight, an alarm further off than this is not tomorrow morning's (a weekday alarm on a Saturday). */
export const TONIGHT_WINDOW_MS = 18 * 3600_000;

/** The label on alarms Nightwatch adds to the Clock app. */
export const ALARM_LABEL = 'Nightwatch';

/** Where the time dialog starts when there is no alarm. */
export const DEFAULT_WAKE_TIME: WakeTime = { hour: 7, minute: 0 };

/** The phone's next alarm, if it is tomorrow morning's, seen from Tonight at `nowMs`. */
export function tonightsAlarm(nextAlarmMs: number | null, nowMs: number): number | null {
  if (nextAlarmMs === null) return null;
  const ahead = nextAlarmMs - nowMs;
  return ahead >= MIN_SLEEP_BEFORE_ALARM_MS && ahead <= TONIGHT_WINDOW_MS ? nextAlarmMs : null;
}

/**
 * When a recording that started at `startMs` should stop for the phone's next alarm: just before
 * it, if it rings at least an hour in and before the recording's own limit (`latestMs`).
 */
export function stopForAlarm(nextAlarmMs: number | null, startMs: number, latestMs: number): number | null {
  if (nextAlarmMs === null) return null;
  if (nextAlarmMs - startMs < MIN_SLEEP_BEFORE_ALARM_MS || nextAlarmMs > latestMs) return null;
  return nextAlarmMs - STOP_BEFORE_ALARM_MS;
}

/** A time of day as a Date, for the time dialog and for showing in the phone's 12 or 24-hour style. */
export const wakeDate = (wake: WakeTime): Date => new Date(2000, 0, 1, wake.hour, wake.minute);
