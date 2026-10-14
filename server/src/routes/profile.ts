import { Hono } from 'hono';

import type { ContributionResponse, ContributionSummary, ProfileGetResponse, ProfileResponse } from '../../../shared/api.ts';
import { EMPTY_PROFILE } from '../../../shared/profile.ts';
import { randomId } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { HttpError } from '../errors.ts';
import { contributionBody, profileBody, readBody } from '../validation.ts';
import { iso } from './util.ts';

const BAND_COLUMNS = [
  'age_band',
  'sex',
  'height_band',
  'weight_band',
  'bmi_band',
  'position',
  'pauses_reported',
  'apnoea_dx',
  'cpap',
] as const;

export function profileRoutes(deps: Deps) {
  const { sql, clock } = deps;
  const r = new Hono<AppEnv>();

  r.get('/profile', async (c) => {
    const [row] = await sql.query<ProfileGetResponse>(
      `SELECT version, ${BAND_COLUMNS.join(', ')} FROM profile WHERE user_id = $1`,
      [c.get('userId')],
    );
    const res: ProfileGetResponse = row ?? { ...EMPTY_PROFILE, version: 0 };
    return c.json(res);
  });

  /**
   * Last write wins, but only for a version at least as new as the stored one; an older
   * version (a stale phone) gets 409 and should pull the profile first.
   */
  r.put('/profile', async (c) => {
    const userId = c.get('userId');
    const body = await readBody(c, profileBody);
    const values = BAND_COLUMNS.map((k) => body[k]);
    const placeholders = BAND_COLUMNS.map((_, i) => `$${i + 3}`).join(', ');
    const updates = BAND_COLUMNS.map((k) => `${k} = EXCLUDED.${k}`).join(', ');
    const written = await sql.query<{ version: number }>(
      `INSERT INTO profile (user_id, version, ${BAND_COLUMNS.join(', ')}, updated_at)
       VALUES ($1, $2, ${placeholders}, $12::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET version = EXCLUDED.version, ${updates}, updated_at = EXCLUDED.updated_at
       WHERE EXCLUDED.version >= profile.version
       RETURNING version`,
      [userId, body.version, ...values, clock.now().toISOString()],
    );
    if (written.length === 0) {
      throw new HttpError(409, 'version_conflict', 'The profile on the server is newer. Fetch it and try again.');
    }
    const res: ProfileResponse = { version: written[0].version };
    return c.json(res);
  });

  /**
   * Opting in creates a new random contributor id unless one is active. Opting out withdraws
   * it and puts it on the exclusion list, so the next nightly run drops that person's data.
   */
  r.put('/contribution', async (c) => {
    const userId = c.get('userId');
    const { opted_in } = await readBody(c, contributionBody);
    const now = clock.now().toISOString();
    await sql.transaction(async (tx) => {
      if (opted_in) {
        await tx.query(
          `INSERT INTO contribution (contributor_id, user_id, opted_in_at) VALUES ($1, $2, $3::timestamptz)
           ON CONFLICT (user_id) WHERE withdrawn_at IS NULL DO NOTHING`,
          [randomId(), userId, now],
        );
      } else {
        const withdrawn = await tx.query<{ contributor_id: string }>(
          `UPDATE contribution SET withdrawn_at = $2::timestamptz WHERE user_id = $1 AND withdrawn_at IS NULL
           RETURNING contributor_id::text AS contributor_id`,
          [userId, now],
        );
        for (const w of withdrawn) {
          await tx.query(
            `INSERT INTO contributor_exclusion (contributor_id, reason, excluded_at) VALUES ($1, 'withdrawn', $2::timestamptz)
             ON CONFLICT DO NOTHING`,
            [w.contributor_id, now],
          );
        }
      }
    });
    const active = await activeContribution(deps, userId);
    const res: ContributionResponse = { opted_in: active !== null, contributor_id_exists: active !== null };
    return c.json(res);
  });

  r.get('/contribution/summary', async (c) => {
    const userId = c.get('userId');
    const active = await activeContribution(deps, userId);
    if (!active) {
      const res: ContributionSummary = { opted_in: false, nights: 0, remedies_logged: 0, since: null };
      return c.json(res);
    }
    // Everything synced counts while opted in, including nights from before opting in.
    const [counts] = await sql.query<{ nights: number; remedies: number }>(
      `SELECT (SELECT count(*)::integer FROM night_summary WHERE user_id = $1) AS nights,
              (SELECT count(DISTINCT r.remedy_id)::integer FROM remedy_log r
                 JOIN night_summary n ON n.id = r.night_id WHERE n.user_id = $1) AS remedies`,
      [userId],
    );
    const res: ContributionSummary = {
      opted_in: true,
      nights: counts.nights,
      remedies_logged: counts.remedies,
      since: iso(active.opted_in_at),
    };
    return c.json(res);
  });

  return r;
}

async function activeContribution(deps: Deps, userId: string) {
  const [row] = await deps.sql.query<{ contributor_id: string; opted_in_at: Date }>(
    `SELECT contributor_id::text AS contributor_id, opted_in_at FROM contribution
     WHERE user_id = $1 AND withdrawn_at IS NULL`,
    [userId],
  );
  return row ?? null;
}
