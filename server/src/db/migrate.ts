/**
 * Minimal migration runner: applies server/migrations/NNN_name.sql in order, each in its own
 * transaction, and records it in schema_migrations, all inside the Nightwatch schema.
 * Usage: `npm run migrate` (DATABASE_URL, connecting as nightwatch_app).
 *
 * This runner is used on Supabase too, rather than `supabase db push`: in a shared project the
 * Supabase migration history belongs to the other app, and pushing Nightwatch's migrations
 * through it would tangle the two.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertSchema, DEFAULT_SCHEMA, schemaFromEnv } from './schema.ts';
import type { Sql } from './sql.ts';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const FILE = /^(\d{3})_([a-z0-9_]+)\.sql$/;

/** The migrations directory, from src/db (tsx) or dist (bundled). */
export function migrationsDir(): string {
  for (const rel of ['../../migrations', '../migrations']) {
    const dir = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(dir)) return dir;
  }
  throw new Error('migrations directory not found');
}

export function loadMigrations(dir = migrationsDir()): Migration[] {
  return readdirSync(dir)
    .map((f) => FILE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ version: Number(m[1]), name: m[2], sql: readFileSync(`${dir}/${m[0]}`, 'utf8') }))
    .sort((a, b) => a.version - b.version);
}

/** Applies pending migrations; returns the versions applied. */
export async function migrate(sql: Sql, migrations: Migration[] = loadMigrations(), schema = DEFAULT_SCHEMA): Promise<number[]> {
  // Refuse to create anything unless it lands in the Nightwatch schema.
  await assertSchema(sql, schema);
  await sql.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set(
    (await sql.query<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version),
  );
  const applied: number[] = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    await sql.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
        m.version,
        m.name,
      ]);
    });
    applied.push(m.version);
  }
  return applied;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { postgresSql } = await import('./postgres.ts');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = postgresSql(url, { max: 1 });
  try {
    const applied = await migrate(sql, loadMigrations(), schemaFromEnv(process.env));
    console.log(applied.length ? `Applied migrations: ${applied.join(', ')}` : 'Database is up to date');
  } finally {
    await sql.close();
  }
}
