import { jwtVerify, SignJWT } from 'jose';

/**
 * App sessions are our own HS256 JWTs, so sign-in does not depend on Supabase Auth or any
 * other provider once the account exists.
 */
const ISSUER = 'nightwatch';
const AUDIENCE = 'nightwatch-app';

const key = (secret: string) => new TextEncoder().encode(secret);

export async function signSession(
  userId: string,
  secret: string,
  now: Date,
  ttlDays: number,
): Promise<{ token: string; expiresAt: Date }> {
  const iat = Math.floor(now.getTime() / 1000);
  const exp = iat + ttlDays * 86_400;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(key(secret));
  return { token, expiresAt: new Date(exp * 1000) };
}

/** The user id in a valid session token; throws when invalid or expired at `now`. */
export async function verifySession(token: string, secret: string, now: Date): Promise<string> {
  const { payload } = await jwtVerify(token, key(secret), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['HS256'],
    currentDate: now,
  });
  if (!payload.sub) throw new Error('session has no subject');
  return payload.sub;
}
