/**
 * When to ask for an app store review. Never just after waking up: only when the user has come
 * back to the night at their leisure (from the recap, or at least a couple of hours after
 * stopping), has used it (played or checked moments), and the night went normally. Stores limit
 * how often their review sheet can appear anyway; this keeps us well inside that and asks only
 * at good moments.
 */

export interface ReviewContext {
  now: Date;
  /** Nights recorded on this phone. */
  nightsRecorded: number;
  /** When the night being looked at stopped. */
  stoppedAt: Date;
  /** Interrupted or under 3 hours. */
  nightWasShort: boolean;
  /** Opened from the recap notification. */
  fromRecap: boolean;
  /** Clips or moments played, and answers given, on this visit. */
  engagement: number;
  /** Share of this night's answers that said the detector was wrong (0 when none). */
  correctedShare: number;
  /** When we last asked (any night). */
  previousAsks: readonly Date[];
}

export const REVIEW_MIN_NIGHTS = 3;
export const REVIEW_MIN_HOURS_AFTER_STOP = 2;
export const REVIEW_MIN_ENGAGEMENT = 2;
export const REVIEW_MIN_DAYS_BETWEEN = 120;
export const REVIEW_MAX_PER_YEAR = 3;
/** A night where the user had to correct most moments is a bad moment to ask. */
export const REVIEW_MAX_CORRECTED_SHARE = 0.5;

export function shouldAskForReview(c: ReviewContext): boolean {
  if (c.nightsRecorded < REVIEW_MIN_NIGHTS || c.nightWasShort) return false;
  const hoursSinceStop = (c.now.getTime() - c.stoppedAt.getTime()) / 3_600_000;
  if (!c.fromRecap && hoursSinceStop < REVIEW_MIN_HOURS_AFTER_STOP) return false;
  if (c.engagement < REVIEW_MIN_ENGAGEMENT || c.correctedShare > REVIEW_MAX_CORRECTED_SHARE) return false;
  const day = 86_400_000;
  const recent = c.previousAsks.filter((d) => c.now.getTime() - d.getTime() < 365 * day);
  if (recent.length >= REVIEW_MAX_PER_YEAR) return false;
  const last = Math.max(0, ...c.previousAsks.map((d) => d.getTime()));
  return c.now.getTime() - last >= REVIEW_MIN_DAYS_BETWEEN * day;
}
