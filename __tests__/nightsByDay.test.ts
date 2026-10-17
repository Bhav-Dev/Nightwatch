import { nightsByDay, type TrendPoint } from '../src/data/historyRepo';

const night = (id: string, date: string, score: number): TrendPoint => ({ id, date, score, pctSnoring: 0.1, counts: true });

describe('the honeycomb of nights', () => {
  const today = new Date(2026, 9, 17, 21, 0);

  it('has one cell a day up to today, oldest first', () => {
    const days = nightsByDay([], 7, today);
    expect(days.map((d) => d.key)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17']);
    expect(days.every((d) => d.night === null)).toBe(true);
  });

  it('puts each night on the day it started, and keeps the later of two', () => {
    const days = nightsByDay([night('a', '2026-10-15', 40), night('b', '2026-10-17', 23), night('c', '2026-10-17#2', 31)], 7, today);
    expect(days[4].night).toEqual({ id: 'a', score: 40 });
    expect(days[5].night).toBeNull();
    expect(days[6].night).toEqual({ id: 'c', score: 31 });
  });

  it('crosses a month end', () => {
    const days = nightsByDay([night('a', '2026-09-30', 50)], 28, new Date(2026, 9, 2));
    expect(days[0].key).toBe('2026-09-05');
    expect(days.find((d) => d.key === '2026-09-30')?.night?.id).toBe('a');
  });
});
