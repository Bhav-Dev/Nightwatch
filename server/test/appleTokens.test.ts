import { exportPKCS8, generateKeyPair, jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';

import type { Alerts } from '../src/alerts.ts';
import { APPLE_TOKEN_PURPOSE, type AppleSignInKey } from '../src/auth/appleTokens.ts';
import { loadConfig } from '../src/config.ts';
import { seal, unseal } from '../src/crypto.ts';
import type { Deps } from '../src/deps.ts';
import { APPLE_AUD, harness } from './helpers.ts';

const now = () => Math.floor(Date.parse('2026-10-14T04:00:00Z') / 1000);

/** A Sign in with Apple key generated for the test, with its public half for checking client secrets. */
async function siwaKey(): Promise<{ key: AppleSignInKey; publicKey: Awaited<ReturnType<typeof generateKeyPair>>['publicKey'] }> {
  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  return { key: { teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: await exportPKCS8(privateKey), clientId: APPLE_AUD }, publicKey };
}

interface AppleCall {
  path: string;
  form: URLSearchParams;
}

/** Stands in for appleid.apple.com: records every call and answers with the given statuses. */
function fakeApple(opts: { token?: number; revoke?: number } = {}) {
  const calls: AppleCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ path: url.pathname, form: new URLSearchParams(String(init?.body)) });
    if (url.pathname === '/auth/token') {
      const status = opts.token ?? 200;
      return status === 200
        ? Response.json({ access_token: 'a', token_type: 'Bearer', expires_in: 3600, refresh_token: `apple-refresh-${calls.length}`, id_token: 'i' })
        : Response.json({ error: 'invalid_grant' }, { status });
    }
    return new Response('', { status: opts.revoke ?? 200 });
  }) as typeof fetch;
  return { calls, fetchFn };
}

function collectors() {
  const errors: unknown[] = [];
  const notes: string[] = [];
  const alerted: { kind: string; err: unknown }[] = [];
  const alerts: Alerts = { report: async (kind, err) => void alerted.push({ kind, err }) };
  const deps: Partial<Deps> = { logError: (e) => void errors.push(e), logInfo: (m) => void notes.push(m), alerts };
  return { errors, notes, alerted, deps };
}

async function appleSignIn(h: Awaited<ReturnType<typeof harness>>, sub: string, code?: string) {
  const token = await h.apple.sign({ email: `${sub}@privaterelay.appleid.com` }, { iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub, iat: now(), exp: now() + 600 });
  return h.call('POST', '/v1/auth/exchange', { body: { provider: 'apple', token, name: null, authorization_code: code } });
}

describe('Sign in with Apple token revocation', () => {
  it('keeps the refresh token sealed at sign-in and revokes it when the account is deleted', async () => {
    const { key, publicKey } = await siwaKey();
    const apple = fakeApple();
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });
    h.deps.config.appleSignIn = key;

    const ex = await appleSignIn(h, 'apple-101', 'code-from-the-app');
    expect(ex.status).toBe(200);
    expect(apple.calls).toHaveLength(1);
    const [exchange] = apple.calls;
    expect(exchange.path).toBe('/auth/token');
    expect(Object.fromEntries(exchange.form)).toMatchObject({ client_id: APPLE_AUD, code: 'code-from-the-app', grant_type: 'authorization_code' });

    // The client secret is the ES256 JWT Apple specifies.
    const { payload, protectedHeader } = await jwtVerify(exchange.form.get('client_secret')!, publicKey, {
      issuer: 'TEAM123456',
      audience: 'https://appleid.apple.com',
      subject: APPLE_AUD,
      currentDate: h.clock.now(),
    });
    expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: 'KEY1234567' });
    expect(payload.exp! - payload.iat!).toBe(300);

    // Stored sealed, not in the clear.
    const [row] = await h.sql.query<{ refresh_token_enc: string }>('SELECT refresh_token_enc FROM apple_token WHERE user_id = $1', [ex.body.user_id]);
    expect(row.refresh_token_enc).not.toContain('apple-refresh');
    expect(await unseal(h.deps.config.sessionSecret, APPLE_TOKEN_PURPOSE, row.refresh_token_enc)).toBe('apple-refresh-1');

    // A second sign-in replaces it with the newer token.
    await appleSignIn(h, 'apple-101', 'second-code');
    const [newer] = await h.sql.query<{ refresh_token_enc: string }>('SELECT refresh_token_enc FROM apple_token WHERE user_id = $1', [ex.body.user_id]);
    expect(await unseal(h.deps.config.sessionSecret, APPLE_TOKEN_PURPOSE, newer.refresh_token_enc)).toBe('apple-refresh-2');

    expect((await h.call('DELETE', '/v1/account', { token: ex.body.session_token })).status).toBe(204);
    const revoke = apple.calls.at(-1)!;
    expect(revoke.path).toBe('/auth/revoke');
    expect(Object.fromEntries(revoke.form)).toMatchObject({ client_id: APPLE_AUD, token: 'apple-refresh-2', token_type_hint: 'refresh_token' });
    expect(await h.sql.query('SELECT 1 FROM apple_token')).toEqual([]);
    expect(await h.sql.query('SELECT 1 FROM app_user')).toEqual([]);
    expect(c.errors).toEqual([]);
    expect(c.alerted).toEqual([]);
  });

  it('still signs in when Apple refuses the code, keeping nothing', async () => {
    const { key } = await siwaKey();
    const apple = fakeApple({ token: 400 });
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });
    h.deps.config.appleSignIn = key;

    const ex = await appleSignIn(h, 'apple-102', 'stale-code');
    expect(ex.status).toBe(200);
    expect(ex.body.session_token).toEqual(expect.any(String));
    expect(String(c.errors[0])).toContain('invalid_grant');
    expect(await h.sql.query('SELECT 1 FROM apple_token')).toEqual([]);
  });

  it('skips with a log line when the key is not set, and never calls Apple', async () => {
    const apple = fakeApple();
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });

    const ex = await appleSignIn(h, 'apple-103', 'code');
    expect(ex.status).toBe(200);
    expect(c.notes).toEqual([expect.stringContaining('not kept')]);
    expect((await h.call('DELETE', '/v1/account', { token: ex.body.session_token })).status).toBe(204);
    expect(c.notes[1]).toContain('nothing to revoke');
    expect(apple.calls).toEqual([]);
    expect(await h.sql.query('SELECT 1 FROM app_user')).toEqual([]);
  });

  it('signs in without a code (older app versions) and keeps nothing', async () => {
    const apple = fakeApple();
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });
    h.deps.config.appleSignIn = (await siwaKey()).key;
    expect((await appleSignIn(h, 'apple-104')).status).toBe(200);
    expect(apple.calls).toEqual([]);
    expect(c.notes).toEqual([]);
  });

  it('deletes the account even when the revocation fails, and alerts', async () => {
    const { key } = await siwaKey();
    const apple = fakeApple({ revoke: 503 });
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });
    h.deps.config.appleSignIn = key;

    const ex = await appleSignIn(h, 'apple-105', 'code');
    expect((await h.call('DELETE', '/v1/account', { token: ex.body.session_token })).status).toBe(204);
    expect(await h.sql.query('SELECT 1 FROM app_user')).toEqual([]);
    expect(String(c.errors[0])).toContain('503');
    expect(c.alerted.map((a) => a.kind)).toEqual(['apple_revoke']);
  });

  it('deletes the account when the kept token can no longer be opened (SESSION_SECRET changed)', async () => {
    const { key } = await siwaKey();
    const apple = fakeApple();
    const c = collectors();
    const h = await harness({ fetch: apple.fetchFn, ...c.deps });
    h.deps.config.appleSignIn = key;
    const ex = await appleSignIn(h, 'apple-106', 'code');
    await h.sql.query('UPDATE apple_token SET refresh_token_enc = $1', [await seal('another-secret-entirely-0123456789', APPLE_TOKEN_PURPOSE, 'x')]);

    expect((await h.call('DELETE', '/v1/account', { token: ex.body.session_token })).status).toBe(204);
    expect(await h.sql.query('SELECT 1 FROM app_user')).toEqual([]);
    expect(apple.calls.map((call) => call.path)).toEqual(['/auth/token']);
    expect(c.alerted).toHaveLength(1);
  });
});

