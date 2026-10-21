import type { Clock } from './clock.ts';
import type { Sql } from './db/sql.ts';
import { type Mailer, mailerFromEnv, type MailMessage } from './mail.ts';

/**
 * Failure alerts by email: unhandled API errors, failed nightly aggregations, and Apple token
 * revocations that did not go through. Off unless ALERT_EMAIL is set.
 */
export interface Alerts {
  /**
   * Reports a failure. `kind` groups repeats: the first report of a kind in an hour is emailed,
   * the rest only reach the logs. Never throws.
   */
  report(kind: string, err: unknown, detail?: string): Promise<void>;
}

export const noAlerts: Alerts = { report: async () => undefined };

const HOUR_MS = 3_600_000;

export class MailAlerts implements Alerts {
  /** Used when the database cannot count (it may be what failed): one email per kind per hour per process. */
  private readonly sentAt = new Map<string, number>();

  constructor(
    private readonly to: string,
    private readonly mailer: Mailer,
    private readonly sql: Sql | null,
    private readonly clock: Clock,
  ) {}

  async report(kind: string, err: unknown, detail?: string): Promise<void> {
    try {
      const now = this.clock.now();
      if (!(await this.firstThisHour(kind, now))) return;
      await this.mailer.send(alertEmail(this.to, kind, err, detail, now));
    } catch (e) {
      console.error('Could not send an alert email', e);
    }
  }

  private async firstThisHour(kind: string, now: Date): Promise<boolean> {
    const start = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
    if (this.sql) {
      try {
        // The rate_limit table, so the limit holds across Edge isolates; the nightly job clears old windows.
        const [row] = await this.sql.query<{ count: number }>(
          `INSERT INTO rate_limit (key, window_start, count) VALUES ($1, $2::timestamptz, 1)
           ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limit.count + 1
           RETURNING count`,
          [`alert:${kind}`, start.toISOString()],
        );
        return row.count === 1;
      } catch {
        // Fall through to this process's memory.
      }
    }
    const last = this.sentAt.get(kind);
    if (last !== undefined && now.getTime() - last < HOUR_MS) return false;
    this.sentAt.set(kind, now.getTime());
    return true;
  }
}

/** Alerts to ALERT_EMAIL (through `mailer`, or one built from the environment), or none when it is unset. */
export function alertsFromEnv(env: Record<string, string | undefined>, sql: Sql | null, clock: Clock, mailer?: Mailer): Alerts {
  const to = env.ALERT_EMAIL?.trim();
  return to ? new MailAlerts(to, mailer ?? mailerFromEnv(env), sql, clock) : noAlerts;
}

/** A failed aggregation run: a thrown error, or a result with ok false (a failed sanity check; nothing published). */
export async function reportAggregationFailure(alerts: Alerts, failure: unknown): Promise<void> {
  const err = failure instanceof Error ? failure : new Error(String(failure));
  await alerts.report('aggregate', err, 'The nightly community aggregation failed, so nothing new was published. See aggregate_job_log.');
}

/** Copy: sentence case, no exclamation marks. Holds no request bodies or user ids. */
export function alertEmail(to: string, kind: string, err: unknown, detail: string | undefined, now: Date): MailMessage {
  const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  const stack = err instanceof Error && err.stack ? err.stack.split('\n').slice(1, 16).join('\n') : '';
  return {
    to,
    subject: `SnoreHive server alert: ${kind}`,
    text: [
      'Something failed on the SnoreHive server.',
      '',
      `What: ${kind}`,
      ...(detail ? [detail] : []),
      `When: ${now.toISOString()}`,
      `Error: ${error.slice(0, 1000)}`,
      ...(stack ? ['', stack] : []),
      '',
      'Only the first alert of this kind each hour is emailed. Check the server logs for the rest.',
    ].join('\n'),
  };
}
