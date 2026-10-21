import type { AmazonTags } from '../../shared/amazon.ts';
import type { AppleSignInKey } from './auth/appleTokens.ts';

export interface Limits {
  /** POST /sync/nights per device (and GET per user) per hour. */
  syncPerHour: number;
  /** GET /aggregates* per user per hour. */
  aggregatesPerHour: number;
  /** Magic links per email address per hour. */
  magicLinksPerHour: number;
}

export interface Config {
  /** Prefix before /v1, e.g. "/api" on Supabase where functions are served under /<name>/. */
  basePath: string;
  sessionSecret: string;
  sessionTtlDays: number;
  /**
   * Magic links point at `${appLinkBase}/auth?token=...`. In production this is the website
   * (APP_LINK_BASE=https://<site>), whose /auth page opens the app: many mail apps will not open
   * a nightwatch:// link. Unset, links go straight to nightwatch://auth.
   */
  appLinkBase: string;
  magicLinkTtlMinutes: number;
  appleAudiences: string[];
  /**
   * The Sign in with Apple key, for keeping each Apple account's refresh token and revoking it
   * when the account is deleted. Null when not set: sign-in still works, nothing is revoked.
   */
  appleSignIn: AppleSignInKey | null;
  googleAudiences: string[];
  amazonTags: AmazonTags;
  revenueCatWebhookAuth: string | null;
  /** Shared secret for triggering the aggregate function over HTTP (Supabase). */
  aggregateSecret: string | null;
  /** Contact sent to MET Norway with every forecast request (their terms ask for one). */
  weatherContact: string;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = { syncPerHour: 60, aggregatesPerHour: 120, magicLinksPerHour: 5 };

type Env = Record<string, string | undefined>;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * APP_LINK_BASE without trailing slashes, or nightwatch:/ by default. A bare scheme keeps one
 * slash so links read nightwatch://auth?token=..., not nightwatch:/auth.
 */
function appLinkBase(env: Env): string {
  const base = (env.APP_LINK_BASE?.trim() || 'nightwatch://').replace(/\/+$/, '');
  return base.endsWith(':') ? `${base}/` : base;
}

/**
 * APPLE_TEAM_ID, APPLE_SIWA_KEY_ID and APPLE_SIWA_PRIVATE_KEY (the .p8 contents; "\n" escapes are
 * accepted for hosts that store one line), for APPLE_CLIENT_ID or else the first Apple audience.
 */
function appleSignInKey(env: Env): AppleSignInKey | null {
  const teamId = env.APPLE_TEAM_ID?.trim();
  const keyId = env.APPLE_SIWA_KEY_ID?.trim();
  const privateKey = env.APPLE_SIWA_PRIVATE_KEY?.replace(/\\n/g, '\n').trim();
  const clientId = env.APPLE_CLIENT_ID?.trim() || list(env.APPLE_AUDIENCES)[0];
  return teamId && keyId && privateKey && clientId ? { teamId, keyId, privateKey, clientId } : null;
}

/** Reads configuration from environment variables (see README for the table). */
export function loadConfig(env: Env): Config {
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  let amazonTags: AmazonTags = {};
  if (env.AMAZON_TAGS) {
    try {
      amazonTags = JSON.parse(env.AMAZON_TAGS) as AmazonTags;
    } catch {
      throw new Error('AMAZON_TAGS must be JSON, for example {"GB":"nightwatch-21"}');
    }
  }
  return {
    basePath: (env.API_BASE_PATH ?? '').replace(/\/$/, ''),
    sessionSecret,
    sessionTtlDays: 90,
    appLinkBase: appLinkBase(env),
    magicLinkTtlMinutes: 15,
    appleAudiences: list(env.APPLE_AUDIENCES),
    appleSignIn: appleSignInKey(env),
    googleAudiences: list(env.GOOGLE_AUDIENCES),
    amazonTags,
    revenueCatWebhookAuth: env.REVENUECAT_WEBHOOK_AUTH || null,
    aggregateSecret: env.AGGREGATE_SECRET || null,
    weatherContact: env.WEATHER_CONTACT || 'https://github.com/Bhav-Dev/Nightwatch',
    limits: DEFAULT_LIMITS,
  };
}
