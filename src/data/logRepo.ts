import type { Db } from './db';
import { getSetting, setSetting } from './settingsRepo';

export interface LogTick {
  itemId: string;
  type: 'remedy' | 'factor';
  value: string | null;
}

interface PendingRow {
  item_id: string;
  type: 'remedy' | 'factor';
  value: string | null;
}

export async function getPendingLog(db: Db): Promise<LogTick[]> {
  const rows = await db.getAllAsync<PendingRow>('SELECT item_id, type, value FROM pending_log', []);
  return rows.map((r) => ({ itemId: r.item_id, type: r.type, value: r.value }));
}

export async function setPendingTick(db: Db, tick: LogTick, on: boolean): Promise<void> {
  if (on) {
    await db.runAsync(
      `INSERT INTO pending_log (item_id, type, value) VALUES (?, ?, ?)
       ON CONFLICT(item_id) DO UPDATE SET value = excluded.value`,
      [tick.itemId, tick.type, tick.value],
    );
  } else {
    await db.runAsync('DELETE FROM pending_log WHERE item_id = ?', [tick.itemId]);
  }
}

/** The remedies and factors logged on the most recent night, or [] if there is none. */
export async function lastNightLog(db: Db): Promise<LogTick[]> {
  const last = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM night ORDER BY started_at DESC LIMIT 1',
    [],
  );
  if (!last) return [];
  const remedies = await db.getAllAsync<{ remedy_id: string }>(
    'SELECT remedy_id FROM remedy_log WHERE night_id = ?',
    [last.id],
  );
  const factors = await db.getAllAsync<{ factor_id: string; value: string | null }>(
    'SELECT factor_id, value FROM factor_log WHERE night_id = ?',
    [last.id],
  );
  return [
    ...remedies.map((r): LogTick => ({ itemId: r.remedy_id, type: 'remedy', value: null })),
    ...factors.map((f): LogTick => ({ itemId: f.factor_id, type: 'factor', value: f.value })),
  ];
}

/**
 * Pre-fills tonight's ticks from last night, once per local date. After that the user's
 * own toggles (including clearing everything) are left alone.
 */
export async function prefillPendingLog(db: Db, today: string): Promise<LogTick[]> {
  if ((await getSetting(db, 'pending_prefilled_for')) !== today) {
    const last = await lastNightLog(db);
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM pending_log', []);
      for (const t of last) {
        await db.runAsync('INSERT INTO pending_log (item_id, type, value) VALUES (?, ?, ?)', [
          t.itemId,
          t.type,
          t.value,
        ]);
      }
    });
    await setSetting(db, 'pending_prefilled_for', today);
  }
  return getPendingLog(db);
}

/**
 * At Stop: tonight's ticks become the night's log. Nights with no ticks count as "nothing
 * tried". Returns how many remedies and factors were logged.
 */
export async function commitPendingLog(db: Db, nightId: string): Promise<{ remedies: number; factors: number }> {
  const pending = await getPendingLog(db);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT OR IGNORE INTO remedy_log (night_id, remedy_id)
       SELECT ?, item_id FROM pending_log WHERE type = 'remedy'`,
      [nightId],
    );
    await db.runAsync(
      `INSERT OR IGNORE INTO factor_log (night_id, factor_id, value)
       SELECT ?, item_id, value FROM pending_log WHERE type = 'factor'`,
      [nightId],
    );
    await db.runAsync('DELETE FROM pending_log', []);
  });
  await setSetting(db, 'pending_prefilled_for', null);
  return { remedies: pending.filter((p) => p.type === 'remedy').length, factors: pending.filter((p) => p.type === 'factor').length };
}
