import { PGlite, type Transaction } from '@electric-sql/pglite';

import { DEFAULT_SCHEMA } from './schema.ts';
import type { Sql } from './sql.ts';

/**
 * Test adapter over PGlite (Postgres compiled to WASM, in process). Same SQL, same
 * semantics as production, no server to run.
 */
export function pgliteSql(db: PGlite): Sql & { db: PGlite } {
  return { ...wrap(db, false), db };
}

/**
 * A fresh in-process database with the Nightwatch schema created and on the search_path, the
 * way the nightwatch_app role sees it in production. Pass `schema: null` for a bare database.
 */
export async function createPglite(opts: { schema?: string | null } = {}): Promise<Sql & { db: PGlite }> {
  const db = await PGlite.create();
  const schema = opts.schema === undefined ? DEFAULT_SCHEMA : opts.schema;
  if (schema) await db.exec(`CREATE SCHEMA ${schema}; SET search_path TO ${schema};`);
  return pgliteSql(db);
}

function wrap(db: PGlite | Transaction, inTransaction: boolean): Sql {
  const self: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      const res = await db.query<T>(text, params as unknown[]);
      return res.rows;
    },
    async exec(text: string) {
      await db.exec(text);
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      if (inTransaction) return fn(self);
      return (db as PGlite).transaction((tx) => fn(wrap(tx, true)));
    },
  };
  return self;
}
