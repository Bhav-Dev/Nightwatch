export type SQLValue = string | number | null;

/**
 * The subset of expo-sqlite's SQLiteDatabase the data layer uses. Keeping to this
 * interface lets the same code run against node:sqlite in unit tests.
 */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SQLValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: SQLValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SQLValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
