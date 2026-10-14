import { describe, expect, it } from 'vitest';

import { EMPTY_PROFILE } from '../../shared/profile.ts';
import { harness } from './helpers.ts';

const bands = { ...EMPTY_PROFILE, age_band: '40-49', bmi_band: '25-30', position: 'back', apnoea_dx: false };

describe('profile', () => {
  it('starts empty at version 0', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('GET', '/v1/profile', { token })).body).toEqual({ ...EMPTY_PROFILE, version: 0 });
  });

  it('accepts the same or a newer version and refuses an older one', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('PUT', '/v1/profile', { token, body: { ...bands, version: 3 } })).body).toEqual({ version: 3 });
    expect((await h.call('PUT', '/v1/profile', { token, body: { ...bands, sex: 'female', version: 3 } })).status).toBe(200);
    const stale = await h.call('PUT', '/v1/profile', { token, body: { ...bands, sex: 'male', version: 2 } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('version_conflict');
    expect((await h.call('GET', '/v1/profile', { token })).body).toEqual({ ...bands, sex: 'female', version: 3 });
  });

  it('only accepts bands, never exact values', async () => {
    const h = await harness();
    const { token } = await h.user();
    const res = await h.call('PUT', '/v1/profile', { token, body: { ...bands, age_band: '43', version: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/^age_band/);
  });
});
