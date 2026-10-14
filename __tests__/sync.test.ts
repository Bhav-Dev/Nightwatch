import type { AggregatesResponse, NightDto, ProfileRequest, SyncNightsRequest } from '../shared/api';
import { EMPTY_PROFILE } from '../shared/profile';
import { ApiClient, ApiFailure } from '../src/api/client';
import { loadAggregates } from '../src/community/aggregates';
import { exportAll } from '../src/data/exportData';
import { setPendingTick, commitPendingLog } from '../src/data/logRepo';
import { deleteNight, getNight, saveNight, setNightTick, setTypical } from '../src/data/nightRepo';
import { getProfile, saveProfile } from '../src/data/profileRepo';
import { migrate } from '../src/data/schema';
import { analyseNight } from '../src/domain/scoring';
import { syncNow } from '../src/sync/sync';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let n = 0;
const newId = () => `id-${++n}`;

async function dbWithNight(day = 14) {
  const db = openTestDb();
  await migrate(db);
  const id = await addNight(db, day);
  return { db, id };
}

async function addNight(db: ReturnType<typeof openTestDb>, day: number) {
  const analysis = analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.25, 15) });
  const startedAt = new Date(2026, 9, day, 23, 0);
  const id = newId();
  await saveNight(db, { id, startedAt, endedAt: new Date(startedAt.getTime() + 8 * 3600_000), partial: false, analysis, newId });
  return id;
}

class FakeServer {
  nights = new Map<string, NightDto>();
  pushes: SyncNightsRequest[] = [];
  deleted: string[] = [];
  profile: ProfileRequest | null = null;
  async pushNights(req: SyncNightsRequest) {
    this.pushes.push(req);
    for (const night of req.nights) this.nights.set(night.id, night);
    return { accepted: req.nights.map((x) => x.id), rejected: [] };
  }
  async pullNights(_since: string | null) {
    return { nights: [...this.nights.values()].filter((x) => x.id.startsWith('remote')), cursor: '2026-10-15T00:00:00Z' };
  }
  async deleteNight(id: string) {
    this.deleted.push(id);
  }
  async putProfile(p: ProfileRequest) {
    this.profile = p;
    return { version: p.version };
  }
  async getProfile() {
    if (!this.profile) throw new ApiFailure(404, 'not_found', 'none');
    return this.profile;
  }
}

describe('sync', () => {
  it('pushes new nights with their logs once, then only after edits', async () => {
    const { db, id } = await dbWithNight();
    await setNightTick(db, id, { itemId: 'mouth_tape', type: 'remedy', value: null }, true);
    const server = new FakeServer();

    const r1 = await syncNow(db, server, 'dev-1');
    expect(r1.pushed).toBe(1);
    expect(server.pushes[0]).toMatchObject({ device_id: 'dev-1' });
    expect(server.nights.get(id)).toMatchObject({ remedies: ['mouth_tape'], time_in_bed_s: 8 * 3600, partial: false });

    expect((await syncNow(db, server, 'dev-1')).pushed).toBe(0);

    // An edit in the same second as the last sync is still picked up.
    await setTypical(db, id, false);
    expect((await syncNow(db, server, 'dev-1')).pushed).toBe(1);
    expect(server.nights.get(id)?.typical).toBe(false);
  });

  it('sends deletions and does not re-pull them', async () => {
    const { db, id } = await dbWithNight();
    const server = new FakeServer();
    await syncNow(db, server, 'd');
    await deleteNight(db, id);
    const r = await syncNow(db, server, 'd');
    expect(r.deleted).toBe(1);
    expect(server.deleted).toEqual([id]);
    expect(await getNight(db, id)).toBeNull();
  });

  it('pulls nights recorded on another device', async () => {
    const db = openTestDb();
    await migrate(db);
    const server = new FakeServer();
    server.nights.set('remote-1', {
      id: 'remote-1', date: '2026-10-10', duration_s: 7 * 3600, time_in_bed_s: 7 * 3600, score: 44, score_version: 1, pct_snoring: 0.2,
      event_count: 12, max_db: 25, partial: false, typical: true, health: null, remedies: ['side_sleeping'], factors: [{ id: 'alcohol', value: '1-2' }],
      updated_at: '2026-10-11T07:00:00Z',
    });
    const r = await syncNow(db, server, 'd');
    expect(r.pulled).toBe(1);
    expect(await getNight(db, 'remote-1')).toMatchObject({ source: 'remote', score: 44, typical: 1 });
    // Pulled nights are not pushed back.
    expect(server.pushes).toHaveLength(0);
    expect((await syncNow(db, server, 'd')).pulled).toBe(0);
  });

  it('pushes the profile when its version moves on, and pulls a newer one', async () => {
    const db = openTestDb();
    await migrate(db);
    const server = new FakeServer();
    await saveProfile(db, { ...EMPTY_PROFILE, age_band: '40-49' });
    expect((await syncNow(db, server, 'd')).profile).toBe('pushed');
    expect(server.profile).toMatchObject({ age_band: '40-49', version: 1 });
    server.profile = { ...EMPTY_PROFILE, age_band: '50-59', version: 5 };
    expect((await syncNow(db, server, 'd')).profile).toBe('pulled');
    expect(await getProfile(db)).toMatchObject({ profile: { age_band: '50-59' }, version: 5 });
  });
});

