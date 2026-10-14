import { describe, expect, it } from 'vitest';

import { harness } from './helpers.ts';
import { night } from './fixtures.ts';

describe('contribution', () => {
  it('opts in with a new random id, out onto the exclusion list, and in again with another', async () => {
    const h = await harness();
    const { token, userId } = await h.user();
    const active = () =>
      h.sql.query<{ contributor_id: string }>(
        'SELECT contributor_id::text AS contributor_id FROM contribution WHERE user_id = $1 AND withdrawn_at IS NULL',
        [userId],
      );

    expect((await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } })).body).toEqual({
      opted_in: true,
      contributor_id_exists: true,
    });
    const [first] = await active();
    expect(first.contributor_id).not.toBe(userId);
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    expect(await active()).toEqual([first]);

    expect((await h.call('PUT', '/v1/contribution', { token, body: { opted_in: false } })).body).toEqual({
      opted_in: false,
      contributor_id_exists: false,
    });
    expect(await active()).toEqual([]);
    const excluded = await h.sql.query('SELECT reason FROM contributor_exclusion WHERE contributor_id = $1', [
      first.contributor_id,
    ]);
    expect(excluded).toEqual([{ reason: 'withdrawn' }]);

    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    const [second] = await active();
    expect(second.contributor_id).not.toBe(first.contributor_id);
  });

  it('summarises what is being contributed', async () => {
    const h = await harness();
    const { token } = await h.user();
    await h.call('POST', '/v1/sync/nights', {
      token,
      body: {
        device_id: 'a',
        nights: [night({ remedies: ['nasal_strips', 'mouth_tape'] }), night({ remedies: ['nasal_strips'] }), night()],
      },
    });
    expect((await h.call('GET', '/v1/contribution/summary', { token })).body).toEqual({
      opted_in: false,
      nights: 0,
      remedies_logged: 0,
      since: null,
    });
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    expect((await h.call('GET', '/v1/contribution/summary', { token })).body).toEqual({
      opted_in: true,
      nights: 3,
      remedies_logged: 2,
      since: '2026-10-14T04:00:00.000Z',
    });
  });

  it('stores suggestions without user ids and counts duplicates', async () => {
    const h = await harness();
    const a = await h.user();
    const b = await h.user();
    await h.call('PUT', '/v1/contribution', { token: a.token, body: { opted_in: true } });
    expect((await h.call('POST', '/v1/catalogue/suggest', { token: a.token, body: { text: 'Mouth guard' } })).status).toBe(202);
    await h.call('POST', '/v1/catalogue/suggest', { token: a.token, body: { text: 'mouth   GUARD ' } });
    await h.call('POST', '/v1/catalogue/suggest', { token: b.token, body: { text: 'Mouth guard' } });
    const counts = await h.sql.query('SELECT text_key, people, times FROM catalogue_suggestion_counts');
    expect(counts).toEqual([{ text_key: 'mouth guard', people: 2, times: 3 }]);
    const keys = (await h.sql.query<{ submitter_key: string }>('SELECT submitter_key FROM catalogue_suggestion')).map(
      (r) => r.submitter_key,
    );
    expect(keys.some((k) => k.startsWith('c:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('h:'))).toBe(true);
    expect(keys.join()).not.toContain(a.userId);
    expect(keys.join()).not.toContain(b.userId);
    expect((await h.call('POST', '/v1/catalogue/suggest', { token: a.token, body: { text: '  ' } })).status).toBe(400);
  });
});
