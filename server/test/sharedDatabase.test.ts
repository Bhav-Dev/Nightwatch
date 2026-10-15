/**
 * Nightwatch in a database shared with other apps (an existing Supabase project): everything
 * lives in the nightwatch schema, owned by the nightwatch_app role, and nothing in public is
 * touched or readable.
 */
import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

import { loadMigrations, migrate } from '../src/db/migrate.ts';
import { createPglite, pgliteSql } from '../src/db/pglite.ts';
import { assertSchema, schemaFromEnv, WrongSchemaError } from '../src/db/schema.ts';
import { seedCatalogue } from '../src/db/seed.ts';
import { runAggregation } from '../src/jobs/aggregateJob.ts';
import { scopedEnv } from '../src/scopedEnv.ts';
import { harness, TestClock } from './helpers.ts';

const SETUP = readFileSync(new URL('../sql/setup.sql', import.meta.url), 'utf8');

/** A database that already belongs to another app, with Supabase-like API roles. */
async function sharedDatabase() {
  const db = await PGlite.create();
  await db.exec(`
    CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
    CREATE TABLE public.profile (id int PRIMARY KEY, nickname text);
    INSERT INTO public.profile VALUES (1, 'other app user');
    CREATE TABLE public.schema_migrations (id text PRIMARY KEY);
    INSERT INTO public.schema_migrations VALUES ('other-app-0001');
    CREATE TABLE public.catalogue (sku text);
    GRANT SELECT ON public.profile TO anon;
  `);
  return db;
}

describe('shared database', () => {
  it('setup.sql creates the schema and role, and migrations run as that role without touching public', async () => {
    const db = await sharedDatabase();
    await db.exec(SETUP.replace('CHANGE_ME', 'test-password'));

    const [owner] = (await db.query<{ owner: string }>(`SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'nightwatch'`)).rows;
    expect(owner.owner).toBe('nightwatch_app');
    const [cfg] = (await db.query<{ cfg: string[] }>(`SELECT rolconfig AS cfg FROM pg_roles WHERE rolname = 'nightwatch_app'`)).rows;
    expect(cfg.cfg).toContain('search_path=nightwatch');

    // Act as the app role, with the search_path its login would get.
    await db.exec('SET ROLE nightwatch_app; SET search_path TO nightwatch;');
    const sql = pgliteSql(db);
    expect(await migrate(sql)).toEqual(loadMigrations().map((m) => m.version));
    expect(await seedCatalogue(sql)).toBe(42);

    const tables = (await db.query<{ schema: string; owner: string }>(
      `SELECT n.nspname AS schema, pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'v') AND n.nspname IN ('public', 'nightwatch')`,
    )).rows;
    const ours = tables.filter((t) => t.schema === 'nightwatch');
    expect(ours.length).toBeGreaterThan(15);
    expect(ours.every((t) => t.owner === 'nightwatch_app')).toBe(true);
    // The other app's tables are exactly as they were.
    expect(tables.filter((t) => t.schema === 'public')).toHaveLength(3);
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT * FROM public.schema_migrations')).rows).toEqual([{ id: 'other-app-0001' }]);
    expect((await db.query('SELECT * FROM public.profile')).rows).toEqual([{ id: 1, nickname: 'other app user' }]);

    // The app role cannot read other apps' tables or create anything in public.
    await db.exec('SET ROLE nightwatch_app');
    await expect(db.query('SELECT * FROM public.profile')).rejects.toThrow(/permission denied/);
    await expect(db.exec('CREATE TABLE public.sneaky (x int)')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');

    // Supabase's API roles get nothing in the nightwatch schema.
    await db.exec('SET ROLE anon');
    await expect(db.query('SELECT * FROM nightwatch.app_user')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });

  it("setup.sql runs as a non-superuser owner, as Supabase's postgres role is", async () => {
    const db = await sharedDatabase();
    await db.exec('CREATE ROLE project_owner LOGIN CREATEROLE; GRANT CREATE ON DATABASE postgres TO project_owner;');
    await db.exec('SET ROLE project_owner');
    await db.exec(SETUP.replace('CHANGE_ME', 'test-password'));

    const [schema] = (await db.query<{ owner: string; acl: string }>(
      `SELECT nspowner::regrole::text AS owner, nspacl::text AS acl FROM pg_namespace WHERE nspname = 'nightwatch'`,
    )).rows;
    expect(schema).toEqual({ owner: 'nightwatch_app', acl: '{nightwatch_app=UC/nightwatch_app}' });

    // The owner may switch to the role, but does not inherit its access to the data.
    await db.exec('SET ROLE nightwatch_app; SET search_path TO nightwatch;');
    await migrate(pgliteSql(db));
    await db.exec('SET ROLE project_owner');
    await expect(db.query('SELECT * FROM nightwatch.app_user')).rejects.toThrow(/permission denied/);
    await db.exec('RESET ROLE');
  });

  it('refuses to migrate or run on a connection that resolves to another schema', async () => {
    const bare = await createPglite({ schema: null });
    await expect(migrate(bare)).rejects.toBeInstanceOf(WrongSchemaError);
    // Nothing was created in public.
    expect((await bare.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`))[0]).toEqual({ n: 0 });

    const ok = await createPglite();
    await expect(assertSchema(ok)).resolves.toBeUndefined();
    await expect(assertSchema(ok, 'other')).rejects.toThrow(/must use "other"/);
  });

  it('runs the full API and the nightly job inside the schema', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('GET', '/v1/catalogue?since=0', { token })).status).toBe(200);
    const result = await runAggregation(h.sql, new TestClock(), { excludeDates: [] });
    expect(result.ok).toBe(true);
    const [n] = await h.sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    expect(n.n).toBe(0);
  });
});

describe('configuration for a shared Supabase project', () => {
  it('reads only NIGHTWATCH_-prefixed secrets, without the prefix', () => {
    const env = scopedEnv({
      NIGHTWATCH_SESSION_SECRET: 'ours',
      SESSION_SECRET: 'another app',
      SUPABASE_DB_URL: 'postgres://postgres@owner',
      NIGHTWATCH_DATABASE_URL: 'postgres://nightwatch_app@pooler',
    });
    expect(env).toEqual({ SESSION_SECRET: 'ours', DATABASE_URL: 'postgres://nightwatch_app@pooler' });
  });

  it('validates the schema name', () => {
    expect(schemaFromEnv({})).toBe('nightwatch');
    expect(schemaFromEnv({ DATABASE_SCHEMA: 'nightwatch_staging' })).toBe('nightwatch_staging');
    expect(() => schemaFromEnv({ DATABASE_SCHEMA: 'x; drop table' })).toThrow();
  });
});
