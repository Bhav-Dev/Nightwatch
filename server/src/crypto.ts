/**
 * Small helpers over Web Crypto, which Node 22 and Deno both provide as globalThis.crypto.
 * Nothing here uses node:crypto or Buffer, so the module runs on Supabase Edge as-is.
 */

const encoder = new TextEncoder();

export const randomId = () => crypto.randomUUID();

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A URL-safe random token of `bytes` random bytes. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(text)));
}

export async function hmacHex(secret: string, text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(text)));
}

/** Compares secrets without leaking where they differ through timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
