import { describe, expect, it } from 'vitest';

import { type Alerts, alertEmail, alertsFromEnv, MailAlerts, noAlerts } from '../src/alerts.ts';
import type { Sql } from '../src/db/sql.ts';
import { ConsoleMailer, type Mailer } from '../src/mail.ts';
import { harness, TestClock, testDb } from './helpers.ts';

/** A database that only fails the queries whose text matches. */
function failing(sql: Sql, match: RegExp): Sql {
  const wrap = (inner: Sql): Sql => ({
    query: (text, params) => (match.test(text) ? Promise.reject(new Error('connection terminated unexpectedly')) : inner.query(text, params)),
    exec: (text) => inner.exec(text),
    transaction: (fn) => inner.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(sql);
}

describe('alerts', () => {
  it('email the first report of a kind each hour, and each kind separately', async () => {
    const sql = await testDb();
    const clock = new TestClock();
    const mailer = new ConsoleMailer(true);
    const alerts = new MailAlerts('ops@example.com', mailer, sql, clock);

    await alerts.report('aggregate', new Error('first'));
    await alerts.report('aggregate', new Error('second'));
    await alerts.report('api GET /v1/catalogue', new Error('third'));
    expect(mailer.sent.map((m) => [m.to, m.subject])).toEqual([
      ['ops@example.com', 'SnoreHive server alert: aggregate'],
      ['ops@example.com', 'SnoreHive server alert: api GET /v1/catalogue'],
    ]);

    clock.advance(3600_000);
    await alerts.report('aggregate', new Error('next hour'));
    expect(mailer.sent).toHaveLength(3);
    expect(mailer.sent[2].text).toContain('Error: Error: next hour');
  });

  it('count in memory when the database is what failed', async () => {
    const sql = failing(await testDb(), /rate_limit/);
    const clock = new TestClock();
    const mailer = new ConsoleMailer(true);
    const alerts = new MailAlerts('ops@example.com', mailer, sql, clock);
    await alerts.report('api POST /v1/sync/nights', new Error('down'));
    await alerts.report('api POST /v1/sync/nights', new Error('down again'));
    expect(mailer.sent).toHaveLength(1);
    clock.advance(3600_000);
    await alerts.report('api POST /v1/sync/nights', new Error('still down'));
    expect(mailer.sent).toHaveLength(2);
  });

  it('never throw, even when the email cannot be sent', async () => {
    const broken: Mailer = { send: () => Promise.reject(new Error('Resend responded 401')) };
    const alerts = new MailAlerts('ops@example.com', broken, null, new TestClock());
    await expect(alerts.report('aggregate', new Error('x'))).resolves.toBeUndefined();
  });

  it('are off without ALERT_EMAIL', async () => {
    expect(alertsFromEnv({}, null, new TestClock(), new ConsoleMailer(true))).toBe(noAlerts);
    expect(alertsFromEnv({ ALERT_EMAIL: '  ' }, null, new TestClock(), new ConsoleMailer(true))).toBe(noAlerts);
    expect(alertsFromEnv({ ALERT_EMAIL: 'ops@example.com' }, null, new TestClock(), new ConsoleMailer(true))).toBeInstanceOf(MailAlerts);
  });

  it('follow the copy rules and keep to what went wrong', () => {
    const err = new TypeError('Cannot read properties of undefined');
    const mail = alertEmail('ops@example.com', 'api GET /v1/profile', err, 'An API request ended in an unexpected error (500).', new Date('2026-10-14T04:00:00Z'));
    expect(mail.text).not.toContain('!');
    expect(mail.subject).toBe('SnoreHive server alert: api GET /v1/profile');
    expect(mail.text).toContain('When: 2026-10-14T04:00:00.000Z');
    expect(mail.text).toContain('TypeError: Cannot read properties of undefined');
  });
});

describe('API errors', () => {
  function recorder() {
    const reports: { kind: string; err: unknown }[] = [];
    const alerts: Alerts = { report: async (kind, err) => void reports.push({ kind, err }) };
    return { reports, alerts };
  }

  it('alert on an unexpected error, by route pattern, and still answer 500', async () => {
    const { reports, alerts } = recorder();
    const sql = failing(await testDb(), /FROM catalogue|night_summary/);
    const h = await harness({ alerts, logError: () => undefined }, sql);
    const { token } = await h.user();

    const res = await h.call('GET', '/v1/catalogue', { token });
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('internal');
    expect(reports.map((r) => r.kind)).toEqual(['api GET /v1/catalogue']);

    // An id in the path is not part of the kind, so one failure is one kind.
    await h.call('DELETE', '/v1/sync/nights/7b0c2f4e-1111-4c2b-9d3a-000000000001', { token });
    expect(reports[1].kind).toBe('api DELETE /v1/sync/nights/:id');
  });

  it('do not alert on the errors the API means to send', async () => {
    const { reports, alerts } = recorder();
    const h = await harness({ alerts });
    expect((await h.call('GET', '/v1/catalogue')).status).toBe(401);
    expect((await h.call('POST', '/v1/auth/magic-link', { body: { email: 'nope' } })).status).toBe(400);
    expect((await h.call('GET', '/nothing-here')).status).toBe(404);
    expect(reports).toEqual([]);
  });
});
