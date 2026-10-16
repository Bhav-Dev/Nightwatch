import { getCached } from '../src/data/cacheRepo';
import { refreshCatalogue } from '../src/data/catalogueClient';
import { catalogueVersion, listActiveCatalogue, seedCatalogueIfEmpty } from '../src/data/catalogueRepo';
import { commitPendingLog, getPendingLog, prefillPendingLog, setPendingTick } from '../src/data/logRepo';
import { averageScore, latestNight, nightBins, saveNight } from '../src/data/nightRepo';
import { MIGRATION_SQL, migrate, SCHEMA_VERSION } from '../src/data/schema';
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

  it('takes short nights saved under the old rule out of averages', async () => {
    const db = await freshDb();
    const short = await recordNight(db, 10, { hours: 1 });
    const full = await recordNight(db, 11);
    // As the old rule saved it: a complete 1-hour night counted. Then the migration that fixes it.
    await db.runAsync('UPDATE night SET counts_toward_averages = 1 WHERE id = ?', [short]);
    await db.execAsync(MIGRATION_SQL.find((sql) => sql.includes('counts_toward_averages = 0'))!);
    const rows = await db.getAllAsync<{ id: string; counts_toward_averages: number }>(
      'SELECT id, counts_toward_averages FROM night ORDER BY started_at',
      [],
    );
    expect(rows).toEqual([
      { id: short, counts_toward_averages: 0 },
      { id: full, counts_toward_averages: 1 },
    ]);
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
    const api = {
      catalogue: jest.fn(async (since: number) => {
        expect(since).toBe(1);
        return {
          version: 2,
          amazon_tags: { GB: 'nightwatch-21' },
          items: [
            { id: 'mouth_tape', type: 'remedy' as const, kind: 'device' as const, category: 'Mouth and jaw', name: 'Mouth tape', article_md: 'Updated.', link_url: null, amazon: { search: 'mouth tape', asin: { GB: 'B0TEST' } }, active: true },
            { id: 'tennis_ball', type: 'remedy' as const, kind: 'device' as const, category: 'Position', name: 'Tennis ball or backpack method', article_md: '', link_url: null, amazon: null, active: false },
            { id: 'jaw_exercises', type: 'remedy' as const, kind: 'habit' as const, category: 'Throat', name: 'Jaw exercises', article_md: 'New.', link_url: null, amazon: null, active: true },
          ],
        };
      }),
    };
    const applied = await refreshCatalogue(db, api);
    expect(applied).toBe(3);
    const items = await listActiveCatalogue(db);
    expect(items).toHaveLength(42);
    expect(items.find((i) => i.id === 'mouth_tape')).toMatchObject({ amazon: { asin: { GB: 'B0TEST' } }, version: 2, shop: true });
    expect(items.find((i) => i.id === 'jaw_exercises')).toMatchObject({ kind: 'habit', shop: false });
    expect(items.find((i) => i.id === 'tennis_ball')).toBeUndefined();
    expect(await catalogueVersion(db)).toBe(2);
    expect(await getCached(db, 'amazon_tags')).toMatchObject({ value: { GB: 'nightwatch-21' } });
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
