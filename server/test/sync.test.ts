import { describe, expect, it } from 'vitest';

import { night } from './fixtures.ts';
import { harness } from './helpers.ts';

describe('sync', () => {
  it('upserts nights and is idempotent', async () => {
    const h = await harness();
    const { token, userId } = await h.user();
    const n1 = night({
      health: {
        sleep_efficiency: 0.9,
        spo2_min: 91,
        spo2_dips: 3,
        hr_mean: 58,
        hr_max: 80,
        hrv_mean: null,
        resp_mean: 14.5,
      },
    });
    const n2 = night({ remedies: [], factors: [] });
    const first = await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'phone-a', nights: [n1, n2] } });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ accepted: [n1.id, n2.id], rejected: [] });

    const pull = await h.call('GET', '/v1/sync/nights', { token });
    expect(pull.body.nights).toEqual([n1, n2].sort((a, b) => (a.id < b.id ? -1 : 1)));

    // Same batch again: accepted, nothing rewritten, so the cursor sees nothing new.
    const again = await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'phone-a', nights: [n1, n2] } });
    expect(again.body).toEqual(first.body);
    const since = await h.call('GET', `/v1/sync/nights?since=${encodeURIComponent(pull.body.cursor)}`, { token });
    expect(since.body.nights).toEqual([]);
    expect(since.body.cursor).toBe(pull.body.cursor);

    const [{ n }] = await h.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM remedy_log');
    expect(n).toBe(1);
    const devices = await h.sql.query('SELECT device_id FROM device WHERE user_id = $1', [userId]);
    expect(devices).toEqual([{ device_id: 'phone-a' }]);
  });

  it('applies a newer edit, replaces its logs, and ignores an older one', async () => {
    const h = await harness();
    const { token } = await h.user();
    const n = night();
    await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'a', nights: [n] } });
    const cursor = (await h.call('GET', '/v1/sync/nights', { token })).body.cursor;

    const edited = {
      ...n,
      remedies: ['side_sleeping', 'mouth_tape'],
      factors: [{ id: 'congestion', value: null }],
      typical: false,
      updated_at: '2026-10-14T07:00:00.000Z',
    };
    await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'b', nights: [edited] } });
    const pulled = await h.call('GET', `/v1/sync/nights?since=${encodeURIComponent(cursor)}`, { token });
    expect(pulled.body.nights).toEqual([{ ...edited, remedies: ['mouth_tape', 'side_sleeping'] }]);

    // A second edit within the same second (the phone stores whole seconds) still applies.
    const sameSecond = { ...edited, typical: true };
    await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'b', nights: [sameSecond] } });
    expect((await h.call('GET', '/v1/sync/nights', { token })).body.nights[0].typical).toBe(true);

    const stale = { ...n, score: 99, updated_at: '2026-10-14T05:00:00.000Z' };
    const res = await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'a', nights: [stale] } });
    expect(res.body.accepted).toEqual([n.id]);
    const all = await h.call('GET', '/v1/sync/nights', { token });
    expect(all.body.nights[0].score).toBe(42);
    expect(all.body.nights[0].remedies).toEqual(['mouth_tape', 'side_sleeping']);
  });

  it("rejects another user's night id and leaves it alone", async () => {
    const h = await harness();
    const alice = await h.user();
    const bob = await h.user();
    const n = night();
    await h.call('POST', '/v1/sync/nights', { token: alice.token, body: { device_id: 'a', nights: [n] } });
    const hijack = { ...n, score: 1, updated_at: '2030-01-01T00:00:00.000Z' };
    const res = await h.call('POST', '/v1/sync/nights', { token: bob.token, body: { device_id: 'b', nights: [hijack] } });
    expect(res.body).toEqual({ accepted: [], rejected: [{ id: n.id, reason: 'night belongs to another account' }] });
    expect((await h.call('GET', '/v1/sync/nights', { token: alice.token })).body.nights[0].score).toBe(42);
    expect((await h.call('GET', '/v1/sync/nights', { token: bob.token })).body.nights).toEqual([]);
    // Bob cannot delete it either.
    await h.call('DELETE', `/v1/sync/nights/${n.id}`, { token: bob.token });
    expect((await h.call('GET', '/v1/sync/nights', { token: alice.token })).body.nights).toHaveLength(1);
  });

  it('rejects invalid nights one by one with a reason', async () => {
    const h = await harness();
    const { token } = await h.user();
    const good = night();
    const res = await h.call('POST', '/v1/sync/nights', {
      token,
      body: {
        device_id: 'a',
        nights: [
          good,
          night({ id: 'bad-score', score: 140 }),
          night({ id: 'bad-date', date: '13/10/2026' }),
          { ...night({ id: 'missing' }), pct_snoring: undefined },
          night({ id: good.id }),
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.accepted).toEqual([good.id]);
    expect(res.body.rejected.map((r: { id: string }) => r.id)).toEqual(['bad-score', 'bad-date', 'missing', good.id]);
    expect(res.body.rejected[0].reason).toMatch(/^score: /);
    expect(res.body.rejected[3].reason).toBe('duplicate id in this batch');
  });

  it('rejects a malformed envelope as a whole', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('POST', '/v1/sync/nights', { token, body: { nights: [] } })).status).toBe(400);
    expect((await h.call('POST', '/v1/sync/nights', { token, body: 'not json' })).body.error.code).toBe('invalid_json');
    expect((await h.call('GET', '/v1/sync/nights?since=yesterday', { token })).status).toBe(400);
  });

  it('deletes a night', async () => {
    const h = await harness();
    const { token } = await h.user();
    const n = night();
    await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'a', nights: [n] } });
    expect((await h.call('DELETE', `/v1/sync/nights/${n.id}`, { token })).status).toBe(204);
    expect((await h.call('DELETE', `/v1/sync/nights/${n.id}`, { token })).status).toBe(204);
    expect((await h.call('GET', '/v1/sync/nights', { token })).body.nights).toEqual([]);
    const [{ n: logs }] = await h.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM remedy_log');
    expect(logs).toBe(0);
  });
});
