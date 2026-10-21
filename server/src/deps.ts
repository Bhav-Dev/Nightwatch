import type { Alerts } from './alerts.ts';
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
  /** Where notes worth a log line go (a step skipped for missing configuration). Defaults to console.log. */
  logInfo?: (message: string) => void;
  /** Failure alerts by email (ALERT_EMAIL). None when absent. */
  alerts?: Alerts;
  /** HTTP for upstream services (MET Norway's forecast). Defaults to the global fetch. */
  fetch?: typeof fetch;
}

export type AppEnv = { Variables: { userId: string } };
