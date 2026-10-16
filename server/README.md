# Nightwatch server

The /v1 API (`shared/api.ts`) and the nightly community aggregation. One codebase runs on either:

- **Supabase** (the chosen host): Edge Functions (Deno) + Postgres, inside an existing project shared with other apps, or
- **a VPS**: Node 22 + Postgres 15 or later.

Switching between them is a configuration change, not a code change.

**Shared database.** All Nightwatch tables live in their own schema, `nightwatch`, owned by a dedicated role, `nightwatch_app`, whose default search_path is that schema (`sql/setup.sql`). Nightwatch never creates, reads or changes anything in `public` or any other app's schema, and every entry point refuses to start on a connection whose tables would resolve anywhere else (`src/db/schema.ts`). See "Deploy to Supabase".

The server does not render PDF reports. The app renders them on the device from its own data.

## Architecture

```
            ┌──────────────── createApp(deps) (Hono) ─────────────────┐
 app ──────▶│ auth · catalogue · sync · profile · contribution        │
            │ aggregates · subscription · account                     │
            └──────┬──────────────────────────────────────────────────┘
                   │ deps: Sql · Clock · Config · Mailer · RateLimiter · JWKS
     ┌─────────────┴──────────────┐
  src/node.ts                supabase/functions/nightwatch-api/index.ts
  @hono/node-server          Deno.serve(app.fetch)

  nightly job: runAggregation(sql, clock)   ← src/jobs/aggregate.ts (cron on a VPS)
                                            ← supabase/functions/nightwatch-aggregate (pg_cron + pg_net)
```

- **No globals.** `createApp(deps)` gets the database, clock, config, mailer, rate limiter and JWKS getters. Tests pass fakes.
- **Database access** goes through `Sql` (`src/db/sql.ts`): `query`, `exec` and `transaction`, with `$1` placeholders. There are two adapters: `postgres` (production, Node and Deno) and PGlite (tests). Pass objects as JSON text cast with `$1::text::jsonb`, because the `postgres` driver JSON-encodes a value bound to a bare `jsonb` parameter. Cast counts to `::integer`.
- **Plain SQL migrations** live in `migrations/NNN_name.sql`. They use standard Postgres with no extensions and unqualified names, and ids are generated in TypeScript. `src/db/migrate.ts` checks the connection resolves to the Nightwatch schema, applies them, and records each one in that schema's `schema_migrations`. The same runner is used on Supabase, not `supabase db push`, so the shared project's migration history is never touched. Row level security is enabled on every table with no policies. That changes nothing on a VPS, and on Supabase it keeps the auto-generated REST API from exposing the tables.
- **Our own auth**, so we don't depend on Supabase Auth:
  - magic links: 32 random bytes, stored as SHA-256, valid for 15 minutes, single use;
  - Apple and Google ID tokens, verified with `jose` against their JWKS;
  - an HS256 session JWT that lasts 90 days.

  Users are keyed by `(auth_provider, auth_subject)`. For email, the subject is the lowercased address. Every route except auth, the RevenueCat webhook and `/v1/health` needs `Authorization: Bearer <session>`.
- **Rate limits** use fixed-window counters in the `rate_limit` table, so they hold on stateless Edge functions:
  - sync: 60 per hour per device (pulls: 60 per hour per user);
  - aggregates: 120 per hour per user;
  - magic links: 5 per hour per email address.
- **The aggregation** uses the shared algorithm in `shared/remedyEffect.ts`. `src/jobs/aggregateJob.ts` loads inputs, groups contributor deltas by segment and window, applies the publication rules and sanity checks, and then fills `aggregate_next` and the snapshots and swaps them in one transaction. The API serves `GET /v1/aggregates` straight from `aggregate_snapshot`, with an ETag.

### Layout

```
migrations/                 NNN_name.sql (source of truth for the schema)
scripts/build.mjs           esbuild bundle of the Node entry points into dist/
sql/setup.sql               one-time: create the nightwatch schema and nightwatch_app role
src/app.ts                  createApp(deps)
src/routes/                 one file per area of the API
src/auth/                   session JWTs, Apple/Google token checks
src/db/                     Sql interface, postgres + PGlite adapters, schema check, migrate, seed
src/scopedEnv.ts            NIGHTWATCH_-prefixed secrets on a shared Supabase project
src/jobs/aggregateJob.ts    nightly job (pure computeAggregates + loading + publishing)
src/jobs/aggregate.ts       CLI for cron
src/jobs/aggregateHttp.ts   the job behind a secret-protected POST (Supabase)
src/node.ts                 VPS entry point
src/env.ts                  production deps from environment variables
test/                       vitest + PGlite; reference_aggregate.py (NumPy)
../supabase/functions/      Deno entry points (nightwatch-api, nightwatch-aggregate) importing ../../../server/src
```

