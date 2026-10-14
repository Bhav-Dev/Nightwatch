import type { Db } from './db';

export async function getCached<T>(db: Db, key: string): Promise<{ value: T; etag: string | null; fetchedAt: number } | null> {
  const row = await db.getFirstAsync<{ value: string; etag: string | null; fetched_at: number }>('SELECT value, etag, fetched_at FROM cache WHERE key = ?', [key]);
  return row ? { value: JSON.parse(row.value) as T, etag: row.etag, fetchedAt: row.fetched_at } : null;
}

export async function setCached(db: Db, key: string, value: unknown, etag: string | null, now = Date.now()): Promise<void> {
  await db.runAsync(
    `INSERT INTO cache (key, value, etag, fetched_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, etag = excluded.etag, fetched_at = excluded.fetched_at`,
    [key, JSON.stringify(value), etag, Math.floor(now / 1000)],
  );
}

export async function clearCache(db: Db): Promise<void> {
  await db.runAsync('DELETE FROM cache', []);
}
