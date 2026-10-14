import type { AggregatesResponse, AggregateWindow, RemedyDetailResponse } from '../../shared/api';
import type { ApiClient } from '../api/client';
import { getCached, setCached } from '../data/cacheRepo';
import type { Db } from '../data/db';

/** The server rebuilds the snapshot nightly; within a day the cached copy is used without asking. */
export const FRESH_FOR_S = 6 * 3600;

type Api = Pick<ApiClient, 'aggregates' | 'remedyDetail'>;

/**
 * The community snapshot for a segment and window, cached with its ETag. Falls back to the
 * cached copy when offline. Returns null if there is neither.
 */
export async function loadAggregates(
  db: Db,
  api: Api,
  segment: string,
  window: AggregateWindow,
  opts: { force?: boolean; now?: number } = {},
): Promise<{ data: AggregatesResponse; stale: boolean } | null> {
  const key = `aggregates:${segment}:${window}`;
  const cached = await getCached<AggregatesResponse>(db, key);
  const now = opts.now ?? Date.now();
  if (cached && !opts.force && now / 1000 - cached.fetchedAt < FRESH_FOR_S) return { data: cached.value, stale: false };
  try {
    const res = await api.aggregates(segment, window, cached?.etag ?? null);
    if (res.status === 304 && cached) {
      await setCached(db, key, cached.value, cached.etag, now);
      return { data: cached.value, stale: false };
    }
    if (res.body) {
      await setCached(db, key, res.body, res.etag, now);
      return { data: res.body, stale: false };
    }
  } catch (e) {
    if (!cached) throw e;
  }
  return cached ? { data: cached.value, stale: true } : null;
}

export async function loadRemedyDetail(db: Db, api: Api, remedyId: string): Promise<RemedyDetailResponse | null> {
  const key = `remedy:${remedyId}`;
  try {
    const d = await api.remedyDetail(remedyId);
    await setCached(db, key, d, null);
    return d;
  } catch (e) {
    const cached = await getCached<RemedyDetailResponse>(db, key);
    if (cached) return cached.value;
    throw e;
  }
}
