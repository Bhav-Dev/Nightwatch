/**
 * On a shared Supabase project, Edge Function secrets are project-wide: every app's functions
 * see every secret. Nightwatch's secrets are therefore stored with a NIGHTWATCH_ prefix
 * (NIGHTWATCH_SESSION_SECRET, NIGHTWATCH_DATABASE_URL, ...) and only those are read, with the
 * prefix removed. Unprefixed values (another app's SESSION_SECRET, Supabase's own
 * SUPABASE_DB_URL, which connects as the project owner) are never used.
 */
export const SUPABASE_ENV_PREFIX = 'NIGHTWATCH_';

export function scopedEnv(env: Record<string, string | undefined>, prefix = SUPABASE_ENV_PREFIX): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v;
  return out;
}
