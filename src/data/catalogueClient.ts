import type { CatalogueItem } from '../domain/catalogue';
import { catalogueVersion, upsertCatalogue } from './catalogueRepo';
import type { Db } from './db';

/** Item shape from the API contract, plus optional fields the server may add. */
interface CatalogueResponseItem {
  id: string;
  type: CatalogueItem['type'];
  category: string;
  name: string;
  article_md: string;
  link_url: string | null;
  active: boolean;
  kind?: CatalogueItem['kind'];
  shop?: boolean;
  value_options?: string[];
}

interface CatalogueResponse {
  version: number;
  items: CatalogueResponseItem[];
}

/**
 * Pulls catalogue rows newer than the cached version (GET /v1/catalogue?since=<version>).
 * Returns the number of rows applied. Failures leave the cached catalogue in place; the
 * app always has at least the bundled copy.
 */
export async function refreshCatalogue(
  db: Db,
  apiBase: string,
  fetchFn: typeof fetch = fetch,
): Promise<number> {
  const since = await catalogueVersion(db);
  const res = await fetchFn(`${apiBase.replace(/\/$/, '')}/v1/catalogue?since=${since}`);
  if (!res.ok) throw new Error(`catalogue fetch failed: ${res.status}`);
  const body = (await res.json()) as CatalogueResponse;
  const items: CatalogueItem[] = body.items.map((it) => ({
    ...it,
    kind: it.kind ?? (it.type === 'factor' ? 'factor' : it.link_url != null ? 'device' : 'habit'),
    shop: it.shop ?? it.link_url != null,
    version: body.version,
  }));
  if (items.length > 0) await upsertCatalogue(db, items);
  return items.length;
}