describe('community snapshot cache', () => {
  const body: AggregatesResponse = {
    segment: 'all', window: 'all', segment_status: 'ok', computed_at: '2026-10-14T04:00:00Z', remedies: [], stacks: [], testing: { people: 212, remedies: 14 },
  };

  it('stores the ETag, sends If-None-Match and serves the cache on 304 or offline', async () => {
    const db = openTestDb();
    await migrate(db);
    const calls: (string | null)[] = [];
    let mode: 'ok' | '304' | 'offline' = 'ok';
    const api = {
      aggregates: async (_s: string, _w: string, etag: string | null) => {
        calls.push(etag);
        if (mode === 'offline') throw new Error('offline');
        if (mode === '304') return { status: 304, body: null, etag };
        return { status: 200, body, etag: '"v1"' };
      },
      remedyDetail: async () => {
        throw new Error('unused');
      },
    };
    expect((await loadAggregates(db, api, 'all', 'all'))?.data.testing.people).toBe(212);
    // Fresh: no request.
    await loadAggregates(db, api, 'all', 'all');
    expect(calls).toEqual([null]);
    mode = '304';
    await loadAggregates(db, api, 'all', 'all', { force: true });
    expect(calls[1]).toBe('"v1"');
    mode = 'offline';
    expect(await loadAggregates(db, api, 'all', 'all', { force: true })).toMatchObject({ stale: true });
  });
});

describe('api client', () => {
  it('adds the session token, maps errors and calls back on 401', async () => {
    let unauthorized = 0;
    const seen: RequestInit[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => {
      seen.push(init!);
      return new Response(JSON.stringify({ error: { code: 'paywall', message: 'Paid feature' } }), { status: 402 });
    };
    const api = new ApiClient('https://api.example.test', () => 'tok', fetchFn, () => unauthorized++);
    await expect(api.aggregates('age:40-49', 'all', null)).rejects.toMatchObject({ status: 402, code: 'paywall' });
    expect((seen[0].headers as Record<string, string>).Authorization).toBe('Bearer tok');

    const api401 = new ApiClient('https://x', () => 'tok', async () => new Response('', { status: 401 }), () => unauthorized++);
    await expect(api401.subscription()).rejects.toBeInstanceOf(ApiFailure);
    expect(unauthorized).toBe(1);
  });

  it('refuses to run without a configured server', async () => {
    await expect(new ApiClient('', () => null).subscription()).rejects.toMatchObject({ code: 'not_configured' });
  });
});

describe('export', () => {
  it('exports nights with logs as JSON and CSV', async () => {
    const { db, id } = await dbWithNight();
    await setPendingTick(db, { itemId: 'alcohol', type: 'factor', value: '3-4' }, true);
    await commitPendingLog(db, id);
    const { json, csv } = await exportAll(db);
    const parsed = JSON.parse(json);
    expect(parsed.nights[0]).toMatchObject({ id, factors: [{ id: 'alcohol', value: '3-4' }] });
    expect(parsed.nights[0].events.length).toBeGreaterThan(0);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toMatch(/^date,started_at/);
    expect(lines[1]).toContain('alcohol=3-4');
  });
});
