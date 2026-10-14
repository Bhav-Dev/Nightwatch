/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import type { Db, SQLValue } from '../../src/data/db';

/** node:sqlite behind the same interface expo-sqlite provides, for unit tests. */
export function openTestDb(): Db {
  const db = new DatabaseSync(':memory:');
  let depth = 0;
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params: SQLValue[] = []) {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: SQLValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: SQLValue[] = []) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
    async withTransactionAsync(task) {
      const sp = `sp${depth++}`;
      db.exec(`SAVEPOINT ${sp}`);
      try {
        await task();
        db.exec(`RELEASE ${sp}`);
      } catch (e) {
        db.exec(`ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
  };
}
