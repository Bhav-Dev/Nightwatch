/**
 * The only database surface the server uses. Two adapters implement it: the `postgres` driver
 * (production, on Node and Deno) and PGlite (tests). Keeping it this small is what lets the
 * same code run on a VPS or on Supabase.
 *
 * Conventions so both drivers return the same JS values:
 * - placeholders are $1, $2, ...;
 * - objects and arrays are passed as JSON text and cast in SQL ($1::text::jsonb);
 * - counts are cast to integer (bigint comes back as a string from `postgres`);
 * - timestamps are passed as ISO strings and come back as Date.
 */
export interface Sql {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs a script of several statements with no parameters (migrations). */
  exec(text: string): Promise<void>;
  /** Runs fn in a transaction. Nested calls join the outer transaction. */
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
}

/** JSON text for a jsonb parameter. */
export const json = (value: unknown) => JSON.stringify(value);
