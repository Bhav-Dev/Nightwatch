import type { Db } from './db';

export interface Snapshot {
  id: string;
  name: string;
  from_date: string;
  to_date: string;
  avg_score: number;
}

/** Locks a period's average (e.g. a 30-night baseline) to compare later periods against. */
export async function saveSnapshot(db: Db, s: { id: string; name: string; from: string; to: string }): Promise<Snapshot | null> {
  const row = await db.getFirstAsync<{ avg: number | null }>(
    "SELECT AVG(score) AS avg FROM night WHERE counts_toward_averages = 1 AND substr(date, 1, 10) BETWEEN ? AND ?",
    [s.from, s.to],
  );
  if (row?.avg === null || row?.avg === undefined) return null;
  await db.runAsync('INSERT INTO snapshot (id, name, from_date, to_date, avg_score) VALUES (?, ?, ?, ?, ?)', [s.id, s.name, s.from, s.to, row.avg]);
  return { id: s.id, name: s.name, from_date: s.from, to_date: s.to, avg_score: row.avg };
}

export async function listSnapshots(db: Db): Promise<Snapshot[]> {
  return db.getAllAsync<Snapshot>('SELECT * FROM snapshot ORDER BY to_date DESC', []);
}

export async function deleteSnapshot(db: Db, id: string): Promise<void> {
  await db.runAsync('DELETE FROM snapshot WHERE id = ?', [id]);
}
