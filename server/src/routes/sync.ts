import { Hono } from 'hono';
import { z } from 'zod';

import type { NightDto, PullNightsResponse, SyncNightsResponse } from '../../../shared/api.ts';
import { json } from '../db/sql.ts';
import { sha256Hex } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { badRequest } from '../errors.ts';
import { describeIssue, nightSchema, readBody, syncBody, type ValidNight } from '../validation.ts';
import { rateLimit } from './util.ts';

const NIGHT_COLUMNS = `id text, date text, duration_s integer, time_in_bed_s integer, score double precision,
  score_version integer, pct_snoring double precision, event_count integer, max_db double precision,
  partial boolean, typical boolean, has_health boolean, sleep_efficiency double precision,
  spo2_min double precision, spo2_dips integer, hr_mean double precision, hr_max double precision,
  hrv_mean double precision, resp_mean double precision, updated_at timestamptz, content_hash text`;

/** Same night, same hash: logs are sorted so their order on the phone does not matter. */
async function contentHash(n: ValidNight): Promise<string> {
  const remedies = [...new Set(n.remedies)].sort();
  const factors = [...n.factors].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return sha256Hex(JSON.stringify({ ...n, remedies, factors }));
}

function nightRecord(n: ValidNight, content_hash: string) {
  const h = n.health;
  return {
    id: n.id,
    date: n.date,
    duration_s: n.duration_s,
    time_in_bed_s: n.time_in_bed_s,
    score: n.score,
    score_version: n.score_version,
    pct_snoring: n.pct_snoring,
    event_count: n.event_count,
    max_db: n.max_db,
    partial: n.partial,
    typical: n.typical,
    has_health: h !== null,
    sleep_efficiency: h?.sleep_efficiency ?? null,
    spo2_min: h?.spo2_min ?? null,
    spo2_dips: h?.spo2_dips ?? null,
    hr_mean: h?.hr_mean ?? null,
    hr_max: h?.hr_max ?? null,
    hrv_mean: h?.hrv_mean ?? null,
    resp_mean: h?.resp_mean ?? null,
    updated_at: n.updated_at,
    content_hash,
  };
}

interface NightRow extends ReturnType<typeof nightRecord> {
  updated_at: string;
  remedies: string[];
  factors: { id: string; value: string | null }[];
}

function toDto(r: NightRow): NightDto {
  return {
    id: r.id,
    date: r.date,
    duration_s: r.duration_s,
    time_in_bed_s: r.time_in_bed_s,
    score: r.score,
    score_version: r.score_version,
    pct_snoring: r.pct_snoring,
    event_count: r.event_count,
    max_db: r.max_db,
    partial: r.partial,
    typical: r.typical,
    health: r.has_health
      ? {
          sleep_efficiency: r.sleep_efficiency,
          spo2_min: r.spo2_min,
          spo2_dips: r.spo2_dips,
          hr_mean: r.hr_mean,
          hr_max: r.hr_max,
          hrv_mean: r.hrv_mean,
          resp_mean: r.resp_mean,
        }
      : null,
    remedies: r.remedies,
    factors: r.factors,
    updated_at: r.updated_at,
  };
}

const isoSince = z.iso.datetime({ offset: true });

