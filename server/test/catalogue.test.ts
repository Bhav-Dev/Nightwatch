import { describe, expect, it } from 'vitest';

import { harness } from './helpers.ts';

describe('catalogue', () => {
  it('serves the seeded catalogue with Amazon tags', async () => {
    const h = await harness();
    const { token } = await h.user();
    const res = await h.call('GET', '/v1/catalogue', { token });
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.amazon_tags).toEqual({ GB: 'nightwatch-21' });
    expect(res.body.items).toHaveLength(42);
    const strips = res.body.items.find((i: { id: string }) => i.id === 'nasal_strips');
    expect(strips).toMatchObject({
      type: 'remedy',
      kind: 'device',
      link_url: null,
      amazon: { search: 'nasal strips' },
      active: true,
    });
    expect(strips).not.toHaveProperty('value_options');
    const alcohol = res.body.items.find((i: { id: string }) => i.id === 'alcohol');
    expect(alcohol).toMatchObject({ type: 'factor', amazon: null, value_options: ['1-2', '3-4', '5+'] });
  });

  it('returns only rows newer than since', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('GET', '/v1/catalogue?since=1', { token })).body).toMatchObject({ version: 1, items: [] });
    await h.sql.query(`UPDATE catalogue SET name = 'Chin strap (soft)', version = 2 WHERE id = 'chin_strap'`);
    const res = await h.call('GET', '/v1/catalogue?since=1', { token });
    expect(res.body.version).toBe(2);
    expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(['chin_strap']);
    expect((await h.call('GET', '/v1/catalogue?since=abc', { token })).status).toBe(400);
  });
});
