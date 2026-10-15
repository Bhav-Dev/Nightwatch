-- One-time setup for Nightwatch in a shared Postgres database (an existing Supabase project, or
-- a VPS database used by other apps). Run it once as the database owner: in Supabase, paste it
-- into the SQL editor; on a VPS, `psql -U postgres -d <db> -f sql/setup.sql`.
--
-- It creates:
--   * schema  nightwatch      every Nightwatch table lives here, never in public;
--   * role    nightwatch_app  the only role the Nightwatch API, nightly job and migrations use.
--     It owns the nightwatch schema, its default search_path is nightwatch, and it has no
--     access to other apps' tables.
--
-- Before running: replace CHANGE_ME with a long random password (for example the output of
-- `openssl rand -hex 32`; base64's + / = would need escaping in the connection string), and keep
-- it in your password manager. It goes into NIGHTWATCH_DATABASE_URL, never into the repo.

CREATE ROLE nightwatch_app LOGIN PASSWORD 'CHANGE_ME' NOINHERIT;

-- Supabase's postgres role is not a superuser. It can create a role, but cannot hand it a schema
-- (AUTHORIZATION) unless it may SET ROLE to it (Postgres 16 and later) or is a member (15). Grant
-- just that to whoever runs this script; a superuser needs nothing. The owner could grant itself
-- this anyway, since it holds ADMIN on roles it creates.
DO $$
BEGIN
  IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) THEN
    IF current_setting('server_version_num')::int >= 160000 THEN
      EXECUTE format('GRANT nightwatch_app TO %I WITH INHERIT FALSE, SET TRUE', current_user);
    ELSE
      EXECUTE format('GRANT nightwatch_app TO %I', current_user);
    END IF;
  END IF;
END
$$;

CREATE SCHEMA nightwatch AUTHORIZATION nightwatch_app;

-- Unqualified table names resolve to the nightwatch schema on every connection this role makes,
-- including through Supabase's connection pooler.
ALTER ROLE nightwatch_app SET search_path = nightwatch;

-- Nobody else gets in by default. On Supabase this also keeps the auto-generated REST API
-- (roles anon, authenticated) away from Nightwatch data; do not add `nightwatch` to the
-- project's exposed schemas. Run as the schema's owner, so the revokes take effect whoever runs
-- this script (a non-superuser owner holds no privileges of its own on the schema).
SET ROLE nightwatch_app;
REVOKE ALL ON SCHEMA nightwatch FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON SCHEMA nightwatch FROM anon, authenticated';
  END IF;
END
$$;
RESET ROLE;

-- And Nightwatch cannot create anything in the shared public schema.
REVOKE CREATE ON SCHEMA public FROM nightwatch_app;
