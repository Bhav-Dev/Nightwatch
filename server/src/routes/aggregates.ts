import { Hono } from 'hono';

import type { AmazonProduct } from '../../../shared/amazon.ts';
import type { AggregatesResponse, AggregateWindow, RemedyDetailResponse } from '../../../shared/api.ts';
import { isSegmentKey } from '../../../shared/profile.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { badRequest, HttpError, notFound } from '../errors.ts';
import { type AggregateRecord, toRowDto } from '../jobs/aggregateJob.ts';
import { hasActiveSubscription, rateLimit } from './util.ts';

const WINDOWS: AggregateWindow[] = ['all', '90d'];

const paywall = () =>
  new HttpError(402, 'paywall', 'Breakdowns by profile are part of Nightwatch Insight.');

/** True when an If-None-Match header lists this ETag (weak or strong), or is "*". */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(',').some((t) => {
    const v = t.trim();
    return v === '*' || v.replace(/^W\//, '') === etag;
  });
}

export function aggregateRoutes(deps: Deps) {
  const { sql, config } = deps;
  const r = new Hono<AppEnv>();
  const limit = (userId: string) =>
    rateLimit(deps, `agg:${userId}`, config.limits.aggregatesPerHour, 'Too many requests. Try again later.');

  /**
   * Served from the snapshot the nightly job wrote for (segment, window): one row read, no
   * computation. Free accounts see the whole community only.
   */
  r.get('/aggregates', async (c) => {
    const userId = c.get('userId');
    const segment = c.req.query('segment') ?? 'all';
    const window = (c.req.query('window') ?? 'all') as AggregateWindow;
    if (segment.length > 200 || !isSegmentKey(segment)) throw badRequest('segment is not a valid segment key.');
    if (!WINDOWS.includes(window)) throw badRequest('window must be "all" or "90d".');
    await limit(userId);
    if (segment !== 'all' && !(await hasActiveSubscription(deps, userId))) throw paywall();

    const [snap] = await sql.query<{ body: AggregatesResponse; etag: string }>(
      'SELECT body, etag FROM aggregate_snapshot WHERE segment = $1 AND time_window = $2',
      [segment, window],
    );
    if (snap) {
      const headers = { ETag: snap.etag, 'Cache-Control': 'private, max-age=86400' };
      if (matchesEtag(c.req.header('If-None-Match'), snap.etag)) return c.body(null, 304, headers);
      return c.json(snap.body, 200, headers);
    }

    // No snapshot: the segment is unknown or too small (under 10 contributors), or the job has
    // not run yet. "testing" is the community-wide figure, so it reveals nothing about the segment.
    const [all] = await sql.query<{ body: AggregatesResponse }>(
      `SELECT body FROM aggregate_snapshot WHERE segment = 'all' AND time_window = 'all'`,
    );
    const res: AggregatesResponse = {
      segment,
      window,
      segment_status: segment === 'all' ? 'ok' : 'hidden',
      computed_at: all?.body.computed_at ?? null,
      remedies: [],
      stacks: [],
      testing: all?.body.testing ?? { people: 0, remedies: 0 },
    };
    return c.json(res);
  });

  r.get('/aggregates/:remedy_id', async (c) => {
    const userId = c.get('userId');
    const remedyId = c.req.param('remedy_id');
    await limit(userId);
    const [item] = await sql.query<{ article_md: string; amazon: AmazonProduct | null }>(
      `SELECT article_md, amazon FROM catalogue WHERE id = $1 AND type = 'remedy'`,
      [remedyId],
    );
    if (!item) throw notFound('No remedy with that id.');
    const paid = await hasActiveSubscription(deps, userId);
    const rows = await sql.query<AggregateRecord>(
      `SELECT * FROM aggregate WHERE remedy_id = $1 AND time_window = 'all' AND (segment = 'all' OR $2)
       ORDER BY segment`,
      [remedyId, paid],
    );
    const all = rows.find((row) => row.segment === 'all') ?? null;
    const res: RemedyDetailResponse = {
      remedy_id: remedyId,
      all: all ? toRowDto(all) : null,
      distribution: all?.distribution ?? [],
      by_segment: rows.filter((row) => row.segment !== 'all').map((row) => ({ ...toRowDto(row), segment: row.segment })),
      by_segment_locked: !paid,
      article_md: item.article_md,
      amazon: item.amazon,
    };
    return c.json(res);
  });

  return r;
}
