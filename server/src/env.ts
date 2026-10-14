import { remoteJwks } from './auth/providers.ts';
import { systemClock } from './clock.ts';
import { loadConfig } from './config.ts';
import type { Sql } from './db/sql.ts';
import type { Deps } from './deps.ts';
import { mailerFromEnv } from './mail.ts';
import { PgRateLimiter } from './rateLimit.ts';

/** Production dependencies from environment variables; shared by the Node and Deno entry points. */
export function depsFromEnv(env: Record<string, string | undefined>, sql: Sql): Deps {
  return {
    sql,
    clock: systemClock,
    config: loadConfig(env),
    mailer: mailerFromEnv(env),
    rateLimiter: new PgRateLimiter(sql, systemClock),
    jwks: remoteJwks(),
  };
}
