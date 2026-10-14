import { PGlite, type Transaction } from '@electric-sql/pglite';

import type { Sql } from './sql.ts';

/**
 * Test adapter over PGlite (Postgres compiled to WASM, in process). Same SQL, same
 * semantics as production, no server to run.
 */
export function pgliteSql(db: PGlite): Sql & { db: PGlite } {
  return { ...wrap(db, false), db };
}

export async function createPglite(): Promise<Sql & { db: PGlite }> {
  return pgliteSql(await PGlite.create());
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
