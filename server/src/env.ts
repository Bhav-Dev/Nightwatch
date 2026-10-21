import { alertsFromEnv } from './alerts.ts';
import { remoteJwks } from './auth/providers.ts';
import { systemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import type { Sql } from './db/sql.ts';
import type { Deps } from './deps.ts';
import { mailerFromEnv } from './mail.ts';
import { PgRateLimiter } from './rateLimit.ts';

/** Production dependencies from environment variables; shared by the Node and Deno entry points. */
export function depsFromEnv(env: Record<string, string | undefined>, sql: Sql): Deps {
  const config = loadConfig(env);
  const mailer = mailerFromEnv(env);
  if (!config.appleSignIn && config.appleAudiences.length > 0) {
    console.warn('APPLE_TEAM_ID, APPLE_SIWA_KEY_ID or APPLE_SIWA_PRIVATE_KEY not set: Sign in with Apple tokens are not revoked when an account is deleted');
  }
  return {
    sql,
    clock: systemClock,
    config,
    mailer,
    rateLimiter: new PgRateLimiter(sql, systemClock),
    jwks: remoteJwks(),
    alerts: alertsFromEnv(env, sql, systemClock, mailer),
  };
}
