/**
 * Nightwatch keeps all its tables in one Postgres schema (default `nightwatch`) so it can share
 * a database with other applications, for example an existing Supabase project, without its
 * tables (`profile`, `device`, `subscription`, `catalogue`...) colliding with theirs in
 * `public`.
 *
 * Queries are written unqualified and resolve through the connection's search_path. That path
 * comes from the database role, not from the connection string: `server/sql/setup.sql` creates
 * a `nightwatch_app` role whose default search_path is the schema. Role defaults are applied by
 * Postgres itself on every new server connection, so they also hold behind Supabase's
 * transaction pooler, where per-session SET commands do not.
 *
 * Every entry point calls assertSchema before doing anything, so a misconfigured connection
 * (another app's role, or the project's `postgres` user) fails loudly instead of writing into
 * someone else's `public` schema.
 */
import type { Sql } from './sql.ts';

export const DEFAULT_SCHEMA = 'nightwatch';

const NAME = /^[a-z_][a-z0-9_]{0,62}$/;

export function schemaFromEnv(env: Record<string, string | undefined>): string {
  const s = env.DATABASE_SCHEMA?.trim() || DEFAULT_SCHEMA;
  if (!NAME.test(s)) throw new Error(`DATABASE_SCHEMA "${s}" is not a plain lower-case Postgres identifier`);
  return s;
}

export class WrongSchemaError extends Error {}

/** Throws unless unqualified names on this connection resolve to `expected`. */
export async function assertSchema(sql: Sql, expected: string = DEFAULT_SCHEMA): Promise<void> {
  const [row] = await sql.query<{ schema: string | null }>('SELECT current_schema() AS schema');
  if (row?.schema === expected) return;
  throw new WrongSchemaError(
    `This connection resolves tables in schema "${row?.schema ?? '(none)'}", but Nightwatch must use "${expected}". ` +
      `Connect as the role created by server/sql/setup.sql (its search_path is set to "${expected}"), ` +
      `and run that script first if the schema does not exist yet.`,
  );
}
