import { describe, expect, it } from 'vitest';

import { createPglite } from '../src/db/pglite.ts';
import { loadMigrations, migrate } from '../src/db/migrate.ts';
import { seedCatalogue } from '../src/db/seed.ts';

describe('migrations', () => {
  it('apply cleanly to an empty database, once', async () => {
    const sql = await createPglite();
    const migrations = loadMigrations();
    expect(migrations.map((m) => m.version)).toEqual(migrations.map((_, i) => i + 1));
    expect(await migrate(sql)).toEqual(migrations.map((m) => m.version));
    expect(await migrate(sql)).toEqual([]);
    const recorded = await sql.query<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version');
    expect(recorded.map((r) => r.version)).toEqual(migrations.map((m) => m.version));
  });

  it('create every table in the spec, with row level security on', async () => {
    const sql = await createPglite();
    await migrate(sql);
    const tables = await sql.query<{ relname: string; relrowsecurity: boolean }>(
      `SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'nightwatch' AND c.relkind = 'r' ORDER BY 1`,
    );
    const names = tables.map((t) => t.relname);
    for (const t of [
      'app_user', 'device', 'subscription', 'night_summary', 'remedy_log', 'factor_log', 'profile', 'contribution',
      'contributor_exclusion', 'catalogue', 'catalogue_suggestion', 'aggregate', 'aggregate_next', 'aggregate_stack',
      'aggregate_snapshot', 'aggregate_job_log', 'magic_link', 'rate_limit', 'schema_migrations',
    ]) {
      expect(names).toContain(t);
    }
    expect(tables.every((t) => t.relrowsecurity)).toBe(true);
    // Published tables never carry a user or contributor id.
    const cols = await sql.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'nightwatch' AND table_name LIKE 'aggregate%' AND table_name <> 'aggregate_job_log'`,
    );
    expect(cols.filter((c) => /user_id|contributor/.test(c.column_name))).toEqual([]);
  });

  it('seed the catalogue idempotently, with Amazon searches for shop items', async () => {
    const sql = await createPglite();
    await migrate(sql);
    expect(await seedCatalogue(sql)).toBe(42);
    expect(await seedCatalogue(sql)).toBe(0);
    const [strips] = await sql.query<{ amazon: unknown; link_url: string | null; version: number }>(
      `SELECT amazon, link_url, version FROM catalogue WHERE id = 'nasal_strips'`,
    );
    expect(strips).toEqual({ amazon: { search: 'nasal strips' }, link_url: null, version: 1 });
    const [side] = await sql.query<{ amazon: unknown }>(`SELECT amazon FROM catalogue WHERE id = 'side_sleeping'`);
    expect(side.amazon).toBeNull();

    // A changed item moves to a new version; an item dropped from the file is deactivated.
    const file = (await import('../../catalogue/catalogue.json', { with: { type: 'json' } })).default as {
      version: number;
      items: { id: string; name: string }[];
    };
    const items = file.items
      .filter((i) => i.id !== 'tennis_ball')
      .map((i) => (i.id === 'mouth_tape' ? { ...i, name: 'Mouth tape (porous)' } : i));
    expect(await seedCatalogue(sql, { ...file, items } as never)).toBe(2);
    const changed = await sql.query<{ id: string; version: number; active: boolean }>(
      `SELECT id, version, active FROM catalogue WHERE version = 2 ORDER BY id`,
    );
    expect(changed).toEqual([
      { id: 'mouth_tape', version: 2, active: true },
      { id: 'tennis_ball', version: 2, active: false },
    ]);
  });
});
