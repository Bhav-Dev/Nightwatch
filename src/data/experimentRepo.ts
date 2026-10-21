import type { Db } from './db';
import type { Verdict } from '../domain/experiment';

export interface ExperimentRow {
  id: string;
  remedy_id: string;
  started: string;
  pattern: string;
  status: 'running' | 'complete' | 'cancelled';
  verdict: string | null;
  /** Tests started together as one guided test ('type' for "Find your type"); null on its own. */
  test_group: string | null;
}

export interface Experiment {
  id: string;
  remedyId: string;
  started: string;
  pattern: boolean[];
  status: ExperimentRow['status'];
  verdict: Verdict | null;
  group: string | null;
}

const fromRow = (r: ExperimentRow): Experiment => ({
  id: r.id,
  remedyId: r.remedy_id,
  started: r.started,
  pattern: JSON.parse(r.pattern) as boolean[],
  status: r.status,
  verdict: r.verdict ? (JSON.parse(r.verdict) as Verdict) : null,
  group: r.test_group ?? null,
});

export async function startExperiment(
  db: Db,
  e: { id: string; remedyId: string; started: string; pattern: boolean[]; group?: string | null },
): Promise<void> {
  await db.runAsync("UPDATE experiment SET status = 'cancelled' WHERE remedy_id = ? AND status = 'running'", [e.remedyId]);
  await db.runAsync("INSERT INTO experiment (id, remedy_id, started, pattern, status, test_group) VALUES (?, ?, ?, ?, 'running', ?)", [
    e.id,
    e.remedyId,
    e.started,
    JSON.stringify(e.pattern),
    e.group ?? null,
  ]);
}

/** Starts tests together as one guided test (a running test of the same remedy is replaced). */
export async function startTestGroup(
  db: Db,
  group: string,
  started: string,
  tests: readonly { id: string; remedyId: string; pattern: boolean[] }[],
): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const t of tests) await startExperiment(db, { ...t, started, group });
  });
}

export async function listExperiments(db: Db): Promise<Experiment[]> {
  const rows = await db.getAllAsync<ExperimentRow>('SELECT * FROM experiment ORDER BY started DESC', []);
  return rows.map(fromRow);
}

export async function runningExperiments(db: Db): Promise<Experiment[]> {
  return (await listExperiments(db)).filter((e) => e.status === 'running');
}

export async function completeExperiment(db: Db, id: string, verdict: Verdict): Promise<void> {
  await db.runAsync("UPDATE experiment SET status = 'complete', verdict = ? WHERE id = ?", [JSON.stringify(verdict), id]);
}

export async function cancelExperiment(db: Db, id: string): Promise<void> {
  await db.runAsync("UPDATE experiment SET status = 'cancelled' WHERE id = ?", [id]);
}
