import { describe, expect, it } from 'vitest';

import { night } from './fixtures.ts';
import { harness, WEBHOOK_AUTH } from './helpers.ts';

describe('account deletion', () => {
  it('removes synced data and excludes contributor ids', async () => {
    const h = await harness();
    const me = await h.user('leaving@example.com');
    const other = await h.user();
    const { token, userId } = me;
    await h.call('POST', '/v1/sync/nights', { token, body: { device_id: 'a', nights: [night(), night()] } });
    await h.call('POST', '/v1/sync/nights', { token: other.token, body: { device_id: 'b', nights: [night()] } });
    await h.call('PUT', '/v1/profile', {
      token,
      body: { version: 1, age_band: '30-39', sex: null, height_band: null, weight_band: null, bmi_band: null, position: null, pauses_reported: null, apnoea_dx: null, cpap: null },
    });
    // One suggestion filed under the hashed user id (not contributing yet), one under a contributor id.
    await h.call('POST', '/v1/catalogue/suggest', { token, body: { text: 'Humidifier' } });
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: false } });
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: false } });
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    await h.call('POST', '/v1/catalogue/suggest', { token, body: { text: 'Chin strap' } });
    await h.call('POST', '/v1/catalogue/suggest', { token: other.token, body: { text: 'Humidifier' } });
    const ids = (
      await h.sql.query<{ contributor_id: string }>('SELECT contributor_id::text AS contributor_id FROM contribution WHERE user_id = $1', [userId])
    ).map((r) => r.contributor_id);
    expect(ids).toHaveLength(2);
    await h.call('POST', '/v1/subscription/webhook', {
      headers: { Authorization: WEBHOOK_AUTH },
      body: { event: { id: 'x', type: 'INITIAL_PURCHASE', app_user_id: userId, product_id: 'monthly', expiration_at_ms: Date.parse('2027-01-01') } },
    });
    await h.call('POST', '/v1/auth/magic-link', { body: { email: 'leaving@example.com' } });

    expect((await h.call('DELETE', '/v1/account', { token })).status).toBe(204);

    for (const table of ['app_user', 'device', 'profile', 'subscription', 'contribution']) {
      const col = table === 'app_user' ? 'id' : 'user_id';
      expect(await h.sql.query(`SELECT 1 FROM ${table} WHERE ${col} = $1`, [userId]), table).toEqual([]);
    }
    const [{ n }] = await h.sql.query<{ n: number }>('SELECT count(*)::int AS n FROM night_summary');
    expect(n).toBe(1); // only the other user's night
    expect(await h.sql.query(`SELECT 1 FROM magic_link WHERE email = 'leaving@example.com'`)).toEqual([]);
    expect(await h.sql.query('SELECT text FROM catalogue_suggestion')).toEqual([{ text: 'Humidifier' }]); // the other user's
    const excluded = await h.sql.query<{ contributor_id: string; reason: string }>(
      'SELECT contributor_id::text AS contributor_id, reason FROM contributor_exclusion ORDER BY 1',
    );
    expect(excluded).toEqual(ids.sort().map((contributor_id) => ({ contributor_id, reason: 'account_deleted' })));

    // The old session no longer works, and the other user is untouched.
    expect((await h.call('GET', '/v1/profile', { token })).status).toBe(401);
    expect((await h.call('GET', '/v1/sync/nights', { token: other.token })).body.nights).toHaveLength(1);
  });
});
