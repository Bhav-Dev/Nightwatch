-- Nightwatch server schema, v1. Plain Postgres 15+: no extensions, no Supabase-only features.
-- Ids are generated in TypeScript (crypto.randomUUID), so pgcrypto is not needed.
--
-- Row level security is enabled on every table with no policies. On a VPS that changes
-- nothing (the API connects as the table owner, which bypasses RLS). On Supabase it stops
-- the auto-generated REST API from exposing these tables to the anon key; the API function
-- connects as the postgres role and is unaffected.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

-- "user" is reserved in Postgres, hence app_user.
CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  auth_provider text NOT NULL CHECK (auth_provider IN ('apple', 'google', 'email')),
  -- Provider subject; for email sign-in, the lowercased address.
  auth_subject text NOT NULL,
  email text,
  name text,
  created_at timestamptz NOT NULL,
  last_sign_in_at timestamptz NOT NULL,
  UNIQUE (auth_provider, auth_subject)
);

CREATE TABLE device (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_sync_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, device_id)
);

-- Mirrored from RevenueCat webhooks. Whether it is active right now is decided at read time
-- (active AND expires_at in the future), so a cancelled plan runs to the end of its period.
CREATE TABLE subscription (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  active boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'cancelled', 'billing_issue', 'expired')),
  plan text CHECK (plan IN ('yearly', 'monthly')),
  product_id text,
  expires_at timestamptz,
  last_event_id text,
  last_event_at timestamptz,
  updated_at timestamptz NOT NULL
);

-- Night ids are generated on the phone and are globally unique; a night belongs to one user.
CREATE TABLE night_summary (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id text,
  date text NOT NULL,
  duration_s integer NOT NULL,
  time_in_bed_s integer NOT NULL,
  score double precision NOT NULL,
  score_version integer NOT NULL,
  pct_snoring double precision NOT NULL,
  event_count integer NOT NULL,
  max_db double precision NOT NULL,
  partial boolean NOT NULL,
  typical boolean,
  -- Health summary; has_health distinguishes "no health data" from "all fields empty".
  has_health boolean NOT NULL DEFAULT false,
  sleep_efficiency double precision,
  spo2_min double precision,
  spo2_dips integer,
  hr_mean double precision,
  hr_max double precision,
  hrv_mean double precision,
  resp_mean double precision,
  -- Client edit time (last write wins) and server write time (pull cursor).
  updated_at timestamptz NOT NULL,
  server_updated_at timestamptz NOT NULL,
  -- Hash of the night as sent, logs included. The phone's updated_at has 1-second resolution,
  -- so an equal timestamp with different content is still applied; an identical re-send is not.
  content_hash text NOT NULL DEFAULT ''
);
CREATE INDEX night_summary_user_updated ON night_summary (user_id, server_updated_at);

CREATE TABLE remedy_log (
  night_id text NOT NULL REFERENCES night_summary(id) ON DELETE CASCADE,
  remedy_id text NOT NULL,
  PRIMARY KEY (night_id, remedy_id)
);

CREATE TABLE factor_log (
  night_id text NOT NULL REFERENCES night_summary(id) ON DELETE CASCADE,
  factor_id text NOT NULL,
  value text,
  PRIMARY KEY (night_id, factor_id)
);

CREATE TABLE profile (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  age_band text,
  sex text,
  height_band text,
  weight_band text,
  bmi_band text,
  position text,
  pauses_reported text,
  apnoea_dx boolean,
  cpap boolean,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL
);

-- A user has at most one active (not withdrawn) contributor id. Opting out and in again
-- creates a new id; the old one goes on the exclusion list.
CREATE TABLE contribution (
  contributor_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  opted_in_at timestamptz NOT NULL,
  withdrawn_at timestamptz
);
CREATE UNIQUE INDEX contribution_one_active ON contribution (user_id) WHERE withdrawn_at IS NULL;

-- No user id here, so it survives account deletion and the job can keep dropping the ids.
CREATE TABLE contributor_exclusion (
  contributor_id uuid PRIMARY KEY,
  reason text NOT NULL CHECK (reason IN ('withdrawn', 'account_deleted', 'manual')),
  excluded_at timestamptz NOT NULL
);

