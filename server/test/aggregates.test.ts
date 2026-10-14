import { describe, expect, it } from 'vitest';

import type { AggregatesResponse } from '../../shared/api.ts';
import { harness, WEBHOOK_AUTH } from './helpers.ts';

/** Hand-written snapshots and rows, so these tests are about serving, not computing. */
async function publish(h: Awaited<ReturnType<typeof harness>>) {
  const body = (segment: string): AggregatesResponse => ({
    segment,
    window: 'all',
    segment_status: 'ok',
    computed_at: '2026-10-14T04:00:00.000Z',
    remedies: [
      {
        remedy_id: 'side_sleeping',
        status: 'ok',
        users: 40,
        nights: 400,
        median_delta: -12,
        p25: -18,
        p75: -5,
        median_delta_pct: -0.08,
        holds_without_alcohol: true,
        trend: 'steady',
      },
    ],
    stacks: [],
    testing: { people: 55, remedies: 4 },
  });
  for (const segment of ['all', 'age:40-49']) {
    await h.sql.query(
      `INSERT INTO aggregate_snapshot (segment, time_window, body, etag, computed_at)
       VALUES ($1, 'all', $2::text::jsonb, $3, '2026-10-14T04:00:00Z')`,
      [segment, JSON.stringify(body(segment)), `"etag-${segment}"`],
    );
    await h.sql.query(
      `INSERT INTO aggregate (segment, time_window, remedy_id, status, users, nights, median_delta, p25, p75,
         median_delta_pct, holds_without_alcohol, trend, distribution)
       VALUES ($1, 'all', 'side_sleeping', 'ok', 40, 400, -12.3456, -18, -5, -0.08, true, 'steady', $2::text::jsonb)`,
      [segment, segment === 'all' ? JSON.stringify([{ bucket: -15, count: 40 }]) : null],
    );
  }
}

async function subscribe(h: Awaited<ReturnType<typeof harness>>, userId: string) {
  const res = await h.call('POST', '/v1/subscription/webhook', {
    headers: { Authorization: WEBHOOK_AUTH },
    body: {
      event: {
        id: crypto.randomUUID(),
        type: 'INITIAL_PURCHASE',
        app_user_id: userId,
        product_id: 'insight_yearly',
        entitlement_ids: ['insight'],
        expiration_at_ms: Date.parse('2027-10-14T04:00:00Z'),
        event_timestamp_ms: Date.parse('2026-10-14T04:00:00Z'),
      },
    },
  });
  expect(res.status).toBe(200);
}

describe('aggregates', () => {
  it('serves the whole community to everyone, with an ETag', async () => {
    const h = await harness();
    await publish(h);
    const { token } = await h.user();
    const res = await h.call('GET', '/v1/aggregates', { token });
    expect(res.status).toBe(200);
    expect(res.body.segment).toBe('all');
    expect(res.body.remedies[0].remedy_id).toBe('side_sleeping');
    expect(res.headers.get('ETag')).toBe('"etag-all"');
    expect(res.headers.get('Cache-Control')).toContain('max-age=86400');

    const cached = await h.call('GET', '/v1/aggregates?segment=all&window=all', {
      token,
      headers: { 'If-None-Match': 'W/"etag-all"' },
    });
    expect(cached.status).toBe(304);
    expect(cached.body).toBeNull();
    const stale = await h.call('GET', '/v1/aggregates', { token, headers: { 'If-None-Match': '"old"' } });
    expect(stale.status).toBe(200);
  });

  it('keeps profile segments behind the paywall', async () => {
    const h = await harness();
    await publish(h);
    const { token, userId } = await h.user();
    const res = await h.call('GET', '/v1/aggregates?segment=age:40-49', { token });
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe('paywall');

    await subscribe(h, userId);
    const paid = await h.call('GET', '/v1/aggregates?segment=age:40-49', { token });
    expect(paid.status).toBe(200);
    expect(paid.body.segment).toBe('age:40-49');
  });

  it('hides unknown or small segments', async () => {
    const h = await harness();
    await publish(h);
    const { token, userId } = await h.user();
    await subscribe(h, userId);
    const res = await h.call('GET', '/v1/aggregates?segment=sex:other&window=90d', { token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      segment: 'sex:other',
      window: '90d',
      segment_status: 'hidden',
      computed_at: '2026-10-14T04:00:00.000Z',
      remedies: [],
      stacks: [],
      testing: { people: 55, remedies: 4 },
    });
    expect((await h.call('GET', '/v1/aggregates?segment=DROP TABLE', { token })).status).toBe(400);
    expect((await h.call('GET', '/v1/aggregates?window=7d', { token })).status).toBe(400);
  });

  it('answers before the first run', async () => {
    const h = await harness();
    const { token } = await h.user();
    const res = await h.call('GET', '/v1/aggregates', { token });
    expect(res.body).toMatchObject({ segment_status: 'ok', computed_at: null, remedies: [], testing: { people: 0, remedies: 0 } });
  });

  it('serves remedy detail, with segments only for subscribers', async () => {
    const h = await harness();
    await publish(h);
    const { token, userId } = await h.user();
    const free = await h.call('GET', '/v1/aggregates/side_sleeping', { token });
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({
      remedy_id: 'side_sleeping',
      all: { status: 'ok', users: 40, median_delta: -12.35 },
      distribution: [{ bucket: -15, count: 40 }],
      by_segment: [],
      by_segment_locked: true,
      amazon: null,
    });
    expect(free.body.article_md.length).toBeGreaterThan(50);

    await subscribe(h, userId);
    const paid = await h.call('GET', '/v1/aggregates/side_sleeping', { token });
    expect(paid.body.by_segment_locked).toBe(false);
    expect(paid.body.by_segment).toEqual([expect.objectContaining({ segment: 'age:40-49', remedy_id: 'side_sleeping' })]);

    const strips = await h.call('GET', '/v1/aggregates/nasal_strips', { token });
    expect(strips.body).toMatchObject({ all: null, distribution: [], amazon: { search: 'nasal strips' } });
    expect((await h.call('GET', '/v1/aggregates/alcohol', { token })).status).toBe(404);
    expect((await h.call('GET', '/v1/aggregates/nope', { token })).status).toBe(404);
  });
});
