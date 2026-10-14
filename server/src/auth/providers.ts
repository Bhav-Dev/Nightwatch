import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Apple and Google ID token checks. The key sets are injected so tests can sign tokens with
 * a locally generated key pair; production uses the providers' published JWKS (cached by
 * jose for the life of the process or isolate).
 */
export interface JwksSet {
  apple: JWTVerifyGetKey;
  google: JWTVerifyGetKey;
}

export function remoteJwks(): JwksSet {
  return {
    apple: createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys')),
    google: createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs')),
  };
}

export interface VerifiedIdentity {
  subject: string;
  email: string | null;
}

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

async function verify(
  token: string,
  keys: JWTVerifyGetKey,
  issuer: string | string[],
  audiences: string[],
  now: Date,
): Promise<VerifiedIdentity> {
  const { payload } = await jwtVerify(token, keys, {
    issuer,
    audience: audiences,
    algorithms: ['RS256'],
    currentDate: now,
  });
  if (!payload.sub) throw new Error('token has no subject');
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  return { subject: payload.sub, email };
}

export const verifyApple = (token: string, keys: JWTVerifyGetKey, audiences: string[], now: Date) =>
  verify(token, keys, APPLE_ISSUER, audiences, now);

export const verifyGoogle = (token: string, keys: JWTVerifyGetKey, audiences: string[], now: Date) =>
  verify(token, keys, GOOGLE_ISSUERS, audiences, now);
