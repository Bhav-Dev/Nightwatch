import type { JwksSet } from './auth/providers.ts';
import type { Clock } from './clock.ts';
import type { Config } from './config.ts';
import type { Sql } from './db/sql.ts';
import type { Mailer } from './mail.ts';
import type { RateLimiter } from './rateLimit.ts';

/** Everything the HTTP app needs. Entry points build this from the environment; tests use fakes. */
export interface Deps {
  sql: Sql;
  clock: Clock;
  config: Config;
  mailer: Mailer;
  rateLimiter: RateLimiter;
  jwks: JwksSet;
  /** Where unexpected errors are reported. Defaults to console.error. */
  logError?: (err: unknown) => void;
}

export type AppEnv = { Variables: { userId: string } };
