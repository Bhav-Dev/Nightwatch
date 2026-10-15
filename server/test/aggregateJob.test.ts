import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { eligibleNights, withinUserDelta } from '../../shared/remedyEffect.ts';
import { loadContributors, runAggregation, type AggregateRecord } from '../src/jobs/aggregateJob.ts';
import type { Sql } from '../src/db/sql.ts';
import { harness, type Harness } from './helpers.ts';
import { insertSynthetic, synthesise, type SyntheticContributor } from './synthetic.ts';

const TODAY = '2026-10-14';
const EFFECTS = { side_sleeping: -15, nasal_strips: -8, throat_spray: 0, mouth_tape: -4, alcohol: 12, congestion: 6 };

interface ReferenceRow {
  segment: string;
  window: 'all' | '90d';
  remedy_id: string;
  status: string;
  users: number;
  nights: number | null;
  median_delta: number | null;
  p25: number | null;
  p75: number | null;
  median_delta_pct: number | null;
}

/** Runs the Python reference on a JSON export of the synthetic data. */
function reference(people: SyntheticContributor[], remedies: string[]): { rows: ReferenceRow[]; score_version: number } {
  const dir = mkdtempSync(join(tmpdir(), 'nightwatch-ref-'));
  const input = join(dir, 'input.json');
  writeFileSync(
    input,
    JSON.stringify({
      today: TODAY,
      remedies,
      contributors: people.map((p) => ({ id: p.contributorId, profile: p.profile, nights: p.nights })),
    }),
  );
  const script = fileURLToPath(new URL('./reference_aggregate.py', import.meta.url));
  // On Windows, python3 is usually the Microsoft Store stub; the real interpreter is python.
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const out = execFileSync(python, [script, input], { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.toString());
}

const rowsOf = (sql: Sql) =>
  sql.query<AggregateRecord>('SELECT * FROM aggregate ORDER BY segment, time_window, remedy_id');
const k = (r: { segment: string; remedy_id: string }, w: string) => `${r.segment}/${w}/${r.remedy_id}`;

describe('nightly aggregation on 500 synthetic contributors', () => {
  let h: Harness;
  let people: SyntheticContributor[];
  let remedies: string[];
  let firstRun: AggregateRecord[];

  beforeAll(async () => {
    h = await harness();
    h.clock.t = new Date(`${TODAY}T04:00:00Z`);
    people = synthesise({ contributors: 500, seed: 20261014, today: TODAY, effects: EFFECTS });
    await insertSynthetic(h.sql, people, h.clock.now().toISOString());
    remedies = (
      await h.sql.query<{ id: string }>(`SELECT id FROM catalogue WHERE type = 'remedy' AND active ORDER BY id`)
    ).map((r) => r.id);
    const result = await runAggregation(h.sql, h.clock);
    expect(result.message).toBeNull();
    expect(result.ok).toBe(true);
    firstRun = await rowsOf(h.sql);
  });

  it('matches the independent Python reference to 0.1', () => {
    const ref = reference(people, remedies);
    expect(ref.score_version).toBe(2);
    const ours = new Map(firstRun.map((r) => [k(r, r.time_window), r]));
    expect(new Set(ours.keys())).toEqual(new Set(ref.rows.map((r) => k(r, r.window))));
    let compared = 0;
    for (const r of ref.rows) {
      const o = ours.get(k(r, r.window))!;
      expect(o.users, k(r, r.window)).toBe(r.users);
      expect(o.status, k(r, r.window)).toBe(r.status);
      expect(o.nights).toBe(r.nights);
      if (r.median_delta === null) {
        expect(o.median_delta).toBeNull();
        continue;
      }
      expect(Math.abs(o.median_delta! - r.median_delta)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(o.p25! - r.p25!)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(o.p75! - r.p75!)).toBeLessThanOrEqual(0.1);
      expect(Math.abs(o.median_delta_pct! - r.median_delta_pct!)).toBeLessThanOrEqual(0.001);
      compared++;
    }
    // Plenty of published figures, across segments and both windows.
    expect(compared).toBeGreaterThan(100);
  });

  it('recovers the planted effects', () => {
    const all = (id: string) => firstRun.find((r) => r.segment === 'all' && r.time_window === 'all' && r.remedy_id === id)!;
    expect(all('side_sleeping').status).toBe('ok');
    expect(Math.abs(all('side_sleeping').median_delta! + 15)).toBeLessThan(2);
    expect(Math.abs(all('nasal_strips').median_delta! + 8)).toBeLessThan(2);
    expect(Math.abs(all('throat_spray').median_delta!)).toBeLessThan(2);
    // Untested remedies still get an 'all' row, hidden, with only the user count.
    const untested = all('cpap');
    expect(untested).toMatchObject({ status: 'hidden', users: 0, median_delta: null, nights: null });
    expect(all('side_sleeping').distribution!.reduce((s, b) => s + b.count, 0)).toBe(all('side_sleeping').users);
  });

  it('leaves out segments with fewer than 10 contributors', async () => {
    // Five synthetic people chose "other".
    expect(firstRun.some((r) => r.segment === 'sex:other')).toBe(false);
    expect(firstRun.some((r) => r.segment === 'sex:male')).toBe(true);
    expect(firstRun.filter((r) => r.segment !== 'all').every((r) => r.users >= 10)).toBe(true);
    const snaps = await h.sql.query<{ segment: string }>('SELECT segment FROM aggregate_snapshot');
    expect(snaps.some((s) => s.segment === 'sex:other')).toBe(false);
  });

  it('serves the snapshot, with trends and stacks', async () => {
    const { token, userId } = await h.user();
    const res = await h.call('GET', '/v1/aggregates?segment=all&window=all', { token });
    expect(res.status).toBe(200);
    expect(res.body.segment_status).toBe('ok');
    expect(res.body.testing.people).toBeGreaterThan(400);
    expect(res.body.testing.remedies).toBe(5); // four trial remedies plus the background humidifier
    const side = res.body.remedies.find((r: { remedy_id: string }) => r.remedy_id === 'side_sleeping');
    expect(['better', 'worse', 'steady']).toContain(side.trend);
    expect(res.body.stacks.length).toBeGreaterThan(0);
    expect(res.body.stacks.every((s: { users: number }) => s.users >= 30)).toBe(true);
    // No contributor or user ids anywhere in what is published.
    const published = JSON.stringify(await h.sql.query('SELECT * FROM aggregate_snapshot'));
    expect(published).not.toContain(people[0].contributorId);
    expect(published).not.toContain(people[0].userId);
    expect(published).not.toContain(userId);
  });

  it('is re-runnable with identical results', async () => {
    const again = await runAggregation(h.sql, h.clock);
    expect(again.ok).toBe(true);
    expect(await rowsOf(h.sql)).toEqual(firstRun);
  });

  it('drops a withdrawn contributor at the next run', async () => {
    const side = (rows: AggregateRecord[]) =>
      rows.find((r) => r.segment === 'all' && r.time_window === 'all' && r.remedy_id === 'side_sleeping')!;
    // Someone who counts towards side_sleeping.
    const { contributors } = await loadContributors(h.sql);
    const person = people.find((p) => {
      const c = contributors.find((x) => x.contributorId === p.contributorId);
      return c && withinUserDelta(eligibleNights(c.nights), 'side_sleeping') !== null;
    })!;
    const { signSession } = await import('../src/auth/session.ts');
    const { token } = await signSession(person.userId, h.deps.config.sessionSecret, h.clock.now(), 90);

    const before = side(await rowsOf(h.sql)).users;
    const out = await h.call('PUT', '/v1/contribution', { token, body: { opted_in: false } });
    expect(out.body).toEqual({ opted_in: false, contributor_id_exists: false });
    const excluded = await h.sql.query('SELECT * FROM contributor_exclusion WHERE contributor_id = $1', [
      person.contributorId,
    ]);
    expect(excluded).toHaveLength(1);

    await runAggregation(h.sql, h.clock);
    expect(side(await rowsOf(h.sql)).users).toBe(before - 1);

    // Opting back in gives a new contributor id; the old one stays excluded.
    await h.call('PUT', '/v1/contribution', { token, body: { opted_in: true } });
    const [fresh] = await h.sql.query<{ contributor_id: string }>(
      'SELECT contributor_id::text AS contributor_id FROM contribution WHERE user_id = $1 AND withdrawn_at IS NULL',
      [person.userId],
    );
    expect(fresh.contributor_id).not.toBe(person.contributorId);
    await runAggregation(h.sql, h.clock);
    expect(side(await rowsOf(h.sql)).users).toBe(before);
  });

  it('publishes nothing when a sanity check fails', async () => {
    const snapBefore = await h.sql.query('SELECT segment, time_window, etag FROM aggregate_snapshot ORDER BY 1, 2');
    const rowsBefore = await rowsOf(h.sql);
    // Flip alcohol's effect: nights with alcohol now score 24 points lower than they did.
    const flip = (points: number) =>
      h.sql.query(
        `UPDATE night_summary SET score = score + $1 WHERE id IN (SELECT night_id FROM factor_log WHERE factor_id = 'alcohol')`,
        [points],
      );
    await flip(-24);
    h.clock.advance(3600_000);
    try {
      const result = await runAggregation(h.sql, h.clock);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/alcohol median delta .* is not positive/);
      const [log] = await h.sql.query<{ status: string; message: string }>(
        'SELECT status, message FROM aggregate_job_log WHERE id = $1',
        [result.jobId],
      );
      expect(log.status).toBe('failed');
      expect(await h.sql.query('SELECT segment, time_window, etag FROM aggregate_snapshot ORDER BY 1, 2')).toEqual(
        snapBefore,
      );
      expect(await rowsOf(h.sql)).toEqual(rowsBefore);
    } finally {
      await flip(24);
    }
  });

  it('drops a bad date with --exclude-date', async () => {
    const date = '2026-09-20';
    const { contributors } = await loadContributors(h.sql, [date]);
    expect(contributors.some((c) => c.nights.some((n) => n.date === date))).toBe(false);
    const result = await runAggregation(h.sql, h.clock, { excludeDates: [date] });
    expect(result.ok).toBe(true);
    const [log] = await h.sql.query<{ excluded_dates: string[] }>(
      'SELECT excluded_dates FROM aggregate_job_log WHERE id = $1',
      [result.jobId],
    );
    expect(log.excluded_dates).toEqual([date]);
  });
});
