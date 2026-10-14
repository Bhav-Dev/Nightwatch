import { describe, expect, it } from 'vitest';

import { AGGREGATE_SECRET_HEADER, createAggregateHandler } from '../src/jobs/aggregateHttp.ts';
import { TestClock, testDb } from './helpers.ts';

describe('aggregate function (Supabase schedule target)', () => {
  it('runs the job only with the secret header', async () => {
    const sql = await testDb();
    const handler = createAggregateHandler({ sql, clock: new TestClock(), secret: 's3cret' });
    const post = (headers: Record<string, string>, body?: unknown) =>
      handler(
        new Request('http://localhost/aggregate', {
          method: 'POST',
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );

    expect((await handler(new Request('http://localhost/aggregate'))).status).toBe(405);
    expect((await post({})).status).toBe(401);
    expect((await post({ [AGGREGATE_SECRET_HEADER]: 'wrong' })).status).toBe(401);
    expect((await post({ [AGGREGATE_SECRET_HEADER]: 's3cret' }, { exclude_dates: ['14/10'] })).status).toBe(400);

    const ok = await post({ [AGGREGATE_SECRET_HEADER]: 's3cret' }, { exclude_dates: ['2026-10-01'] });
    expect(ok.status).toBe(200);
    const result = await ok.json();
    expect(result).toMatchObject({ ok: true, contributors: 0, snapshots: 2 });
    const [snap] = await sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM aggregate_snapshot`);
    expect(snap.n).toBe(2);
  });

  it('is refused when no secret is configured', async () => {
    const sql = await testDb();
    const handler = createAggregateHandler({ sql, clock: new TestClock(), secret: null });
    const res = await handler(new Request('http://localhost/', { method: 'POST', headers: { [AGGREGATE_SECRET_HEADER]: '' } }));
    expect(res.status).toBe(401);
  });
});
