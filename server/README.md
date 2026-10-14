# Nightwatch server

The /v1 API (`shared/api.ts`) and the nightly community aggregation. One codebase runs on either:

- **a VPS**: Node 22 + Postgres 15 or later, or
- **Supabase**: Edge Functions (Deno) + Supabase Postgres.

Switching between them is a configuration change, not a code change.

The server does not render PDF reports. The app renders them on the device from its own data.

## Architecture

```
            ┌──────────────── createApp(deps) (Hono) ─────────────────┐
 app ──────▶│ auth · catalogue · sync · profile · contribution        │
            │ aggregates · subscription · account                     │
            └──────┬──────────────────────────────────────────────────┘
                   │ deps: Sql · Clock · Config · Mailer · RateLimiter · JWKS
     ┌─────────────┴──────────────┐
  src/node.ts                supabase/functions/api/index.ts
  @hono/node-server          Deno.serve(app.fetch)

  nightly job: runAggregation(sql, clock)   ← src/jobs/aggregate.ts (cron on a VPS)
                                            ← supabase/functions/aggregate (pg_cron + pg_net)
```

- **No globals.** `createApp(deps)` gets the database, clock, config, mailer, rate limiter and JWKS getters. Tests pass fakes.
- **Database access** goes through `Sql` (`src/db/sql.ts`): `query`, `exec` and `transaction`, with `$1` placeholders. There are two adapters: `postgres` (production, Node and Deno) and PGlite (tests). Pass objects as JSON text cast with `$1::text::jsonb`, because the `postgres` driver JSON-encodes a value bound to a bare `jsonb` parameter. Cast counts to `::integer`.
- **Plain SQL migrations** live in `migrations/NNN_name.sql`. They use standard Postgres with no extensions, and ids are generated in TypeScript. `src/db/migrate.ts` applies them and records each one in `schema_migrations`. Row level security is enabled on every table with no policies. That changes nothing on a VPS, and on Supabase it keeps the auto-generated REST API from exposing the tables.
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
scripts/sync-supabase-migrations.mjs
src/app.ts                  createApp(deps)
src/routes/                 one file per area of the API
src/auth/                   session JWTs, Apple/Google token checks
src/db/                     Sql interface, postgres + PGlite adapters, migrate, seed
src/jobs/aggregateJob.ts    nightly job (pure computeAggregates + loading + publishing)
src/jobs/aggregate.ts       CLI for cron
src/jobs/aggregateHttp.ts   the job behind a secret-protected POST (Supabase)
src/node.ts                 VPS entry point
src/env.ts                  production deps from environment variables
test/                       vitest + PGlite; reference_aggregate.py (NumPy)
../supabase/functions/      Deno entry points (api, aggregate) importing ../../../server/src
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

| Variable | Where | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | both | (required on a VPS; Supabase falls back to `SUPABASE_DB_URL`) | Postgres connection string |
| `SESSION_SECRET` | both | (required, at least 32 characters) | HS256 key for session tokens. Changing it signs everyone out |
| `APPLE_AUDIENCES` | both | none | Comma-separated: the iOS bundle id, plus a Services ID for web sign-in. Empty turns off Apple sign-in |
| `GOOGLE_AUDIENCES` | both | none | Comma-separated OAuth client ids (iOS, Android, web). Empty turns off Google sign-in |
| `APP_LINK_BASE` | both | `nightwatch:/` | Magic links go to `${APP_LINK_BASE}/auth?token=...` |
| `RESEND_API_KEY`, `MAIL_FROM` | both | none | Without both, sign-in emails are only printed to the log. Never run production like that |
| `AMAZON_TAGS` | both | `{}` | JSON, for example `{"GB":"nightwatch-21","US":"nightwatch-20"}`, served with the catalogue |
| `REVENUECAT_WEBHOOK_AUTH` | both | none (webhook refuses everything) | Must equal the Authorization header set in the RevenueCat dashboard, for example `Bearer <random>` |
| `API_BASE_PATH` | both | empty (Supabase entry: `/api`) | Prefix before `/v1` |
| `AGGREGATE_SECRET` | Supabase | none (function refuses everything) | Value of the `x-aggregate-secret` header the schedule sends |
| `PORT`, `HOST` | VPS | `8787`, `127.0.0.1` | Listen address. Keep it on localhost behind Caddy |
| `DATABASE_POOL_SIZE` | VPS | `10` | Connections per process |
| `DATABASE_PREPARE` | VPS | `true` | Set to `false` behind a transaction-mode pooler such as PgBouncer |

## Local development