### Decisions taken where the spec was open

- The `user` table is named `app_user`, and `window` columns are named `time_window`, because both are reserved words in Postgres.
- **Sync.** Last write wins on the phone's `updated_at`. The phone stores whole seconds, so a night with an equal `updated_at` but different content (compared by hash) is also applied. An identical re-send changes nothing and does not move the pull cursor. Nights with an older `updated_at` are accepted and ignored. The pull cursor is the server write time at millisecond precision.
- **Profile.** `GET /profile` returns all-null bands at version 0 before the first `PUT`. A `PUT` with the same version as the stored one is accepted (the spec says `>=`).
- **Contribution summary.** It reports zeros while the user is opted out. While opted in, it counts every synced night and the distinct remedies logged.
- **Magic link.** `POST /auth/magic-link` answers 204 for any well-formed address, so the response reveals nothing about which accounts exist. It answers 429 when over the limit.
- **Aggregates.** A missing snapshot (an unknown segment, or one with fewer than 10 contributors) gives `segment_status: 'hidden'`, no rows, and the community-wide `testing` figures, which reveal nothing about the segment. Segment `all` is always `ok` and has a row for every active remedy. Hidden rows carry only `users`.
- **Trend** is set on both window rows of a remedy. Lower scores are better, so "better" means the 90-day median is at least 2 points below the all-time median.
- **RevenueCat.**
  - Each event goes through a table of transitions. `CANCELLATION` and `BILLING_ISSUE` stay active until `expiration_at_ms`.
  - Whether a subscription is active is decided at read time: `active AND expires_at > now`.
  - Events older than the last one applied, and repeated event ids, are ignored.
  - Our user id is also matched among `aliases`, which covers purchases made before sign-in.
  - Unknown users, other entitlements and unhandled event types get a 200 so RevenueCat stops retrying.
- **Suggestions** are keyed by `c:<contributor id>` or `h:<HMAC of user id>`, and are never keyed by the user id. Repeats from one person increase `times`. The view `catalogue_suggestion_counts` counts people per normalised text.
- **Seeding the catalogue.** A row's `version` moves only when its content changes. Ids removed from the file are deactivated rather than deleted.

## Environment variables

On Supabase every variable below is set as a function secret **with a `NIGHTWATCH_` prefix** (`NIGHTWATCH_SESSION_SECRET`, `NIGHTWATCH_DATABASE_URL`...). Function secrets are shared by every app in the project; the functions read only the prefixed ones, so they can never pick up another app's `SESSION_SECRET` or Supabase's built-in `SUPABASE_DB_URL` (which connects as the project owner). On a VPS the names are unprefixed.

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | both | (required) | Postgres connection string, **as the `nightwatch_app` role** |
| `DATABASE_SCHEMA` | both | `nightwatch` | The schema the connection must resolve to (for example `nightwatch_staging` for a second environment in the same project, with its own role) |
| `SESSION_SECRET` | both | (required, at least 32 characters) | HS256 key for session tokens. Changing it signs everyone out |
| `APPLE_AUDIENCES` | both | none | Comma-separated: the iOS bundle id, plus a Services ID for web sign-in. Empty turns off Apple sign-in |
| `GOOGLE_AUDIENCES` | both | none | Comma-separated OAuth client ids (iOS, Android, web). Empty turns off Google sign-in |
| `APP_LINK_BASE` | both | `nightwatch:/` | Magic links go to `${APP_LINK_BASE}/auth?token=...` |
| `RESEND_API_KEY`, `MAIL_FROM` | both | none | Without both, sign-in emails are only printed to the log. Never run production like that |
| `AMAZON_TAGS` | both | `{}` | JSON, for example `{"GB":"nightwatch-21","US":"nightwatch-20"}`, served with the catalogue |
| `REVENUECAT_WEBHOOK_AUTH` | both | none (webhook refuses everything) | Must equal the Authorization header set in the RevenueCat dashboard, for example `Bearer <random>` |
| `API_BASE_PATH` | both | empty (Supabase entry: `/nightwatch-api`) | Prefix before `/v1` |
| `AGGREGATE_SECRET` | Supabase | none (function refuses everything) | Value of the `x-aggregate-secret` header the schedule sends |
| `WEATHER_CONTACT` | both | the GitHub repository URL | Sent to MET Norway in the User-Agent of every forecast request; their terms ask for a contact (an email address or website) so they can reach you rather than block you |
| `PORT`, `HOST` | VPS | `8787`, `127.0.0.1` | Listen address. Keep it on localhost behind Caddy |
| `DATABASE_POOL_SIZE` | VPS | `10` | Connections per process |
| `DATABASE_PREPARE` | VPS | `true` | Set to `false` behind a transaction-mode pooler such as PgBouncer |

