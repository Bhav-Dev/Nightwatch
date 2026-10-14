// Copies server/migrations/NNN_name.sql to supabase/migrations/<timestamp>_name.sql, the
// naming the Supabase CLI expects. The timestamp is a fixed prefix plus NNN
// (20260101000001 for 001), so re-running produces the same files. Each copy also records
// itself in schema_migrations, so server/src/db/migrate.ts sees it as applied if the project
// later moves to a VPS. Run after adding a migration: `npm run supabase:sync-migrations`.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'migrations');
const dest = join(here, '..', '..', 'supabase', 'migrations');
const PREFIX = '2026010100'; // + 4-digit migration number = 14-digit Supabase timestamp

mkdirSync(dest, { recursive: true });
const wanted = new Set();
for (const file of readdirSync(src).sort()) {
  const m = /^(\d{3})_([a-z0-9_]+)\.sql$/.exec(file);
  if (!m) continue;
  const [, num, name] = m;
  const out = `${PREFIX}${num.padStart(4, '0')}_${name}.sql`;
  wanted.add(out);
  const body = readFileSync(join(src, file), 'utf8');
  writeFileSync(
    join(dest, out),
    `-- Generated from server/migrations/${file} by \`npm run supabase:sync-migrations\`. Do not edit.\n\n` +
      body.trimEnd() +
      `\n\n-- Keep the server's own migration record in step, for moving to a VPS later.\n` +
      `INSERT INTO schema_migrations (version, name) VALUES (${Number(num)}, '${name}') ON CONFLICT DO NOTHING;\n`,
  );
  console.log(`${file} -> supabase/migrations/${out}`);
}
// Remove copies of migrations that no longer exist (only files this script generates).
for (const file of existsSync(dest) ? readdirSync(dest) : []) {
  if (file.startsWith(PREFIX) && !wanted.has(file)) {
    rmSync(join(dest, file));
    console.log(`removed stale supabase/migrations/${file}`);
  }
}
