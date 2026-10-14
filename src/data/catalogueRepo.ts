import { bundledCatalogue, type CatalogueItem } from '../domain/catalogue';
import type { Db } from './db';

interface CatalogueRow {
  id: string;
  type: string;
  kind: string;
  category: string;
  name: string;
  article_md: string;
  link_url: string | null;
  shop: number;
  value_options: string | null;
  active: number;
  version: number;
}

const fromRow = (r: CatalogueRow): CatalogueItem => ({
  id: r.id,
  type: r.type as CatalogueItem['type'],
  kind: r.kind as CatalogueItem['kind'],
  category: r.category,
  name: r.name,
  article_md: r.article_md,
  link_url: r.link_url,
  shop: r.shop === 1,
  value_options: r.value_options ? (JSON.parse(r.value_options) as string[]) : undefined,
  active: r.active === 1,
  version: r.version,
});

export async function upsertCatalogue(db: Db, items: CatalogueItem[]): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const it of items) {
      await db.runAsync(
        `INSERT INTO catalogue (id, type, kind, category, name, article_md, link_url, shop, value_options, active, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type, kind = excluded.kind, category = excluded.category, name = excluded.name,
           article_md = excluded.article_md, link_url = excluded.link_url, shop = excluded.shop,
           value_options = excluded.value_options, active = excluded.active, version = excluded.version
         WHERE excluded.version >= catalogue.version`,
        [
          it.id,
          it.type,
          it.kind,
          it.category,
          it.name,
          it.article_md,
          it.link_url,
          it.shop ? 1 : 0,
          it.value_options ? JSON.stringify(it.value_options) : null,
          it.active ? 1 : 0,
          it.version,
        ],
      );
    }
  });
}

/** Seeds the bundled catalogue on first launch so Tonight works offline with no account. */
export async function seedCatalogueIfEmpty(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM catalogue', []);
  if ((row?.n ?? 0) === 0) await upsertCatalogue(db, bundledCatalogue);
}

export async function catalogueVersion(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ v: number | null }>('SELECT MAX(version) AS v FROM catalogue', []);
  return row?.v ?? 0;
}

export async function listActiveCatalogue(db: Db): Promise<CatalogueItem[]> {
  const rows = await db.getAllAsync<CatalogueRow>(
    'SELECT * FROM catalogue WHERE active = 1 ORDER BY type, category, name',
    [],
  );
  return rows.map(fromRow);
}
