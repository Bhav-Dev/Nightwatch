import postgres from 'postgres';

import type { Sql } from './sql.ts';

export interface PostgresOptions {
  /** Pool size. Edge functions want 1; a VPS process can use more. */
  max?: number;
  /**
   * Named prepared statements. Must be false behind a transaction-mode pooler (Supabase's
   * port 6543, PgBouncer), which cannot keep statements between transactions.
   */
  prepare?: boolean;
}

export type ClosableSql = Sql & { close(): Promise<void> };

/** Production adapter over the `postgres` driver; works on Node and Deno. */
export function postgresSql(url: string, opts: PostgresOptions = {}): ClosableSql {
  const client = postgres(url, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? true,
    onnotice: () => {},
    // Keep timestamps as Date and leave everything else to the defaults.
  });
  return { ...wrap(client), close: () => client.end({ timeout: 5 }) };
}

type Client = postgres.Sql | postgres.TransactionSql;

function wrap(client: Client, inTransaction = false): Sql {
  const self: Sql = {
    async query<T>(text: string, params: unknown[] = []) {
      const rows = await client.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return [...rows] as T[];
    },
    async exec(text: string) {
      // No parameters means the simple query protocol, which allows several statements.
      await client.unsafe(text);
    },
    async transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T> {
      if (inTransaction) return fn(self);
      return (client as postgres.Sql).begin((tx) => fn(wrap(tx, true))) as Promise<T>;
    },
  };
  return self;
}
