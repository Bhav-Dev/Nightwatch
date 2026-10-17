import type { Db } from './data/db';
import { getNight } from './data/nightRepo';
import { getSetting } from './data/settingsRepo';
import { parseRecapTime, recapAt, recapContent } from './domain/recap';
import { scoreLabel } from './domain/scoring';
import { scheduleRecap } from './notifications';

/**
 * At Stop: schedules the recap for later in the day, when the user is up and has time to look
 * back at the night and check its loudest moments. Nothing is asked of them straight after waking.
 */
export async function scheduleNightRecap(db: Db, nightId: string, stoppedAt = new Date()): Promise<void> {
  const night = await getNight(db, nightId);
  if (!night) return;
  const at = recapAt(stoppedAt, parseRecapTime(await getSetting(db, 'recap_time')));
  if (!at) return;
  const clips = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM clip WHERE night_id = ?', [nightId]))?.n ?? 0;
  await scheduleRecap(at, recapContent(night.score, scoreLabel(night.score), clips));
}
