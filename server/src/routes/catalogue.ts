import { Hono } from 'hono';

import type { AmazonProduct } from '../../../shared/amazon.ts';
import type { CatalogueItemDto, CatalogueResponse } from '../../../shared/api.ts';
import { hmacHex } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { badRequest } from '../errors.ts';
import { readBody, suggestBody } from '../validation.ts';

interface CatalogueRow {
  id: string;
  type: 'remedy' | 'factor';
  kind: 'device' | 'habit' | 'factor';
  category: string;
  name: string;
  article_md: string;
  amazon: AmazonProduct | null;
  value_options: string[] | null;
  active: boolean;
}

export function toDto(row: CatalogueRow): CatalogueItemDto {
  const dto: CatalogueItemDto = {
    id: row.id,
    type: row.type,
    kind: row.kind,
    category: row.category,
    name: row.name,
    article_md: row.article_md,
    link_url: null,
    amazon: row.amazon,
    active: row.active,
  };
  if (row.value_options) dto.value_options = row.value_options;
  return dto;
}

/** Case- and space-insensitive key, so "Mouth Guard" and "mouth  guard" count as one. */
export const suggestionKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

export function catalogueRoutes(deps: Deps) {
  const { sql, config, clock } = deps;
  const r = new Hono<AppEnv>();

  r.get('/catalogue', async (c) => {
    const sinceRaw = c.req.query('since') ?? '0';
    if (!/^\d+$/.test(sinceRaw)) throw badRequest('since must be a catalogue version number.');
    const since = Number(sinceRaw);
    const [{ version }] = await sql.query<{ version: number }>(
      'SELECT COALESCE(MAX(version), 0)::integer AS version FROM catalogue',
    );
    const rows = await sql.query<CatalogueRow>(
      `SELECT id, type, kind, category, name, article_md, amazon, value_options, active
       FROM catalogue WHERE version > $1 ORDER BY id`,
      [since],
    );
    const res: CatalogueResponse = { version, items: rows.map(toDto), amazon_tags: config.amazonTags };
    return c.json(res);
  });

  r.post('/catalogue/suggest', async (c) => {
    const { text } = await readBody(c, suggestBody);
    const userId = c.get('userId');
    // Contributors are known to the team only by contributor id; everyone else by a keyed
    // hash, so a suggestion can never be traced back to an account.
    const [contrib] = await sql.query<{ contributor_id: string }>(
      'SELECT contributor_id::text AS contributor_id FROM contribution WHERE user_id = $1 AND withdrawn_at IS NULL',
      [userId],
    );
    const submitter = contrib ? `c:${contrib.contributor_id}` : `h:${await hmacHex(config.sessionSecret, `suggest:${userId}`)}`;
    const now = clock.now().toISOString();
    await sql.query(
      `INSERT INTO catalogue_suggestion (text_key, submitter_key, text, times, first_at, last_at)
       VALUES ($1, $2, $3, 1, $4::timestamptz, $4::timestamptz)
       ON CONFLICT (text_key, submitter_key) DO UPDATE SET
         times = catalogue_suggestion.times + 1, last_at = EXCLUDED.last_at`,
      [suggestionKey(text), submitter, text.trim(), now],
    );
    return c.body(null, 202);
  });

  return r;
}
