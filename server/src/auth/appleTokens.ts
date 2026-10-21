import { importPKCS8, SignJWT } from 'jose';

import { seal, unseal } from '../crypto.ts';
import type { Deps } from '../deps.ts';

/**
 * Sign in with Apple token revocation. Apple requires an app that offers Sign in with Apple to
 * revoke the person's tokens when they delete their account, which removes the app from
 * "Sign in with Apple" in their Apple ID settings.
 *
 * At sign-in the app sends the authorization code with the identity token; the server swaps it
 * for a refresh token and keeps that, sealed with a key derived from SESSION_SECRET. Account
 * deletion revokes it. Neither step can fail a sign-in or a deletion: without the key, or when
 * Apple is unreachable, they log and carry on.
 */

/** A Sign in with Apple key (Certificates, Identifiers & Profiles, Keys) and who it is for. */
export interface AppleSignInKey {
  teamId: string;
  keyId: string;
  /** The .p8 file's contents (PKCS #8 PEM). */
  privateKey: string;
  /** The app's bundle id, which Apple calls the client id. */
  clientId: string;
}

const APPLE = 'https://appleid.apple.com';
/** Separates the sealing key for these tokens from any other use of SESSION_SECRET. */
export const APPLE_TOKEN_PURPOSE = 'apple-refresh-token-v1';

/** The client secret Apple's token endpoints expect: an ES256 JWT signed with the key, valid for 5 minutes. */
export async function appleClientSecret(key: AppleSignInKey, now: Date): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: key.keyId })
    .setIssuer(key.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .setAudience(APPLE)
    .setSubject(key.clientId)
    .sign(await importPKCS8(key.privateKey, 'ES256'));
}

function post(fetchFn: typeof fetch, path: string, form: Record<string, string>): Promise<Response> {
  return fetchFn(`${APPLE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(10_000),
  });
}

/** Swaps the authorization code from the app's Apple sign-in (single use, valid 5 minutes) for a refresh token. */
export async function appleRefreshToken(key: AppleSignInKey, code: string, now: Date, fetchFn: typeof fetch): Promise<string> {
  const res = await post(fetchFn, '/auth/token', {
    client_id: key.clientId,
    client_secret: await appleClientSecret(key, now),
    code,
    grant_type: 'authorization_code',
  });
  const body = (await res.json().catch(() => null)) as { refresh_token?: unknown; error?: unknown } | null;
  if (!res.ok) throw new Error(`Apple's token endpoint responded ${res.status}${body?.error ? ` (${String(body.error)})` : ''}`);
  if (typeof body?.refresh_token !== 'string' || !body.refresh_token) throw new Error('Apple returned no refresh token');
  return body.refresh_token;
}

/** Revokes a refresh token, which ends the app's Sign in with Apple authorisation for that person. */
export async function revokeAppleRefreshToken(key: AppleSignInKey, token: string, now: Date, fetchFn: typeof fetch): Promise<void> {
  const res = await post(fetchFn, '/auth/revoke', {
    client_id: key.clientId,
    client_secret: await appleClientSecret(key, now),
    token,
    token_type_hint: 'refresh_token',
  });
  if (!res.ok) throw new Error(`Apple's revoke endpoint responded ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
}

const info = (deps: Deps, message: string) => (deps.logInfo ?? console.log)(message);

/** After an Apple sign-in: keeps the refresh token so it can be revoked at deletion. Never throws. */
export async function keepAppleToken(deps: Deps, userId: string, code: string): Promise<void> {
  const key = deps.config.appleSignIn;
  if (!key) {
    info(deps, 'Sign in with Apple key not set (APPLE_TEAM_ID, APPLE_SIWA_KEY_ID, APPLE_SIWA_PRIVATE_KEY): Apple token not kept, so it cannot be revoked at deletion');
    return;
  }
  try {
    const now = deps.clock.now();
    const token = await appleRefreshToken(key, code, now, deps.fetch ?? fetch);
    await deps.sql.query(
      `INSERT INTO apple_token (user_id, refresh_token_enc, updated_at) VALUES ($1, $2, $3::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token_enc = EXCLUDED.refresh_token_enc, updated_at = EXCLUDED.updated_at`,
      [userId, await seal(deps.config.sessionSecret, APPLE_TOKEN_PURPOSE, token), now.toISOString()],
    );
  } catch (err) {
    // The person is signed in either way; a later sign-in tries again.
    (deps.logError ?? console.error)(err);
  }
}

/** Before deleting an account: revokes its Apple token, if it has one. Never throws, so it never blocks the deletion. */
export async function revokeAppleTokenFor(deps: Deps, userId: string): Promise<void> {
  try {
    const [row] = await deps.sql.query<{ auth_provider: string; refresh_token_enc: string | null }>(
      `SELECT u.auth_provider, t.refresh_token_enc
       FROM app_user u LEFT JOIN apple_token t ON t.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (!row?.refresh_token_enc) {
      if (row?.auth_provider === 'apple') info(deps, 'No Apple token kept for this account (it signed in before tokens were kept): nothing to revoke');
      return;
    }
    const key = deps.config.appleSignIn;
    if (!key) {
      info(deps, 'Sign in with Apple key not set (APPLE_TEAM_ID, APPLE_SIWA_KEY_ID, APPLE_SIWA_PRIVATE_KEY): Apple token not revoked');
      return;
    }
    const token = await unseal(deps.config.sessionSecret, APPLE_TOKEN_PURPOSE, row.refresh_token_enc);
    await revokeAppleRefreshToken(key, token, deps.clock.now(), deps.fetch ?? fetch);
  } catch (err) {
    (deps.logError ?? console.error)(err);
    await deps.alerts?.report('apple_revoke', err, 'Revoking a Sign in with Apple token at account deletion failed. The account was still deleted.');
  }
}
