import { createLocalJWKSet, exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';

import { createApp } from '../src/app.ts';
import { signSession } from '../src/auth/session.ts';
import type { Clock } from '../src/clock.ts';
import { type Config, DEFAULT_LIMITS } from '../src/config.ts';
import { createPglite } from '../src/db/pglite.ts';
import { migrate } from '../src/db/migrate.ts';
import { seedCatalogue } from '../src/db/seed.ts';
import type { Sql } from '../src/db/sql.ts';
import type { Deps } from '../src/deps.ts';
import { ConsoleMailer } from '../src/mail.ts';
import { unlimited } from '../src/rateLimit.ts';

export const APPLE_AUD = 'com.example.nightwatch';
export const GOOGLE_AUD = 'google-client-id.apps.googleusercontent.com';
export const WEBHOOK_AUTH = 'Bearer revenuecat-test-secret';

/** A clock tests can move. */
export class TestClock implements Clock {
  constructor(public t = new Date('2026-10-14T04:00:00Z')) {}
  now() {
    return new Date(this.t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}

/** A fresh in-process Postgres with every migration applied and the catalogue seeded. */
export async function testDb(): Promise<Sql> {
  const sql = await createPglite();
  await migrate(sql);
  await seedCatalogue(sql);
  return sql;
}

/** A locally generated RSA key pair standing in for Apple's or Google's JWKS. */
export async function testKeys(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' };
  return {
    jwks: createLocalJWKSet({ keys: [jwk] }),
    sign: (claims: Record<string, unknown>, opts: { iss: string; aud: string; sub: string; exp?: number; iat?: number }) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid })
        .setIssuer(opts.iss)
        .setAudience(opts.aud)
        .setSubject(opts.sub)
        .setIssuedAt(opts.iat ?? Math.floor(Date.now() / 1000))
        .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 600)
        .sign(privateKey),
  };
}

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  basePath: '',
  sessionSecret: 'test-session-secret-0123456789abcdef',
  sessionTtlDays: 90,
  appLinkBase: 'nightwatch:/',
  magicLinkTtlMinutes: 15,
  appleAudiences: [APPLE_AUD],
  appleSignIn: null,
  googleAudiences: [GOOGLE_AUD],
  amazonTags: { GB: 'nightwatch-21' },
  revenueCatWebhookAuth: WEBHOOK_AUTH,
  aggregateSecret: 'aggregate-secret',
  weatherContact: 'tests@example.com',
  limits: DEFAULT_LIMITS,
  ...overrides,
});

export interface Harness {
  sql: Sql;
  clock: TestClock;
  mailer: ConsoleMailer;
  deps: Deps;
  app: ReturnType<typeof createApp>;
  apple: Awaited<ReturnType<typeof testKeys>>;
  google: Awaited<ReturnType<typeof testKeys>>;
  call: (method: string, path: string, opts?: CallOptions) => Promise<CallResult>;
  /** Creates a user directly and returns a session token for them. */
  user: (subject?: string) => Promise<{ userId: string; token: string }>;
}

export interface CallOptions {
  token?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface CallResult {
  status: number;
  // Tests read whatever shape the endpoint returns.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}

export async function harness(overrides: Partial<Deps> = {}, sqlIn?: Sql): Promise<Harness> {
  const sql = sqlIn ?? (await testDb());
  const clock = new TestClock();
  const mailer = new ConsoleMailer(true);
  const apple = await testKeys('apple-test');
  const google = await testKeys('google-test');
  const deps: Deps = {
    sql,
    clock,
    config: testConfig(),
    mailer,
    rateLimiter: unlimited,
    jwks: { apple: apple.jwks, google: google.jwks },
    logError: (err) => {
      throw err;
    },
    ...overrides,
  };
  const app = createApp(deps);

  const call = async (method: string, path: string, opts: CallOptions = {}): Promise<CallResult> => {
    const headers: Record<string, string> = { ...opts.headers };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await app.request(path, {
      method,
      headers,
      body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  let n = 0;
  const user = async (subject = `user-${Date.now()}-${n++}@example.com`) => {
    const userId = crypto.randomUUID();
    const now = clock.now().toISOString();
    await sql.query(
      `INSERT INTO app_user (id, auth_provider, auth_subject, email, created_at, last_sign_in_at)
       VALUES ($1, 'email', $2, $2, $3::timestamptz, $3::timestamptz)`,
      [userId, subject, now],
    );
    const { token } = await signSession(userId, deps.config.sessionSecret, clock.now(), 90);
    return { userId, token };
  };

  return { sql, clock, mailer, deps, app, apple, google, call, user };
}
