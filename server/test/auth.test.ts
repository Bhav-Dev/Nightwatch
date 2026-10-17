import { describe, expect, it } from 'vitest';

import { PgRateLimiter } from '../src/rateLimit.ts';
import { APPLE_AUD, GOOGLE_AUD, harness } from './helpers.ts';

const now = () => Math.floor(Date.parse('2026-10-14T04:00:00Z') / 1000);

describe('auth', () => {
  it('signs in by magic link end to end', async () => {
    const h = await harness();
    const sent = await h.call('POST', '/v1/auth/magic-link', { body: { email: '  Sam@Example.com ' } });
    expect(sent.status).toBe(204);
    expect(h.mailer.sent).toHaveLength(1);
    const mail = h.mailer.sent[0];
    expect(mail.to).toBe('sam@example.com');
    expect(mail.subject).toBe('Your SnoreHive sign-in link');
    expect(mail.text).not.toContain('!');
    const token = /nightwatch:\/\/auth\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
    expect(token.length).toBe(43); // 32 bytes, base64url

    // Only the hash is stored.
    const stored = await h.sql.query<{ token_hash: string }>('SELECT token_hash FROM magic_link');
    expect(stored[0].token_hash).not.toContain(token);

    const ex = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'email', token } });
    expect(ex.status).toBe(200);
    expect(Object.keys(ex.body).sort()).toEqual(['expires_at', 'session_token', 'user_id']);
    expect(ex.body.expires_at).toBe('2027-01-12T04:00:00.000Z'); // 90 days

    const me = await h.call('GET', '/v1/profile', { token: ex.body.session_token });
    expect(me.status).toBe(200);

    // Single use.
    const again = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'email', token } });
    expect(again.status).toBe(401);
    expect(again.body.error.code).toBe('invalid_token');

    // Same email, same account.
    await h.call('POST', '/v1/auth/magic-link', { body: { email: 'sam@example.com' } });
    const token2 = /token=([A-Za-z0-9_-]+)/.exec(h.mailer.sent[1].text)![1];
    const ex2 = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'email', token: token2 } });
    expect(ex2.body.user_id).toBe(ex.body.user_id);
  });

  it('refuses a magic link after 15 minutes', async () => {
    const h = await harness();
    await h.call('POST', '/v1/auth/magic-link', { body: { email: 'late@example.com' } });
    const token = /token=([A-Za-z0-9_-]+)/.exec(h.mailer.sent[0].text)![1];
    h.clock.advance(15 * 60_000 + 1000);
    const ex = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'email', token } });
    expect(ex.status).toBe(401);
  });

  it('uses APP_LINK_BASE for the link', async () => {
    const h = await harness();
    h.deps.config.appLinkBase = 'https://nightwatch.example';
    await h.call('POST', '/v1/auth/magic-link', { body: { email: 'web@example.com' } });
    expect(h.mailer.sent[0].text).toMatch(/https:\/\/nightwatch\.example\/auth\?token=/);
  });

  it('rejects a malformed email', async () => {
    const h = await harness();
    const res = await h.call('POST', '/v1/auth/magic-link', { body: { email: 'not-an-email' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('limits magic links to 5 an hour per address', async () => {
    const h = await harness();
    h.deps.rateLimiter = new PgRateLimiter(h.sql, h.clock);
    for (let i = 0; i < 5; i++) {
      expect((await h.call('POST', '/v1/auth/magic-link', { body: { email: 'spam@example.com' } })).status).toBe(204);
    }
    const sixth = await h.call('POST', '/v1/auth/magic-link', { body: { email: 'SPAM@example.com' } });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('rate_limited');
    expect(Number(sixth.headers.get('Retry-After'))).toBeGreaterThan(0);
    // Another address is unaffected; the next hour starts afresh.
    expect((await h.call('POST', '/v1/auth/magic-link', { body: { email: 'other@example.com' } })).status).toBe(204);
    h.clock.advance(3600_000);
    expect((await h.call('POST', '/v1/auth/magic-link', { body: { email: 'spam@example.com' } })).status).toBe(204);
  });

  it('signs in with Apple, keeping the first name it is given', async () => {
    const h = await harness();
    const token = await h.apple.sign(
      { email: 'Apple@Privaterelay.appleid.com' },
      { iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub: 'apple-001', iat: now(), exp: now() + 600 },
    );
    const ex = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'apple', token, name: 'Sam' } });
    expect(ex.status).toBe(200);
    const ex2 = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'apple', token, name: null } });
    expect(ex2.body.user_id).toBe(ex.body.user_id);
    const [user] = await h.sql.query<{ name: string; email: string; auth_subject: string }>(
      'SELECT name, email, auth_subject FROM app_user WHERE id = $1',
      [ex.body.user_id],
    );
    expect(user).toEqual({ name: 'Sam', email: 'apple@privaterelay.appleid.com', auth_subject: 'apple-001' });
  });

  it('rejects an Apple token for another audience, issuer or key, or expired', async () => {
    const h = await harness();
    const base = { iss: 'https://appleid.apple.com', aud: APPLE_AUD, sub: 'apple-002', iat: now(), exp: now() + 600 };
    const bad = [
      await h.apple.sign({}, { ...base, aud: 'com.someone.else' }),
      await h.apple.sign({}, { ...base, iss: 'https://evil.example' }),
      await h.google.sign({}, base), // signed with a key Apple never published
      await h.apple.sign({}, { ...base, iat: now() - 7200, exp: now() - 3600 }),
    ];
    for (const token of bad) {
      const res = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'apple', token } });
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('invalid_token');
    }
  });

  it('signs in with Google under either issuer spelling', async () => {
    const h = await harness();
    for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
      const token = await h.google.sign({ email: 'g@example.com' }, { iss, aud: GOOGLE_AUD, sub: 'g-1', iat: now(), exp: now() + 600 });
      expect((await h.call('POST', '/v1/auth/exchange', { body: { provider: 'google', token } })).status).toBe(200);
    }
    const wrongAud = await h.google.sign({}, { iss: 'accounts.google.com', aud: 'other', sub: 'g-1', iat: now(), exp: now() + 600 });
    expect((await h.call('POST', '/v1/auth/exchange', { body: { provider: 'google', token: wrongAud } })).status).toBe(401);
    const [{ n }] = await h.sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM app_user WHERE auth_provider = 'google'`);
    expect(n).toBe(1);
  });

  it('refuses a provider with no audiences configured', async () => {
    const h = await harness();
    h.deps.config.appleAudiences = [];
    const res = await h.call('POST', '/v1/auth/exchange', { body: { provider: 'apple', token: 'x' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('provider_not_configured');
  });

  it('requires a valid, unexpired session everywhere else', async () => {
    const h = await harness();
    const { token } = await h.user();
    expect((await h.call('GET', '/v1/catalogue')).status).toBe(401);
    expect((await h.call('GET', '/v1/catalogue', { token: 'garbage' })).status).toBe(401);
    const bad = await h.call('GET', '/v1/catalogue', { token: token.slice(0, -2) + 'xx' });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: { code: 'invalid_session', message: expect.any(String) } });
    expect((await h.call('GET', '/v1/catalogue', { token })).status).toBe(200);
    h.clock.advance(91 * 86_400_000);
    const expired = await h.call('GET', '/v1/catalogue', { token });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('invalid_session');
  });

  it('serves under a base path for Supabase', async () => {
    const h = await harness();
    h.deps.config.basePath = '/api';
    const { createApp } = await import('../src/app.ts');
    const app = createApp(h.deps);
    expect((await app.request('/api/v1/health')).status).toBe(200);
    expect((await app.request('/v1/health')).status).toBe(404);
  });
});