CREATE TABLE catalogue (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('remedy', 'factor')),
  kind text NOT NULL CHECK (kind IN ('device', 'habit', 'factor')),
  category text NOT NULL,
  name text NOT NULL,
  article_md text NOT NULL DEFAULT '',
  link_url text,
  amazon jsonb,
  value_options jsonb,
  active boolean NOT NULL DEFAULT true,
  -- Catalogue version at which this row last changed; GET /catalogue?since= filters on it.
  version integer NOT NULL
);

-- One row per (suggestion, submitter). The submitter is the contributor id, or a keyed hash
-- of the user id for people who do not contribute; never the user id itself.
CREATE TABLE catalogue_suggestion (
  text_key text NOT NULL,
  submitter_key text NOT NULL,
  text text NOT NULL,
  times integer NOT NULL DEFAULT 1,
  first_at timestamptz NOT NULL,
  last_at timestamptz NOT NULL,
  PRIMARY KEY (text_key, submitter_key)
);

CREATE VIEW catalogue_suggestion_counts AS
  SELECT text_key, min(text) AS example, count(*)::integer AS people, sum(times)::integer AS times,
         max(last_at) AS last_at
  FROM catalogue_suggestion
  GROUP BY text_key;

-- Published community figures. "window" is reserved in Postgres, hence time_window.
-- These tables never hold user or contributor ids.
CREATE TABLE aggregate (
  segment text NOT NULL,
  time_window text NOT NULL CHECK (time_window IN ('all', '90d')),
  remedy_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok', 'early', 'hidden')),
  users integer NOT NULL,
  nights integer,
  median_delta double precision,
  p25 double precision,
  p75 double precision,
  median_delta_pct double precision,
  holds_without_alcohol boolean,
  trend text CHECK (trend IN ('better', 'worse', 'steady')),
  -- Only for segment 'all', window 'all': [{ bucket, count }].
  distribution jsonb,
  PRIMARY KEY (segment, time_window, remedy_id)
);

CREATE TABLE aggregate_stack (
  remedy_a text NOT NULL,
  remedy_b text NOT NULL,
  users integer NOT NULL,
  nights integer NOT NULL,
  median_delta double precision NOT NULL,
  p25 double precision NOT NULL,
  p75 double precision NOT NULL,
  PRIMARY KEY (remedy_a, remedy_b)
);

CREATE TABLE aggregate_snapshot (
  segment text NOT NULL,
  time_window text NOT NULL CHECK (time_window IN ('all', '90d')),
  body jsonb NOT NULL,
  etag text NOT NULL,
  computed_at timestamptz NOT NULL,
  PRIMARY KEY (segment, time_window)
);

-- Staging copies: the job fills these, then swaps them in within one transaction.
CREATE TABLE aggregate_next (LIKE aggregate INCLUDING ALL);
CREATE TABLE aggregate_stack_next (LIKE aggregate_stack INCLUDING ALL);
CREATE TABLE aggregate_snapshot_next (LIKE aggregate_snapshot INCLUDING ALL);

CREATE TABLE aggregate_job_log (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'ok', 'failed')),
  computed_at timestamptz,
  contributors integer,
  aggregate_rows integer,
  stack_rows integer,
  snapshots integer,
  score_version integer,
  excluded_dates jsonb,
  message text
);

-- Sign-in links. Only the SHA-256 of the token is stored.
CREATE TABLE magic_link (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX magic_link_email ON magic_link (email);

-- Fixed-window counters. Kept in Postgres so limits hold on stateless Edge functions too.
CREATE TABLE rate_limit (
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (key, window_start)
);
CREATE INDEX rate_limit_window ON rate_limit (window_start);

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE device ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE night_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE remedy_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE factor_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE contribution ENABLE ROW LEVEL SECURITY;
ALTER TABLE contributor_exclusion ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalogue_suggestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_stack ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_next ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_stack_next ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_snapshot_next ENABLE ROW LEVEL SECURITY;
ALTER TABLE aggregate_job_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_limit ENABLE ROW LEVEL SECURITY;
-- Views run with the owner's rights by default, which would bypass RLS. Postgres 15+ can make
-- the view check the caller's rights instead, so it is as private as the table under it.
ALTER VIEW catalogue_suggestion_counts SET (security_invoker = true);
