import type { Db } from './db';
import type { Verdict } from '../domain/experiment';

export interface ExperimentRow {
  id: string;
  remedy_id: string;
  started: string;
  pattern: string;
  status: 'running' | 'complete' | 'cancelled';
  verdict: string | null;
}

export interface Experiment {
  id: string;
  remedyId: string;
  started: string;
  pattern: boolean[];
  status: ExperimentRow['status'];
  verdict: Verdict | null;
}

const fromRow = (r: ExperimentRow): Experiment => ({
  id: r.id,
  remedyId: r.remedy_id,
  started: r.started,
  pattern: JSON.parse(r.pattern) as boolean[],
  status: r.status,
  verdict: r.verdict ? (JSON.parse(r.verdict) as Verdict) : null,
});

export async function startExperiment(db: Db, e: { id: string; remedyId: string; started: string; pattern: boolean[] }): Promise<void> {
  await db.runAsync("UPDATE experiment SET status = 'cancelled' WHERE remedy_id = ? AND status = 'running'", [e.remedyId]);
  await db.runAsync("INSERT INTO experiment (id, remedy_id, started, pattern, status) VALUES (?, ?, ?, ?, 'running')", [
    e.id,
    e.remedyId,
    e.started,
    JSON.stringify(e.pattern),
  ]);
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