export function syncRoutes(deps: Deps) {
  const { sql, config } = deps;
  const r = new Hono<AppEnv>();

  /**
   * Upserts nights by id, scoped to the caller. Last write wins on the client's updated_at,
   * so re-sending the same batch changes nothing (idempotent). Remedy and factor logs are
   * replaced whenever a night is written.
   */
  r.post('/sync/nights', async (c) => {
    const userId = c.get('userId');
    const body = await readBody(c, syncBody);
    await rateLimit(deps, `sync:${userId}:${body.device_id}`, config.limits.syncPerHour, 'Too many syncs. Try again later.');

    const rejected: SyncNightsResponse['rejected'] = [];
    const valid: ValidNight[] = [];
    const seen = new Set<string>();
    for (const raw of body.nights) {
      const id = typeof (raw as { id?: unknown })?.id === 'string' ? (raw as { id: string }).id : '';
      const parsed = nightSchema.safeParse(raw);
      if (!parsed.success) rejected.push({ id, reason: describeIssue(parsed.error) });
      else if (seen.has(parsed.data.id)) rejected.push({ id, reason: 'duplicate id in this batch' });
      else {
        seen.add(parsed.data.id);
        valid.push(parsed.data);
      }
    }

    const accepted = await sql.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO device (user_id, device_id, first_seen_at, last_sync_at) VALUES ($1, $2, now(), now())
         ON CONFLICT (user_id, device_id) DO UPDATE SET last_sync_at = now()`,
        [userId, body.device_id],
      );
      if (valid.length === 0) return [];

      const owners = await tx.query<{ id: string; user_id: string }>(
        `SELECT id, user_id::text AS user_id FROM night_summary
         WHERE id IN (SELECT jsonb_array_elements_text($1::text::jsonb))`,
        [json(valid.map((n) => n.id))],
      );
      const foreign = new Set(owners.filter((o) => o.user_id !== userId).map((o) => o.id));
      const mine = valid.filter((n) => {
        if (!foreign.has(n.id)) return true;
        rejected.push({ id: n.id, reason: 'night belongs to another account' });
        return false;
      });
      if (mine.length === 0) return [];

      // The WHERE on DO UPDATE also guards ownership against a concurrent insert by someone else.
      // server_updated_at is truncated to milliseconds so the cursor survives a JS Date round trip.
      const written = await tx.query<{ id: string }>(
        `INSERT INTO night_summary (id, user_id, device_id, date, duration_s, time_in_bed_s, score, score_version,
           pct_snoring, event_count, max_db, partial, typical, has_health, sleep_efficiency, spo2_min, spo2_dips,
           hr_mean, hr_max, hrv_mean, resp_mean, updated_at, content_hash, server_updated_at)
         SELECT x.id, $1::uuid, $2, x.date, x.duration_s, x.time_in_bed_s, x.score, x.score_version,
           x.pct_snoring, x.event_count, x.max_db, x.partial, x.typical, x.has_health, x.sleep_efficiency,
           x.spo2_min, x.spo2_dips, x.hr_mean, x.hr_max, x.hrv_mean, x.resp_mean, x.updated_at, x.content_hash,
           date_trunc('milliseconds', now())
         FROM jsonb_to_recordset($3::text::jsonb) AS x(${NIGHT_COLUMNS})
         ON CONFLICT (id) DO UPDATE SET
           device_id = EXCLUDED.device_id, date = EXCLUDED.date, duration_s = EXCLUDED.duration_s,
           time_in_bed_s = EXCLUDED.time_in_bed_s, score = EXCLUDED.score, score_version = EXCLUDED.score_version,
           pct_snoring = EXCLUDED.pct_snoring, event_count = EXCLUDED.event_count, max_db = EXCLUDED.max_db,
           partial = EXCLUDED.partial, typical = EXCLUDED.typical, has_health = EXCLUDED.has_health,
           sleep_efficiency = EXCLUDED.sleep_efficiency, spo2_min = EXCLUDED.spo2_min,
           spo2_dips = EXCLUDED.spo2_dips, hr_mean = EXCLUDED.hr_mean, hr_max = EXCLUDED.hr_max,
           hrv_mean = EXCLUDED.hrv_mean, resp_mean = EXCLUDED.resp_mean, updated_at = EXCLUDED.updated_at,
           content_hash = EXCLUDED.content_hash, server_updated_at = EXCLUDED.server_updated_at
         WHERE night_summary.user_id = EXCLUDED.user_id
           AND (EXCLUDED.updated_at > night_summary.updated_at
             OR (EXCLUDED.updated_at = night_summary.updated_at AND EXCLUDED.content_hash <> night_summary.content_hash))
         RETURNING id`,
        [userId, body.device_id, json(await Promise.all(mine.map(async (n) => nightRecord(n, await contentHash(n)))))],
      );

      const writtenIds = new Set(written.map((w) => w.id));
      const fresh = mine.filter((n) => writtenIds.has(n.id));
      if (fresh.length > 0) {
        const ids = json(fresh.map((n) => n.id));
        await tx.query('DELETE FROM remedy_log WHERE night_id IN (SELECT jsonb_array_elements_text($1::text::jsonb))', [ids]);
        await tx.query('DELETE FROM factor_log WHERE night_id IN (SELECT jsonb_array_elements_text($1::text::jsonb))', [ids]);
        const remedies = fresh.flatMap((n) => [...new Set(n.remedies)].map((remedy_id) => ({ night_id: n.id, remedy_id })));
        const factors = fresh.flatMap((n) => {
          const byId = new Map(n.factors.map((f) => [f.id, f.value]));
          return [...byId].map(([factor_id, value]) => ({ night_id: n.id, factor_id, value }));
        });
        if (remedies.length > 0) {
          await tx.query(
            `INSERT INTO remedy_log (night_id, remedy_id)
             SELECT night_id, remedy_id FROM jsonb_to_recordset($1::text::jsonb) AS x(night_id text, remedy_id text)`,
            [json(remedies)],
          );
        }
        if (factors.length > 0) {
          await tx.query(
            `INSERT INTO factor_log (night_id, factor_id, value)
             SELECT night_id, factor_id, value FROM jsonb_to_recordset($1::text::jsonb) AS x(night_id text, factor_id text, value text)`,
            [json(factors)],
          );
        }
      }
      // Nights not written were older than, or identical to, the stored copy: accepted, nothing to do.
      return mine.map((n) => n.id);
    });

    const res: SyncNightsResponse = { accepted, rejected };
    return c.json(res);
  });

  /** Nights written on the server after `since` (any device), for restoring or a second phone. */
  r.get('/sync/nights', async (c) => {
    const userId = c.get('userId');
    const sinceRaw = c.req.query('since');
    if (sinceRaw !== undefined && !isoSince.safeParse(sinceRaw).success) {
      throw badRequest('since must be an ISO 8601 timestamp (the cursor from the last pull).');
    }
    const since = sinceRaw ?? '1970-01-01T00:00:00Z';
    await rateLimit(deps, `sync-pull:${userId}`, config.limits.syncPerHour, 'Too many syncs. Try again later.');
    const rows = await sql.query<Omit<NightRow, 'updated_at'> & { updated_at: Date; server_updated_at: Date }>(
      `SELECT n.*,
         COALESCE((SELECT json_agg(r.remedy_id ORDER BY r.remedy_id) FROM remedy_log r WHERE r.night_id = n.id), '[]'::json) AS remedies,
         COALESCE((SELECT json_agg(json_build_object('id', f.factor_id, 'value', f.value) ORDER BY f.factor_id)
                   FROM factor_log f WHERE f.night_id = n.id), '[]'::json) AS factors
       FROM night_summary n
       WHERE n.user_id = $1 AND n.server_updated_at > $2::timestamptz
       ORDER BY n.server_updated_at, n.id`,
      [userId, since],
    );
    const nights = rows.map((row) => toDto({ ...row, updated_at: row.updated_at.toISOString() }));
    const last = rows.at(-1)?.server_updated_at;
    const res: PullNightsResponse = { nights, cursor: last ? last.toISOString() : new Date(since).toISOString() };
    return c.json(res);
  });

  r.delete('/sync/nights/:id', async (c) => {
    // Idempotent: deleting a night that is already gone (or never synced) is still a 204.
    await sql.query('DELETE FROM night_summary WHERE id = $1 AND user_id = $2', [c.req.param('id'), c.get('userId')]);
    return c.body(null, 204);
  });

  return r;
}
