import { Hono } from 'hono';

import type { AuthExchangeResponse } from '../../../shared/api.ts';
import { keepAppleToken } from '../auth/appleTokens.ts';
import { verifyApple, verifyGoogle, type VerifiedIdentity } from '../auth/providers.ts';
import { signSession } from '../auth/session.ts';
import { randomId, randomToken, sha256Hex } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { badRequest, HttpError, unauthorized } from '../errors.ts';
import { magicLinkEmail } from '../mail.ts';
import { exchangeBody, magicLinkBody, readBody } from '../validation.ts';
import { rateLimit } from './util.ts';

export function authRoutes(deps: Deps) {
  const { sql, clock, config, mailer } = deps;
  const r = new Hono<AppEnv>();

  // Always 204 for a well-formed address, so the response says nothing about who has an account.
  r.post('/auth/magic-link', async (c) => {
    const { email: raw } = await readBody(c, magicLinkBody);
    const email = raw.trim().toLowerCase();
    await rateLimit(deps, `magic:${email}`, config.limits.magicLinksPerHour, 'Too many sign-in emails. Try again later.');

    const token = randomToken(32);
    const now = clock.now();
    const expires = new Date(now.getTime() + config.magicLinkTtlMinutes * 60_000);
    await sql.query(
      `INSERT INTO magic_link (token_hash, email, created_at, expires_at) VALUES ($1, $2, $3::timestamptz, $4::timestamptz)`,
      [await sha256Hex(token), email, now.toISOString(), expires.toISOString()],
    );
    const link = `${config.appLinkBase}/auth?token=${encodeURIComponent(token)}`;
    try {
      await mailer.send(magicLinkEmail(email, link, config.magicLinkTtlMinutes));
    } catch (err) {
      (deps.logError ?? console.error)(err);
      throw new HttpError(503, 'mail_failed', 'The sign-in email could not be sent. Try again in a minute.');
    }
    return c.body(null, 204);
  });

  r.post('/auth/exchange', async (c) => {
    const body = await readBody(c, exchangeBody);
    const now = clock.now();
    let identity: VerifiedIdentity;
    if (body.provider === 'email') {
      // Single use: the update succeeds for exactly one caller, and only before expiry.
      const [row] = await sql.query<{ email: string }>(
        `UPDATE magic_link SET used_at = $2::timestamptz
         WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2::timestamptz
         RETURNING email`,
        [await sha256Hex(body.token), now.toISOString()],
      );
      if (!row) throw unauthorized('This sign-in link has expired or was already used.', 'invalid_token');
      identity = { subject: row.email, email: row.email };
    } else {
      const audiences = body.provider === 'apple' ? config.appleAudiences : config.googleAudiences;
      if (audiences.length === 0) throw badRequest(`Sign in with ${body.provider} is not set up.`, 'provider_not_configured');
      try {
        identity =
          body.provider === 'apple'
            ? await verifyApple(body.token, deps.jwks.apple, audiences, now)
            : await verifyGoogle(body.token, deps.jwks.google, audiences, now);
      } catch {
        throw unauthorized('The sign-in token could not be verified.', 'invalid_token');
      }
    }

    // Apple sends the name only on the first sign-in, so an existing name is never overwritten.
    const [user] = await sql.query<{ id: string }>(
      `INSERT INTO app_user (id, auth_provider, auth_subject, email, name, created_at, last_sign_in_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz)
       ON CONFLICT (auth_provider, auth_subject) DO UPDATE SET
         last_sign_in_at = EXCLUDED.last_sign_in_at,
         email = COALESCE(EXCLUDED.email, app_user.email),
         name = COALESCE(app_user.name, EXCLUDED.name)
       RETURNING id::text AS id`,
      [randomId(), body.provider, identity.subject, identity.email, body.name ?? null, now.toISOString()],
    );
    // So the Apple token can be revoked if the account is deleted. Never fails the sign-in.
    if (body.provider === 'apple' && body.authorization_code) await keepAppleToken(deps, user.id, body.authorization_code);
    const session = await signSession(user.id, config.sessionSecret, now, config.sessionTtlDays);
    const res: AuthExchangeResponse = {
      session_token: session.token,
      user_id: user.id,
      expires_at: session.expiresAt.toISOString(),
    };
    return c.json(res);
  });

  return r;
}
