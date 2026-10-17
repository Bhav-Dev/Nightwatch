/**
 * The night recap: a notification later in the day, once the user is up and has time, inviting
 * them to look back at the night (score, moments to check). It is never sent straight after
 * waking: the morning screen shows the score then, and anything that needs attention (checking
 * moments, a review request) waits for the recap.
 */

export const RECAP_TIMES = ['10:00', '12:30', '18:30'] as const;
export type RecapTime = (typeof RECAP_TIMES)[number] | 'off';
export const DEFAULT_RECAP_TIME: RecapTime = '12:30';

/** The recap is never sooner than this after the recording stops. */
export const RECAP_MIN_AFTER_STOP_MIN = 90;
/** Nor later than this hour (it would arrive at bedtime). */
export const RECAP_LATEST_HOUR = 21;

export function parseRecapTime(value: string | null): RecapTime {
  return value === 'off' || (RECAP_TIMES as readonly string[]).includes(value ?? '') ? (value as RecapTime) : DEFAULT_RECAP_TIME;
}

/**
 * When to send the recap for a night that stopped at `stoppedAt`: the chosen time that day, but
 * at least 90 minutes after stopping. Null when it is turned off, or would land after 9pm.
 */
export function recapAt(stoppedAt: Date, setting: RecapTime): Date | null {
  if (setting === 'off') return null;
  const [h, m] = setting.split(':').map(Number);
  const at = new Date(stoppedAt);
  at.setHours(h, m, 0, 0);
  const earliest = stoppedAt.getTime() + RECAP_MIN_AFTER_STOP_MIN * 60_000;
  const when = new Date(Math.max(at.getTime(), earliest));
  const latest = new Date(stoppedAt);
  latest.setHours(RECAP_LATEST_HOUR, 0, 0, 0);
  return when.getTime() <= latest.getTime() ? when : null;
}

/** The recap's text. */
export function recapContent(score: number, label: string, momentsToCheck: number): { title: string; body: string } {
  const check =
    momentsToCheck === 0
      ? 'Have a look back at your night.'
      : momentsToCheck === 1
        ? 'One moment to check: was it snoring?'
        : `${momentsToCheck} moments to check: were they snoring?`;
  return { title: `Last night: ${score}, ${label.toLowerCase()}`, body: check };
}
