import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Alerts } from '../src/alerts.ts';
import type { AggregateJobResult } from '../src/jobs/aggregateJob.ts';
import { AGGREGATE_SECRET_HEADER, createAggregateHandler } from '../src/jobs/aggregateHttp.ts';
import { TestClock, testDb } from './helpers.ts';

// The job itself is tested in aggregateJob.test.ts; here only what the handler does with its outcome.
const job = vi.hoisted(() => ({ run: (): Promise<unknown> => Promise.resolve(null) }));
vi.mock('../src/jobs/aggregateJob.ts', () => ({ runAggregation: () => job.run() }));

const result = (ok: boolean, message: string | null): AggregateJobResult => ({
  ok,
  jobId: 'job',
  computedAt: '2026-10-14T04:00:00.000Z',
  contributors: 0,
  aggregateRows: 0,
  stackRows: 0,
  snapshots: 0,
  scoreVersion: null,
  message,
});

describe('aggregation alerts', () => {
  let reports: { kind: string; err: unknown }[];
  let alerts: Alerts;
  beforeEach(() => {
    reports = [];
    alerts = { report: async (kind, err) => void reports.push({ kind, err }) };
  });

  const post = async (handler: (req: Request) => Promise<Response>) =>
    handler(new Request('http://localhost/', { method: 'POST', headers: { [AGGREGATE_SECRET_HEADER]: 's3cret' } }));

  it('alert when a sanity check fails and nothing is published', async () => {
    job.run = () => Promise.resolve(result(false, 'Sanity check failed, nothing published: alcohol median delta -3.00 is not positive'));
    const res = await post(createAggregateHandler({ sql: await testDb(), clock: new TestClock(), secret: 's3cret', alerts }));
    expect(res.status).toBe(500);
    expect(reports.map((r) => r.kind)).toEqual(['aggregate']);
    expect(String(reports[0].err)).toContain('alcohol median delta');
  });

  it('alert when the run throws', async () => {
    job.run = () => Promise.reject(new Error('canceling statement due to statement timeout'));
    const res = await post(createAggregateHandler({ sql: await testDb(), clock: new TestClock(), secret: 's3cret', alerts }));
    expect(res.status).toBe(500);
    expect(reports.map((r) => r.kind)).toEqual(['aggregate']);
  });

  it('stay quiet when the run publishes', async () => {
    job.run = () => Promise.resolve(result(true, null));
    const res = await post(createAggregateHandler({ sql: await testDb(), clock: new TestClock(), secret: 's3cret', alerts }));
    expect(res.status).toBe(200);
    expect(reports).toEqual([]);
  });
});