describe('sealing', () => {
  const secret = 'test-session-secret-0123456789abcdef';

  it('round-trips, with a fresh IV each time', async () => {
    const a = await seal(secret, 'purpose', 'refresh token');
    const b = await seal(secret, 'purpose', 'refresh token');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(await unseal(secret, 'purpose', a)).toBe('refresh token');
  });

  it('refuses a changed value, another purpose or another secret', async () => {
    const sealed = await seal(secret, 'purpose', 'refresh token');
    const flipped = sealed.slice(0, -2) + (sealed.endsWith('A') ? 'BB' : 'AA');
    await expect(unseal(secret, 'purpose', flipped)).rejects.toThrow();
    await expect(unseal(secret, 'other purpose', sealed)).rejects.toThrow();
    await expect(unseal(`${secret}x`, 'purpose', sealed)).rejects.toThrow();
    await expect(unseal(secret, 'purpose', 'v2.abc')).rejects.toThrow();
  });
});

describe('Sign in with Apple key configuration', () => {
  const base = { SESSION_SECRET: 'x'.repeat(32), APPLE_AUDIENCES: 'com.threeft2.nightwatch' };
  const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----';

  it('reads the key, accepting escaped newlines, for the first Apple audience', () => {
    const config = loadConfig({ ...base, APPLE_TEAM_ID: 'T', APPLE_SIWA_KEY_ID: 'K', APPLE_SIWA_PRIVATE_KEY: pem.replace(/\n/g, '\\n') });
    expect(config.appleSignIn).toEqual({ teamId: 'T', keyId: 'K', privateKey: pem, clientId: 'com.threeft2.nightwatch' });
  });

  it('prefers APPLE_CLIENT_ID, and is off without every part', () => {
    const full = { ...base, APPLE_TEAM_ID: 'T', APPLE_SIWA_KEY_ID: 'K', APPLE_SIWA_PRIVATE_KEY: pem };
    expect(loadConfig({ ...full, APPLE_CLIENT_ID: 'com.example.other' }).appleSignIn?.clientId).toBe('com.example.other');
    expect(loadConfig({ ...full, APPLE_SIWA_KEY_ID: '' }).appleSignIn).toBeNull();
    expect(loadConfig({ ...full, APPLE_AUDIENCES: '' }).appleSignIn).toBeNull();
    expect(loadConfig(base).appleSignIn).toBeNull();
  });

  it('keeps magic links on nightwatch:// unless APP_LINK_BASE points at the website', () => {
    // The base is followed by /auth, so these give nightwatch://auth and https://snorehive.app/auth.
    expect(loadConfig(base).appLinkBase).toBe('nightwatch:/');
    expect(loadConfig({ ...base, APP_LINK_BASE: '' }).appLinkBase).toBe('nightwatch:/');
    expect(loadConfig({ ...base, APP_LINK_BASE: 'nightwatch://' }).appLinkBase).toBe('nightwatch:/');
    expect(loadConfig({ ...base, APP_LINK_BASE: 'https://snorehive.app/' }).appLinkBase).toBe('https://snorehive.app');
  });
});
