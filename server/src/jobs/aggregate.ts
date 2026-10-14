/**
 * Nightly aggregation, run once from the command line (cron or a systemd timer on a VPS):
 *
 *   node dist/aggregate.js [--exclude-date 2026-10-14 ...]
 *
 * Exits non-zero when the run fails, including a failed sanity check (nothing is published).
 */
import { systemClock } from '../clock.ts';
import { postgresSql } from '../db/postgres.ts';
import { assertSchema, schemaFromEnv } from '../db/schema.ts';
import { runAggregation } from './aggregateJob.ts';

export function parseArgs(argv: string[]): { excludeDates: string[] } {
  const excludeDates: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = a === '--exclude-date' ? argv[++i] : a.startsWith('--exclude-date=') ? a.slice(15) : null;
    if (value === null) throw new Error(`Unknown argument: ${a}`);
    for (const d of (value ?? '').split(',')) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`--exclude-date needs yyyy-mm-dd, got "${d}"`);
      excludeDates.push(d);
    }
  }
  return { excludeDates };
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = postgresSql(url, { max: 1, prepare: process.env.DATABASE_PREPARE !== 'false' });
try {
  await assertSchema(sql, schemaFromEnv(process.env));
  const result = await runAggregation(sql, systemClock, parseArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await sql.close();
}
