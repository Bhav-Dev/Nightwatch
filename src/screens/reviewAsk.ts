import * as StoreReview from 'expo-store-review';

import { track } from '../analytics';
import type { Db } from '../data/db';
import type { NightRow } from '../data/nightRepo';
import { getSetting, setSetting } from '../data/settingsRepo';
import { shouldAskForReview } from '../domain/reviewPrompt';

export interface Engagement {
  plays: number;
  answers: number;
  /** Answers that said the detector was wrong. */
  corrections: number;
}

let askedThisRun = false;

/**
 * Asks for an app store review if now is a good moment (see domain/reviewPrompt): called after
 * something has gone well on This Morning, such as a clip playing to its end or an answer saved.
 */
export async function maybeAskForReview(
  db: Db,
  ctx: { night: NightRow; nightCount: number; fromRecap: boolean; engagement: Engagement },
): Promise<void> {
  if (askedThisRun) return;
  const { night, engagement } = ctx;
  let previous: number[] = [];
  try {
    previous = JSON.parse((await getSetting(db, 'review_asked_at')) ?? '[]') as number[];
  } catch {
    previous = [];
  }
  const now = new Date();
  const ok = shouldAskForReview({
    now,
    nightsRecorded: ctx.nightCount,
    stoppedAt: new Date(night.ended_at * 1000),
    nightWasShort: night.partial === 1 || night.counts_toward_averages === 0,
    fromRecap: ctx.fromRecap,
    engagement: engagement.plays + engagement.answers,
    correctedShare: engagement.answers > 0 ? engagement.corrections / engagement.answers : 0,
    previousAsks: previous.map((s) => new Date(s * 1000)),
  });
  if (!ok || !(await StoreReview.isAvailableAsync().catch(() => false))) return;
  askedThisRun = true;
  await setSetting(db, 'review_asked_at', JSON.stringify([...previous, Math.floor(now.getTime() / 1000)].slice(-5)));
  track({ name: 'review_asked' });
  await StoreReview.requestReview().catch(() => undefined);
}
