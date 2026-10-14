import type { CatalogueResponse } from '../../shared/api';
import type { ApiClient } from '../api/client';
import type { CatalogueItem } from '../domain/catalogue';
import { setCached } from './cacheRepo';
import { catalogueVersion, upsertCatalogue } from './catalogueRepo';
import type { Db } from './db';

export const AMAZON_TAGS_CACHE_KEY = 'amazon_tags';

/**
 * Pulls catalogue rows newer than the cached version (GET /v1/catalogue?since=<version>) and
 * the Amazon tracking ids. Returns the number of rows applied. Failures leave the cached
 * catalogue in place; the app always has at least the bundled copy.
 */
export async function refreshCatalogue(db: Db, api: Pick<ApiClient, 'catalogue'>): Promise<number> {
  const since = await catalogueVersion(db);
  const body: CatalogueResponse = await api.catalogue(since);
  await setCached(db, AMAZON_TAGS_CACHE_KEY, body.amazon_tags ?? {}, null);
  const items: CatalogueItem[] = body.items.map((it) => ({
    id: it.id,
    type: it.type,
    kind: it.kind,
    category: it.category,
    name: it.name,
    article_md: it.article_md,
    link_url: null,
    shop: it.amazon !== null,
    value_options: it.value_options,
    amazon: it.amazon,
    active: it.active,
    version: body.version,
  }));
  if (items.length > 0) await upsertCatalogue(db, items);
  return items.length;
}
