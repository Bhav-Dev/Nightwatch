/**
 * Contract test: the app's own API client, sync engine and catalogue refresh (from src/)
 * against this server, in process. Catches drift between the two sides of shared/api.ts that
 * each side's own tests would miss.
 */
import { describe, expect, it } from 'vitest';

import { openTestDb } from '../../__tests__/helpers/nodeDb';
import { ApiClient } from '../../src/api/client';
import { loadAggregates } from '../../src/community/aggregates';
import { refreshCatalogue } from '../../src/data/catalogueClient';
import { listActiveCatalogue, seedCatalogueIfEmpty } from '../../src/data/catalogueRepo';
import { setNightTick, saveNight, getNight, setTypical } from '../../src/data/nightRepo';
import { getProfile, saveProfile } from '../../src/data/profileRepo';
import { migrate as migrateLocal } from '../../src/data/schema';
import { analyseNight } from '../../src/domain/scoring';
import { syncNow } from '../../src/sync/sync';
import { EMPTY_PROFILE } from '../../shared/profile';
import { harness } from './helpers.ts';

function frames(hours: number) {
  const out = [];
  for (let t = 0; t < hours * 3600; t++) {
    const snoring = t % 600 < 120;
    out.push({ t, levelDb: snoring ? -40 : -60, snoreProb: snoring ? 0.9 : 0.05 });
  }
  return out;
}

async function phone() {
  const db = openTestDb();
  await migrateLocal(db);
  await seedCatalogueIfEmpty(db);
  return db;
}

describe('app ↔ server contract', () => {
  it('signs in by magic link, syncs nights between two phones, and reads the community snapshot', async () => {
    const h = await harness();
    let token: string | null = null;
    const fetchFn = (url: string, init?: RequestInit) => Promise.resolve(h.app.request(url.replace('https://api.test', ''), init));
    const api = new ApiClient('https://api.test', () => token, fetchFn);

    // Sign in exactly as the app does.
    await api.requestMagicLink('sleeper@example.com');
    const link = h.mailer.sent.at(-1)!.text.match(/token=([A-Za-z0-9_-]+)/)![1];
    const session = await api.exchange({ provider: 'email', token: link });
    token = session.session_token;
    expect(session.user_id).toMatch(/[0-9a-f-]{36}/);

    // Catalogue refresh with the session.
    const a = await phone();
    await refreshCatalogue(a, api);
    expect((await listActiveCatalogue(a)).length).toBe(42);

    // Phone A records a night with a log and a profile, then syncs.
    const analysis = analyseNight({ durationS: 8 * 3600, frames: frames(8) });
    const started = new Date(2026, 9, 13, 23, 0);
    await saveNight(a, { id: '7b0c2f4e-1111-4c2b-9d3a-000000000001', startedAt: started, endedAt: new Date(started.getTime() + 8 * 3600_000), partial: false, analysis, newId: () => crypto.randomUUID() });
    await setNightTick(a, '7b0c2f4e-1111-4c2b-9d3a-000000000001', { itemId: 'nasal_strips', type: 'remedy', value: null }, true);
    await setNightTick(a, '7b0c2f4e-1111-4c2b-9d3a-000000000001', { itemId: 'alcohol', type: 'factor', value: '3-4' }, true);
    await saveProfile(a, { ...EMPTY_PROFILE, age_band: '40-49', bmi_band: '25-30', position: 'back' });
    const first = await syncNow(a, api, 'device-a');
    expect(first).toMatchObject({ pushed: 1, rejected: [], profile: 'pushed' });

    // Phone B (same account) pulls it.
    const b = await phone();
    const pulled = await syncNow(b, api, 'device-b');
    expect(pulled.pulled).toBe(1);
    expect(pulled.profile).toBe('pulled');
    const remote = await getNight(b, '7b0c2f4e-1111-4c2b-9d3a-000000000001');
    expect(remote).toMatchObject({ source: 'remote', score: analysis.score, time_in_bed_s: 8 * 3600 });
    expect((await getProfile(b)).profile.position).toBe('back');

    // An edit on A in the same second still reaches B.
    await setTypical(a, '7b0c2f4e-1111-4c2b-9d3a-000000000001', false);
    expect((await syncNow(a, api, 'device-a')).pushed).toBe(1);
    await syncNow(b, api, 'device-b');
    expect((await getNight(b, '7b0c2f4e-1111-4c2b-9d3a-000000000001'))?.typical).toBe(0);

    // Contribution and the community snapshot (free tier: segment all only).
    expect(await api.setContribution(true)).toMatchObject({ opted_in: true });
    expect((await api.contributionSummary()).nights).toBe(1);
    const snap = await loadAggregates(a, api, 'all', 'all', { force: true });
    expect(snap?.data.segment).toBe('all');
    await expect(api.aggregates('age:40-49|bmi:25-30|position:back', 'all', null)).rejects.toMatchObject({ status: 402, code: 'paywall' });
    const detail = await api.remedyDetail('nasal_strips');
    expect(detail).toMatchObject({ remedy_id: 'nasal_strips', by_segment_locked: true, amazon: { search: 'nasal strips' } });

    // Account deletion through the client, then the old session no longer works.
    await api.deleteAccount();
    await expect(api.subscription()).rejects.toMatchObject({ status: 401 });
  });
});
