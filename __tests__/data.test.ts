import { refreshCatalogue } from '../src/data/catalogueClient';
import { catalogueVersion, listActiveCatalogue, seedCatalogueIfEmpty } from '../src/data/catalogueRepo';
import { commitPendingLog, getPendingLog, prefillPendingLog, setPendingTick } from '../src/data/logRepo';
import { averageScore, latestNight, nightBins, saveNight } from '../src/data/nightRepo';
import { migrate, SCHEMA_VERSION } from '../src/data/schema';
import { analyseNight } from '../src/domain/scoring';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `id-${++n}`;

async function freshDb() {
  const db = openTestDb();
  await migrate(db);
  return db;
}

async function recordNight(db: Awaited<ReturnType<typeof freshDb>>, day: number, opts: { hours?: number; partial?: boolean } = {}) {
  const hours = opts.hours ?? 8;
  const analysis = analyseNight({ durationS: hours * 3600, frames: evenNight(hours, 0.25, 15), partial: opts.partial });
  const startedAt = new Date(2026, 9, day, 23, 0);
  const id = newId();
  await saveNight(db, {
    id,
    startedAt,
    endedAt: new Date(startedAt.getTime() + hours * 3600_000),
    partial: opts.partial ?? false,
    analysis,
    newId,
  });
  return id;
}

describe('schema', () => {
  it('migrates to the latest version and is idempotent', async () => {
    const db = await freshDb();
    await migrate(db);
    const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
    expect(row?.user_version).toBe(SCHEMA_VERSION);
  });
});

describe('catalogue store', () => {
  it('seeds the bundled 42 entries once', async () => {
    const db = await freshDb();
    await seedCatalogueIfEmpty(db);
    await seedCatalogueIfEmpty(db);
    expect(await listActiveCatalogue(db)).toHaveLength(42);
    expect(await catalogueVersion(db)).toBe(1);
  });

  it('applies newer server rows and deactivates retired ones', async () => {
    const db = await freshDb();
    await seedCatalogueIfEmpty(db);
    const fakeFetch = jest.fn(async (url: string) => {
      expect(url).toBe('https://api.example.test/v1/catalogue?since=1');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: 2,
          items: [
            { id: 'mouth_tape', type: 'remedy', category: 'Mouth and jaw', name: 'Mouth tape', article_md: 'Updated.', link_url: 'https://shop.example/tape', active: true },
            { id: 'tennis_ball', type: 'remedy', category: 'Position', name: 'Tennis ball or backpack method', article_md: '', link_url: null, active: false },
            { id: 'jaw_exercises', type: 'remedy', category: 'Throat', name: 'Jaw exercises', article_md: 'New.', link_url: null, active: true },
          ],
        }),
      };
    });
    const applied = await refreshCatalogue(db, 'https://api.example.test/', fakeFetch as unknown as typeof fetch);
    expect(applied).toBe(3);
    const items = await listActiveCatalogue(db);
    expect(items).toHaveLength(42);
    expect(items.find((i) => i.id === 'mouth_tape')).toMatchObject({ link_url: 'https://shop.example/tape', version: 2, kind: 'device' });
    expect(items.find((i) => i.id === 'jaw_exercises')).toMatchObject({ kind: 'habit', shop: false });
    expect(items.find((i) => i.id === 'tennis_ball')).toBeUndefined();
    expect(await catalogueVersion(db)).toBe(2);
  });
});

describe('nights', () => {
  it('saves a night with 96 bins and its events', async () => {
    const db = await freshDb();
    const id = await recordNight(db, 14);
    const night = await latestNight(db);
    expect(night).toMatchObject({ id, date: '2026-10-14', partial: 0, counts_toward_averages: 1 });
    expect(await nightBins(db, id)).toHaveLength(96);
    const events = await db.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM event WHERE night_id = ?', [id]);
    expect(events[0].n).toBe(night?.event_count);
  });

  it('suffixes a second recording on the same date', async () => {
    const db = await freshDb();
    await recordNight(db, 14, { hours: 1 });
    await recordNight(db, 14, { hours: 1 });
    await recordNight(db, 14, { hours: 1 });
    const dates = await db.getAllAsync<{ date: string }>('SELECT date FROM night ORDER BY date', []);
    expect(dates.map((d) => d.date)).toEqual(['2026-10-14', '2026-10-14#2', '2026-10-14#3']);
  });

  it('keeps a short partial night out of averages', async () => {
    const db = await freshDb();
    await recordNight(db, 12);
    await recordNight(db, 13, { hours: 2, partial: true });
    const all = await db.getAllAsync<{ score: number }>('SELECT score FROM night WHERE counts_toward_averages = 1', []);
    expect(all).toHaveLength(1);
    expect(await averageScore(db, 7)).toBe(all[0].score);
  });
});

describe('tonight log', () => {
  it('pre-fills from last night, once per day, and commits at stop', async () => {
    const db = await freshDb();
    expect(await prefillPendingLog(db, '2026-10-14')).toEqual([]);

    await setPendingTick(db, { itemId: 'nasal_strips', type: 'remedy', value: null }, true);
    await setPendingTick(db, { itemId: 'alcohol', type: 'factor', value: '3-4' }, true);
    const nightId = await recordNight(db, 14);
    await commitPendingLog(db, nightId);
    expect(await getPendingLog(db)).toEqual([]);

    const next = await prefillPendingLog(db, '2026-10-15');
    expect(next).toEqual(
      expect.arrayContaining([
        { itemId: 'nasal_strips', type: 'remedy', value: null },
        { itemId: 'alcohol', type: 'factor', value: '3-4' },
      ]),
    );

    // The user clears alcohol; reopening Tonight the same day must not bring it back.
    await setPendingTick(db, { itemId: 'alcohol', type: 'factor', value: null }, false);
    expect(await prefillPendingLog(db, '2026-10-15')).toEqual([{ itemId: 'nasal_strips', type: 'remedy', value: null }]);
  });
});
