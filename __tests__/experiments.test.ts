import { listExperiments, startExperiment } from '../src/data/experimentRepo';
import { setNightTick, saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { createPattern } from '../src/domain/experiment';
import { analyseNight } from '../src/domain/scoring';
import { experimentProgress, finishDueExperiments } from '../src/experiments/progress';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `x${++n}`;

describe('experiment progress', () => {
  it('scores the 14 nights by what was logged and completes when over', async () => {
    const db = openTestDb();
    await migrate(db);
    const pattern = createPattern(7);
    await startExperiment(db, { id: 'e1', remedyId: 'mouth_tape', started: '2026-10-01', pattern });
    for (let d = 0; d < 14; d++) {
      const withTape = pattern[d];
      const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, withTape ? 0.1 : 0.4, withTape ? 10 : 25) });
      const startedAt = new Date(2026, 9, 1 + d, 23, 0);
      const id = newId();
      await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
      if (withTape) await setNightTick(db, id, { itemId: 'mouth_tape', type: 'remedy', value: null }, true);
    }
    const [e] = await listExperiments(db);
    const mid = await experimentProgress(db, e, '2026-10-07');
    expect(mid).toMatchObject({ day: 7, verdict: null, nightsWith: 7, nightsWithout: 7 });

    expect(await finishDueExperiments(db, '2026-10-15')).toBe(1);
    const [done] = await listExperiments(db);
    expect(done.status).toBe('complete');
    expect(done.verdict).toMatchObject({ kind: 'helped', confidence: 'high', nightsWith: 7, nightsWithout: 7 });
  });
});

import { personalRemedies } from '../src/domain/personalRemedies';
import type { NightSummary } from '../shared/remedyEffect';

describe('personal remedies', () => {
  const night = (i: number, remedies: string[], score: number): NightSummary => ({
    id: `p${i}`, date: `2026-09-${String(i + 1).padStart(2, '0')}`, score, pct_snoring: 0.2, duration_s: 8 * 3600, partial: false, typical: null, remedies, factors: [],
  });

  it('gives averages with and without, and flags a remedy logged every night', () => {
    const history = Array.from({ length: 16 }, (_, i) => night(i, i % 2 ? ['strips', 'pillow'] : ['pillow'], i % 2 ? 30 : 50));
    const [pillow, strips] = personalRemedies(history);
    expect(pillow).toMatchObject({ remedyId: 'pillow', everyNight: true, nightsWithout: 0, delta: null });
    expect(strips).toMatchObject({ remedyId: 'strips', nightsWith: 8, avgWith: 30, avgWithout: 50, everyNight: false });
    expect(strips.delta?.delta_score).toBe(-20);
  });
});
