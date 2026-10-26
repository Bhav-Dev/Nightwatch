import { earlierScores, loadPeriodSummary } from '../src/data/shareRepo';
import { migrate } from '../src/data/schema';
import { nightHighlight, periodHighlight, periodSummary, quietestRun } from '../src/domain/shareCard';
import { openTestDb } from './helpers/nodeDb';

const base = { score: 30, pctSnoring: 0.12, counts: true, average7: 40, earlierScores: [35, 42, 38], tried: [] as string[] };

describe('night card headline', () => {
  it('leads with the quietest night in a long enough run', () => {
    expect(quietestRun(20, [30, 40, 25, 50, 18])).toBe(5);
    expect(nightHighlight({ ...base, score: 20, earlierScores: [30, 40, 25, 50, 35, 33, 22, 10] })).toBe('My quietest night in 8 nights');
  });

  it('credits what was tried when the night beat the average', () => {
    expect(nightHighlight({ ...base, tried: ['Nasal strips', 'CPAP', 'Pillow'] })).toBe('10 below my average, with nasal strips and CPAP');
  });

  it('otherwise the change against the average, or the time snoring', () => {
    expect(nightHighlight(base)).toBe('↓ 10 vs my 7-night average');
    expect(nightHighlight({ ...base, score: 48 })).toBe('↑ 8 vs my 7-night average');
    expect(nightHighlight({ ...base, score: 39 })).toBe('Snoring 12% of the night');
    // A short night is never "quietest" or compared with the average.
    expect(nightHighlight({ ...base, counts: false, score: 1, earlierScores: Array(10).fill(50) })).toBe('Snoring 12% of the night');
  });
});

describe('week and month cards', () => {
  const today = new Date(2026, 9, 26);
  const points = [
    { date: '2026-10-12', score: 50, counts: true }, // two weeks back: ignored
    { date: '2026-10-19', score: 40, counts: true }, // the week before
    { date: '2026-10-20', score: 30, counts: true },
    { date: '2026-10-22', score: 20, counts: false }, // short: shown, not averaged
    { date: '2026-10-26', score: 26, counts: true },
  ];

  it('covers the last 7 days with a cell each and averages counted nights', () => {
    const s = periodSummary(points, 7, today);
    expect(s.days.map((d) => d.key)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26']);
    expect(s.days.map((d) => d.score)).toEqual([30, null, 20, null, null, null, 26]);
    expect(s.average).toBe(28);
    expect(s.nights).toBe(3);
    expect(s.previousAverage).toBe(40);
    expect(s.quietest).toEqual({ key: '2026-10-26', score: 26 });
    expect(periodHighlight(s, 'week')).toBe('↓ 12 vs the week before');
  });

  it('says how many nights were recorded when there is nothing to compare with', () => {
    const s = periodSummary(points.slice(2), 7, today);
    expect(periodHighlight(s, 'week')).toBe('3 of 7 nights recorded');
  });

  it('loads from the database', async () => {
    const db = openTestDb();
    await migrate(db);
    const add = (id: string, date: string, startedAt: number, score: number) =>
      db.runAsync(
        `INSERT INTO night (id, date, started_at, ended_at, duration_s, time_in_bed_s, score, score_version, pct_snoring, event_count, max_db, floor_db, partial, counts_toward_averages, updated_at)
         VALUES (?, ?, ?, ?, 28800, 28800, ?, 1, 0.1, 1, 10, 30, 0, 1, 0)`,
        [id, date, startedAt, startedAt + 28800, score],
      );
    await add('a', '2026-10-24', 1000, 40);
    await add('b', '2026-10-25', 2000, 35);
    await add('c', '2026-10-26', 3000, 20);
    expect(await earlierScores(db, 3000)).toEqual([35, 40]);
    const s = await loadPeriodSummary(db, 7, today);
    expect(s.average).toBe(32);
    expect(s.nights).toBe(3);
  });
});
