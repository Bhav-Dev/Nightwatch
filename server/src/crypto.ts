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

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * An AES-256-GCM key derived from `secret` with HKDF. `purpose` gives each use its own key, so
 * a value sealed for one purpose cannot be opened as another.
 */
// The return type is left to inference: naming the global CryptoKey only typechecks when some
// other package happens to declare it, which CI's server-only install does not.
async function sealingKey(secret: string, purpose: string) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('nightwatch-seal'), info: encoder.encode(purpose) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts text for storage: "v1." then base64url of the 12-byte IV and the ciphertext. */
export async function seal(secret: string, purpose: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await sealingKey(secret, purpose);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(text)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv);
  out.set(cipher, iv.length);
  return `v1.${base64url(out)}`;
}

/** Reverses seal. Throws if the value was changed, sealed for another purpose, or with another secret. */
export async function unseal(secret: string, purpose: string, sealed: string): Promise<string> {
  const [version, body] = sealed.split('.');
  if (version !== 'v1' || !body) throw new Error('Unknown sealed value format');
  const bytes = fromBase64url(body);
  const key = await sealingKey(secret, purpose);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) }, key, bytes.subarray(12));
  return new TextDecoder().decode(plain);
}
