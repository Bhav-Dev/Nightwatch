import type { AmazonTags } from '../../shared/amazon.ts';

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
  /** Magic links point at `${appLinkBase}/auth?token=...`. */
  appLinkBase: string;
  magicLinkTtlMinutes: number;
  appleAudiences: string[];
  googleAudiences: string[];
  amazonTags: AmazonTags;
  revenueCatWebhookAuth: string | null;
  /** Shared secret for triggering the aggregate function over HTTP (Supabase). */
  aggregateSecret: string | null;
  limits: Limits;
}

export const DEFAULT_LIMITS: Limits = { syncPerHour: 60, aggregatesPerHour: 120, magicLinksPerHour: 5 };

type Env = Record<string, string | undefined>;

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

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
    appLinkBase: (env.APP_LINK_BASE ?? 'nightwatch:/').replace(/\/$/, ''),
    magicLinkTtlMinutes: 15,
    appleAudiences: list(env.APPLE_AUDIENCES),
    googleAudiences: list(env.GOOGLE_AUDIENCES),
    amazonTags,
    revenueCatWebhookAuth: env.REVENUECAT_WEBHOOK_AUTH || null,
    aggregateSecret: env.AGGREGATE_SECRET || null,
    limits: DEFAULT_LIMITS,
  };
}