## Local development

```bash
cd server
npm install
# Any Postgres 15+; for example: docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
sed 's/CHANGE_ME/dev/' sql/setup.sql | psql postgres://postgres:dev@localhost:5432/postgres
export DATABASE_URL=postgres://nightwatch_app:dev@localhost:5432/postgres
export SESSION_SECRET=$(openssl rand -hex 32)
npm run migrate          # apply migrations/
npm run seed             # load ../catalogue/catalogue.json
npm run dev              # http://127.0.0.1:8787/v1/health; magic links print to the console
npm run aggregate        # run the nightly job once (add -- --exclude-date 2026-10-14)
```

Point the app at it with its API base URL (for example `http://<your-lan-ip>:8787`, with `HOST=0.0.0.0`).

## Tests

```bash
cd server
npm run typecheck
npm test                 # needs python3 with numpy for the aggregation reference
```

Tests run against PGlite, a real Postgres compiled to WASM, so no database is needed. They cover:

- the migrations, `sql/setup.sql` in a database that already belongs to another app (the role cannot read or create anything in `public`, Supabase's API roles cannot read Nightwatch's schema, the other app's tables are untouched), and refusal to run on a connection resolving to another schema;
- auth: the magic link end to end with the console mailer; Apple and Google with a locally generated RSA JWKS; wrong audience, issuer or key; expiry;
- sync: idempotency, ownership and validation;
- profile versioning;
- contribution opt-in, opt-out and exclusion, and suggestions;
- the paywall (402), ETag 304, the webhook's auth and state transitions, account deletion, and rate limits;
- the nightly job on 500 deterministic synthetic contributors with planted effects.

The job's figures are checked against `test/reference_aggregate.py`, an independent NumPy implementation, to 0.1. The job tests also check that segments under 10 people are absent, that a withdrawal takes effect at the next run, that a failed sanity check publishes nothing, and `--exclude-date`.

CI runs the same steps (`.github/workflows/ci.yml`, job `server`).

## Deploy to a VPS

These steps assume Ubuntu 24.04 with Node 22, Postgres 16 and Caddy.

1. **Database.** Create a database (or use an existing one shared with other apps), then run the setup script once with your password in place of `CHANGE_ME`:
   ```bash
   sudo -u postgres createdb nightwatch
   sudo -u postgres psql -d nightwatch -f sql/setup.sql
   ```
   `DATABASE_URL` is then `postgres://nightwatch_app:<password>@127.0.0.1:5432/nightwatch`.
2. **App** (as a `nightwatch` system user, in `/srv/nightwatch`):
   ```bash
   git clone <repo> /srv/nightwatch && cd /srv/nightwatch/server
   npm ci && npm run build && npm prune --omit=dev
   ```
   Put the variables in `/etc/nightwatch.env` (mode 600). Then run `node dist/migrate.js && node dist/seed.js` with that environment.
3. **systemd**, in `/etc/systemd/system/nightwatch.service`:
   ```ini
   [Unit]
   Description=Nightwatch API
   After=network.target postgresql.service

   [Service]
   User=nightwatch
   WorkingDirectory=/srv/nightwatch/server
   EnvironmentFile=/etc/nightwatch.env
   ExecStart=/usr/bin/node dist/node.js
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
   Then run `systemctl enable --now nightwatch`.
4. **Caddy** handles TLS automatically. In `/etc/caddy/Caddyfile`:
   ```
   api.nightwatch.example {
     reverse_proxy 127.0.0.1:8787
   }
   ```
5. **Nightly job at 04:00 UTC.** Use either a systemd timer or cron.

   With a systemd timer, `nightwatch-aggregate.service` (`Type=oneshot`, same `User`, `WorkingDirectory` and `EnvironmentFile`, `ExecStart=/usr/bin/node dist/aggregate.js`) pairs with this `nightwatch-aggregate.timer`:
   ```ini
   [Timer]
   OnCalendar=*-*-* 04:00:00 UTC
   Persistent=true
   [Install]
   WantedBy=timers.target
   ```
   With cron, add this to the `nightwatch` user's crontab (set `CRON_TZ=UTC` if the host is not on UTC):
   ```
   0 4 * * * cd /srv/nightwatch/server && set -a && . /etc/nightwatch.env && node dist/aggregate.js >> /var/log/nightwatch-aggregate.log 2>&1
   ```
   A non-zero exit means nothing was published. Alert on it, then read `aggregate_job_log`. To drop a bad day of data, run `node dist/aggregate.js --exclude-date 2026-10-14`.
6. **Backups.** Run a nightly `pg_dump -Fc --schema=nightwatch nightwatch > /var/backups/nightwatch-$(date +%F).dump` from cron, and copy the dump off the machine (for example with restic or rclone to object storage). Keep 30 days and test a restore regularly. The aggregate tables can be rebuilt by rerunning the job. The user tables cannot.
7. **Updates.**
   ```bash
   git pull && npm ci && npm run build && npm prune --omit=dev && node dist/migrate.js && systemctl restart nightwatch
   ```

## Deploy to Supabase (an existing project shared with other apps)

Nightwatch adds one schema, one role, two functions, a handful of prefixed secrets and one cron job to the project. It does not use `supabase db push`, Supabase Auth, the REST API or storage, so it cannot disturb the other apps' migrations, users or data.

1. **Schema and role (once).** Open the SQL editor, paste `server/sql/setup.sql`, replace `CHANGE_ME` with a long random password (`openssl rand -hex 32`; base64 characters would need escaping in the connection string), and run it. It creates schema `nightwatch` and role `nightwatch_app` (owner of the schema, search_path set to it, no access to `public`). Leave `nightwatch` **out** of the project's exposed schemas (Settings → API), so the auto-generated REST API never serves it.
2. **Connection strings.** From the dashboard's Connect dialog, take the pooler connection strings and swap in the role: the user name on Supabase's pooler is `nightwatch_app.<project-ref>`.
   - Transaction pooler (port 6543), for the functions: `postgres://nightwatch_app.<ref>:<password>@<pooler-host>:6543/postgres?sslmode=require`
   - Session pooler (port 5432), for migrations and seeding from a laptop or CI: the same with port 5432.

   Keep `?sslmode=require` on both; without it the driver connects unencrypted.
3. **Migrations and catalogue,** from `server/` (repeat the migrate step after pulling new migrations):
   ```bash
   export DATABASE_URL='<session pooler URL as nightwatch_app>'
   npm run migrate
   npm run seed
   ```
   Both refuse to run if the connection would resolve tables anywhere but `nightwatch` (for example if you paste the owner's connection string by mistake).
4. **Secrets,** all prefixed with `NIGHTWATCH_` because function secrets are project-wide:
   ```bash
   npx supabase@latest secrets set --project-ref <ref> \
     NIGHTWATCH_DATABASE_URL='<transaction pooler URL as nightwatch_app>' \
     NIGHTWATCH_SESSION_SECRET=$(openssl rand -hex 32) \
     NIGHTWATCH_APPLE_AUDIENCES=... NIGHTWATCH_GOOGLE_AUDIENCES=... \
     NIGHTWATCH_RESEND_API_KEY=... NIGHTWATCH_MAIL_FROM='Nightwatch <hello@...>' \
     NIGHTWATCH_AMAZON_TAGS='{"GB":"..."}' NIGHTWATCH_REVENUECAT_WEBHOOK_AUTH='Bearer ...' \
     NIGHTWATCH_AGGREGATE_SECRET=$(openssl rand -hex 32)
   ```
   Keep a copy of the aggregate secret for step 6.
5. **Functions,** from the repo root (`supabase/config.toml` turns off Supabase JWT checks for both, because the app sends our own session token; no `supabase link` is needed):
   ```bash
   npx supabase@latest functions deploy nightwatch-api --project-ref <ref> --use-api
   npx supabase@latest functions deploy nightwatch-aggregate --project-ref <ref> --use-api
   ```
   `--use-api` bundles on Supabase's side, so Docker is not needed. Always name the functions, and never pass `--prune`: in a shared project it deletes the other apps' functions. The CLI needs a personal access token (`npx supabase@latest login`, or `SUPABASE_ACCESS_TOKEN`); a project-scoped token with Edge Functions and Edge Function Secrets set to read-write is enough. The names are prefixed so they cannot collide with the other apps' functions. The app's API base URL (`EXPO_PUBLIC_API_URL`) is `https://<ref>.supabase.co/functions/v1/nightwatch-api`, and the RevenueCat webhook URL is `https://<ref>.supabase.co/functions/v1/nightwatch-api/v1/subscription/webhook`.
6. **Schedule.** In the SQL editor, enable the `pg_cron` and `pg_net` extensions if the project doesn't have them yet (they are project-wide and other apps may already use them; Nightwatch's schema does not depend on them), then store the secret and add the job:
   ```sql
   create extension if not exists pg_cron with schema pg_catalog;
   grant usage on schema cron to postgres;
   grant all privileges on all tables in schema cron to postgres;
   create extension if not exists pg_net with schema extensions;

   select vault.create_secret('<NIGHTWATCH_AGGREGATE_SECRET>', 'nightwatch_aggregate_secret');
   select cron.schedule('nightwatch-aggregate', '0 4 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/nightwatch-aggregate',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-aggregate-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nightwatch_aggregate_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 300000);
   $$);
   ```
   The job and secret names are prefixed for the same reason. To drop a bad day, call the function by hand with `{"exclude_dates": ["2026-10-14"]}`. Results land in `nightwatch.aggregate_job_log`, and `net._http_response` shows the HTTP status.

**Backups.** Supabase's backups (and point-in-time recovery, if the project has it) cover the whole database, Nightwatch included. For a Nightwatch-only copy, `pg_dump -Fc --schema=nightwatch` over the session pooler.

**Who can see the data.** The `nightwatch_app` role cannot read other apps' tables, and the REST API cannot read Nightwatch's. But anyone who can sign in to the dashboard, or any backend that connects as the project owner (`postgres`), can read the `nightwatch` schema. Nightwatch stores special-category health data (nightly summaries); if other people work on the shared project, decide whether that access is acceptable, or keep Nightwatch in its own project. Moving later is a schema dump and restore (below).

**Deno.** The entry points (`supabase/functions/*/index.ts`) are type-checked under Node only, since CI has no Deno. Both were first deployed on 15 October 2026 and start: the CLI uploads the `server/src` and `shared/` files they import from outside `supabase/functions`, and each function's `deno.json` import map resolves the shared modules' extensionless imports (`./stats`). If a later change breaks that, bundle `server/src` with esbuild into the function folder as a fallback. `supabase functions serve` (local) has not been tried; it needs Docker.

Edge functions have a wall-clock limit (about 150 s on the free plan, 400 s on paid plans). The job took under a second for 500 synthetic contributors on Postgres 16. Watch `aggregate_job_log` timings as the community grows. Past a few tens of thousands of contributors, run the CLI from a small VM or a GitHub Actions schedule against the same database instead.

## Switching later

Everything that matters is in the `nightwatch` schema, which is identical on both hosts.

- **Supabase to a VPS, or to a separate Supabase project:**
  1. Run `sql/setup.sql` on the target database.
  2. `pg_dump -Fc --schema=nightwatch --no-owner` from the source (session pooler, as `nightwatch_app`), and `pg_restore --no-owner --role=nightwatch_app` into the target.
  3. Run `npm run migrate`. It finds `nightwatch.schema_migrations` already filled and applies only newer migrations.
  4. Keep the same `SESSION_SECRET`, so existing sessions stay valid.
  5. Point the app's API base URL at the new host (an over-the-air update or a remote config value) and keep both running until old builds age out.
  6. Move the RevenueCat webhook URL and the schedule (cron instead of pg_cron).
- **What does not move.** Rate-limit counters and pending magic links can be dropped. The published aggregates can be rebuilt by running the job once.