```bash
cd server
npm install
# Any Postgres 15+; for example: docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
export DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres
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

- the migrations and the Supabase copies;
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

1. **Database**
   ```bash
   sudo -u postgres createuser nightwatch -P
   sudo -u postgres createdb -O nightwatch nightwatch
   ```
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
6. **Backups.** Run a nightly `pg_dump -Fc nightwatch > /var/backups/nightwatch-$(date +%F).dump` from cron, and copy the dump off the machine (for example with restic or rclone to object storage). Keep 30 days and test a restore regularly. The aggregate tables can be rebuilt by rerunning the job. The user tables cannot.
7. **Updates.**
   ```bash
   git pull && npm ci && npm run build && npm prune --omit=dev && node dist/migrate.js && systemctl restart nightwatch
   ```

## Deploy to Supabase

1. Link the project:
   ```bash
   npx supabase@latest link --project-ref <ref>
   ```
   Run it from the repo root; `supabase/config.toml` is already there. It turns off Supabase JWT checks for both functions, because the app sends our own session token.
2. **Migrations.**
   ```bash
   cd server && npm run supabase:sync-migrations
   cd .. && npx supabase@latest db push
   ```
   The sync script copies `server/migrations/NNN_name.sql` to `supabase/migrations/2026010100NNNN_name.sql`. Each copy ends with an insert into `schema_migrations`, so the server's own runner sees it as applied later. Run the script after adding any migration, and commit the copies.
3. **Catalogue.** From a laptop, run `DATABASE_URL=<Supabase connection string> npm run seed` in `server/`. Use the session pooler or the direct connection. Behind the transaction pooler (port 6543), also set `DATABASE_PREPARE=false`.
4. **Secrets:**
   ```bash
   npx supabase@latest secrets set SESSION_SECRET=... APPLE_AUDIENCES=... GOOGLE_AUDIENCES=... \
     RESEND_API_KEY=... MAIL_FROM='Nightwatch <hello@...>' AMAZON_TAGS='{"GB":"..."}' \
     REVENUECAT_WEBHOOK_AUTH='Bearer ...' AGGREGATE_SECRET=$(openssl rand -hex 32)
   ```
   `SUPABASE_DB_URL` is provided to functions automatically. Set `DATABASE_URL` to the transaction pooler URL if many isolates run at once. The functions already turn off prepared statements.
5. **Functions:**
   ```bash
   npx supabase@latest functions deploy api
   npx supabase@latest functions deploy aggregate
   ```
   The app's API base URL is then `https://<ref>.supabase.co/functions/v1/api`, because `API_BASE_PATH` defaults to `/api` in that entry point. The RevenueCat webhook URL is `.../functions/v1/api/v1/subscription/webhook`.
6. **Schedule.** Enable the `pg_cron` and `pg_net` extensions in the dashboard. They are Supabase-side scheduling only; the schema itself does not use them. Store the secret in Vault, then:
   ```sql
   select vault.create_secret('<AGGREGATE_SECRET>', 'aggregate_secret');
   select cron.schedule('nightwatch-aggregate', '0 4 * * *', $$
     select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/aggregate',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'x-aggregate-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'aggregate_secret')),
       body := '{}'::jsonb,
       timeout_milliseconds := 300000);
   $$);
   ```
   To drop a bad day, call the function by hand with `{"exclude_dates": ["2026-10-14"]}`. Results land in `aggregate_job_log`, and `net._http_response` shows the HTTP status.

**Not verified here.** The Deno entry points (`supabase/functions/*/index.ts`) were type-checked under Node but never run, because Deno was not available where this was written. Two things to confirm on the first deploy:

- The shared modules use extensionless relative imports (`./stats`), which Deno does not resolve by itself. Each function's `deno.json` import map maps them to the `.ts` files.
- The functions import `../../../server/src`, which is outside `supabase/functions`. The Supabase CLI bundles imports from anywhere in the project, but check that `supabase functions serve` picks them up locally.

If either fails, bundle `server/src` with esbuild into the function folder as a fallback.

Edge functions have a wall-clock limit (about 150 s on the free plan, 400 s on paid plans). The job took under a second for 500 synthetic contributors on Postgres 16. Watch `aggregate_job_log` timings as the community grows. Past a few tens of thousands of contributors, run the CLI from a small VM or a GitHub Actions schedule against the same database instead.

## Switching later

Everything that matters is in Postgres, with the same schema on both platforms.

- **Supabase to VPS:**
  1. Run `pg_dump -Fc --no-owner --schema=public` on the Supabase database, and `pg_restore` it into the VPS database.
  2. Run `node dist/migrate.js`. It finds `schema_migrations` already filled and applies only newer migrations.
  3. Set the same `SESSION_SECRET`, so existing sessions stay valid.
  4. Point the app's API base URL at the VPS (an over-the-air update or a remote config value) and keep both running until old builds age out.
  5. Move the RevenueCat webhook URL and the schedule (cron instead of pg_cron).
- **VPS to Supabase.** Do the same in reverse: `pg_dump` from the VPS and restore into Supabase. Then mark the copied migrations as applied with `supabase migration repair --status applied <timestamps>`, deploy the functions and set the secrets.
- **What does not move.** Rate-limit counters and pending magic links can be dropped. The published aggregates can be rebuilt by running the job once.
