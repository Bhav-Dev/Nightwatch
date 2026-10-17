import { addLabel, clearLabels, nightLabels } from '../src/data/labelRepo';
import { getNight, nightBins, nightEvents, saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { analyseNight } from '../src/domain/scoring';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `id-${++n}`;

async function nightWithSnoring() {
  const db = openTestDb();
  await migrate(db);
  const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.25, 15) });
  const startedAt = new Date(2026, 9, 16, 23, 0);
  const id = newId();
  await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
  return { db, id, analysis };
}

describe('snoring answers', () => {
  it('"not snoring" removes an event, lowers the score and keeps the detector score', async () => {
    const { db, id, analysis } = await nightWithSnoring();
    const before = (await getNight(db, id))!;
    const first = (await nightEvents(db, id))[0];
    await addLabel(db, { id: newId(), nightId: id, startS: first.start_s, endS: first.end_s, label: 'not_snore', peakDb: first.peak_db, meanDb: first.mean_db, source: 'clip', now: 100 });

    const after = (await getNight(db, id))!;
    expect(after.event_count).toBe(analysis.events.length - 1);
    expect(after.score).toBeLessThanOrEqual(before.score);
    expect(after.pct_snoring).toBeLessThan(before.pct_snoring);
    expect(after.detector_score).toBe(before.score);
    expect(after.updated_at).toBeGreaterThan(before.updated_at);
    const bins = await nightBins(db, id);
    const binTotal = bins.reduce((s, b) => s + b.snoreS, 0);
    const eventTotal = (await nightEvents(db, id)).reduce((s, e) => s + e.end_s - e.start_s, 0);
    expect(binTotal).toBe(eventTotal);
  });

  it('"snoring" adds a stretch, and undoing every answer restores the detector night', async () => {
    const { db, id } = await nightWithSnoring();
    const before = (await getNight(db, id))!;
    const eventsBefore = await nightEvents(db, id);
    const quiet = { startS: eventsBefore[0].end_s + 60, endS: eventsBefore[0].end_s + 90 };
    const gapIsQuiet = !eventsBefore.some((e) => e.start_s < quiet.endS && e.end_s > quiet.startS);
    expect(gapIsQuiet).toBe(true);
    await addLabel(db, { id: newId(), nightId: id, ...quiet, label: 'snore', peakDb: 12, meanDb: 9, source: 'moment', now: 100 });
    expect((await getNight(db, id))!.event_count).toBe(eventsBefore.length + 1);
    expect(await nightLabels(db, id)).toHaveLength(1);

    await clearLabels(db, id, quiet.startS, quiet.endS);
    const restored = (await getNight(db, id))!;
    expect(restored.score).toBe(before.score);
    expect(restored.event_count).toBe(before.event_count);
    expect(restored.detector_score).toBeNull();
    expect((await nightEvents(db, id)).map((e) => [e.start_s, e.end_s])).toEqual(eventsBefore.map((e) => [e.start_s, e.end_s]));
  });

  it('a later answer for the same stretch wins', async () => {
    const { db, id, analysis } = await nightWithSnoring();
    const e = (await nightEvents(db, id))[0];
    const base = { nightId: id, startS: e.start_s, endS: e.end_s, peakDb: e.peak_db, meanDb: e.mean_db, source: 'clip' };
    await addLabel(db, { ...base, id: newId(), label: 'not_snore', now: 100 });
    await addLabel(db, { ...base, id: newId(), label: 'snore', now: 101 });
    expect((await getNight(db, id))!.event_count).toBe(analysis.events.length);
  });
});
