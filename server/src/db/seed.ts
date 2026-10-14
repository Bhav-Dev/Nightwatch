/**
 * Loads catalogue/catalogue.json into the catalogue table: `npm run seed` (DATABASE_URL).
 * Safe to re-run. A row's version only moves when its content changes, so the app's
 * `GET /catalogue?since=` pulls just what changed; ids missing from the file are deactivated,
 * never deleted (ids are never reused).
 */
import { pathToFileURL } from 'node:url';

import catalogueFile from '../../../catalogue/catalogue.json' with { type: 'json' };
import type { AmazonProduct } from '../../../shared/amazon.ts';
import { json, type Sql } from './sql.ts';

export interface CatalogueFileItem {
  id: string;
  type: 'remedy' | 'factor';
  kind: 'device' | 'habit' | 'factor';
  category: string;
  name: string;
  article_md: string;
  shop?: boolean;
  value_options?: string[];
}

export interface CatalogueFile {
  version: number;
  items: CatalogueFileItem[];
}

interface Row {
  id: string;
  type: string;
  kind: string;
  category: string;
  name: string;
  article_md: string;
  amazon: AmazonProduct | null;
  value_options: string[] | null;
  active: boolean;
}

function toRow(item: CatalogueFileItem): Row {
  return {
    id: item.id,
    type: item.type,
    kind: item.kind,
    category: item.category,
    name: item.name,
    article_md: item.article_md,
    // Shop items link to an Amazon search for the name until a product (ASIN) is chosen.
    amazon: item.shop ? { search: item.name.toLowerCase() } : null,
    value_options: item.value_options ?? null,
    active: true,
  };
}

const same = (a: Row, b: Row) => JSON.stringify(a) === JSON.stringify(b);

/** Returns the number of rows inserted or changed. */
export async function seedCatalogue(sql: Sql, file: CatalogueFile = catalogueFile as CatalogueFile): Promise<number> {
  return sql.transaction(async (tx) => {
    const existing = await tx.query<Row & { version: number }>(
      'SELECT id, type, kind, category, name, article_md, amazon, value_options, active, version FROM catalogue',
    );
    const [{ max }] = await tx.query<{ max: number }>('SELECT COALESCE(MAX(version), 0)::integer AS max FROM catalogue');
    // Never go backwards, even if the file's version was not bumped.
    const version = Math.max(file.version, max + 1);
    const current = new Map(existing.map(({ version: _v, ...row }) => [row.id, row as Row]));

    const changed: Row[] = file.items.map(toRow).filter((row) => {
      const old = current.get(row.id);
      return !old || !same(normalise(old), normalise(row));
    });
    const inFile = new Set(file.items.map((i) => i.id));
    for (const old of current.values()) {
      if (!inFile.has(old.id) && old.active) changed.push({ ...old, active: false });
    }
    if (changed.length === 0) return 0;

    await tx.query(
      `INSERT INTO catalogue (id, type, kind, category, name, article_md, link_url, amazon, value_options, active, version)
       SELECT x.id, x.type, x.kind, x.category, x.name, x.article_md, NULL, x.amazon, x.value_options, x.active, $2
       FROM jsonb_to_recordset($1::text::jsonb) AS x(id text, type text, kind text, category text, name text,
         article_md text, amazon jsonb, value_options jsonb, active boolean)
       ON CONFLICT (id) DO UPDATE SET type = EXCLUDED.type, kind = EXCLUDED.kind, category = EXCLUDED.category,
         name = EXCLUDED.name, article_md = EXCLUDED.article_md, amazon = EXCLUDED.amazon,
         value_options = EXCLUDED.value_options, active = EXCLUDED.active, version = EXCLUDED.version`,
      [json(changed), version],
    );
    return changed.length;
  });
}

/** Same key order on both sides (jsonb does not keep it). */
function normalise(r: Row): Row {
  return {
    id: r.id,
    type: r.type,
    kind: r.kind,
    category: r.category,
    name: r.name,
    article_md: r.article_md,
    amazon: r.amazon ? { search: r.amazon.search, ...(r.amazon.asin ? { asin: r.amazon.asin } : {}) } : null,
    value_options: r.value_options,
    active: r.active,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { postgresSql } = await import('./postgres.ts');
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set');
    process.exit(1);
  }
  const sql = postgresSql(url, { max: 1, prepare: process.env.DATABASE_PREPARE !== 'false' });
  try {
    const { assertSchema, schemaFromEnv } = await import('./schema.ts');
    await assertSchema(sql, schemaFromEnv(process.env));
    console.log(`Catalogue rows inserted or changed: ${await seedCatalogue(sql)}`);
  } finally {
    await sql.close();
  }
}
