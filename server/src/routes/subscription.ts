import { Hono } from 'hono';

import { PAID_ENTITLEMENT, type SubscriptionResponse } from '../../../shared/api.ts';
import { timingSafeEqual } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';
import { badRequest, unauthorized } from '../errors.ts';
import { iso } from './util.ts';

/** The fields of a RevenueCat webhook event that we use. */
interface RevenueCatEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  new_product_id?: string;
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number;
}

type Status = 'active' | 'cancelled' | 'billing_issue' | 'expired';

/** Event type → (still entitled?, status). CANCELLATION and BILLING_ISSUE run to expiry. */
const TRANSITIONS: Record<string, { active: boolean; status: Status }> = {
  INITIAL_PURCHASE: { active: true, status: 'active' },
  RENEWAL: { active: true, status: 'active' },
  PRODUCT_CHANGE: { active: true, status: 'active' },
  UNCANCELLATION: { active: true, status: 'active' },
  CANCELLATION: { active: true, status: 'cancelled' },
  BILLING_ISSUE: { active: true, status: 'billing_issue' },
  EXPIRATION: { active: false, status: 'expired' },
};

export function planFor(productId: string | null | undefined): 'yearly' | 'monthly' | null {
  const p = (productId ?? '').toLowerCase();
  if (p.includes('year') || p.includes('annual')) return 'yearly';
  if (p.includes('month')) return 'monthly';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function subscriptionRoutes(deps: Deps) {
  const { sql, clock } = deps;
  const r = new Hono<AppEnv>();

  r.get('/subscription', async (c) => {
    const [row] = await sql.query<{ active: boolean; plan: 'yearly' | 'monthly' | null; expires_at: Date | null }>(
      `SELECT active AND (expires_at IS NULL OR expires_at > $2::timestamptz) AS active, plan, expires_at
       FROM subscription WHERE user_id = $1`,
      [c.get('userId'), clock.now().toISOString()],
    );
    const res: SubscriptionResponse = row
      ? { active: row.active, plan: row.active ? row.plan : null, expires_at: iso(row.expires_at) }
      : { active: false, plan: null, expires_at: null };
    return c.json(res);
  });

  return r;
}

/**
 * RevenueCat webhook. Authenticated by the shared Authorization header configured in the
 * RevenueCat dashboard (not a session). The app sets RevenueCat's appUserID to our user id.
 * Always answers 200 for events we choose to ignore, so RevenueCat does not retry them.
 */
export function webhookRoutes(deps: Deps) {
  const { sql, clock, config } = deps;
  const r = new Hono<AppEnv>();

  r.post('/subscription/webhook', async (c) => {
    const expected = config.revenueCatWebhookAuth;
    const given = c.req.header('Authorization') ?? '';
    if (!expected || !timingSafeEqual(given, expected)) throw unauthorized('Webhook authorisation failed.');

    let body: { event?: RevenueCatEvent };
    try {
      body = await c.req.json();
    } catch {
      throw badRequest('Body must be JSON.', 'invalid_json');
    }
    const ev = body.event;
    if (!ev || typeof ev.type !== 'string') throw badRequest('Missing event.');
    const transition = TRANSITIONS[ev.type];
    if (!transition) return c.json({ ignored: 'event type' });

    const entitlements = ev.entitlement_ids ?? (ev.entitlement_id ? [ev.entitlement_id] : null);
    if (entitlements && !entitlements.includes(PAID_ENTITLEMENT)) return c.json({ ignored: 'entitlement' });

    // Purchases made before sign-in may carry an anonymous id, with ours among the aliases.
    const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])].filter(
      (id): id is string => typeof id === 'string' && UUID.test(id),
    );
    const [user] = candidates.length
      ? await sql.query<{ id: string }>(
          `SELECT id::text AS id FROM app_user WHERE id::text IN (SELECT jsonb_array_elements_text($1::text::jsonb)) LIMIT 1`,
          [JSON.stringify(candidates.map((s) => s.toLowerCase()))],
        )
      : [];
    if (!user) return c.json({ ignored: 'unknown user' });

    const eventAt = new Date(ev.event_timestamp_ms ?? clock.now().getTime()).toISOString();
    const expiresAt = ev.expiration_at_ms ? new Date(ev.expiration_at_ms).toISOString() : null;
    const productId = ev.type === 'PRODUCT_CHANGE' ? (ev.new_product_id ?? ev.product_id) : ev.product_id;

    // Events can arrive late or twice: ignore one older than the last applied, or the same id.
    await sql.query(
      `INSERT INTO subscription (user_id, active, status, plan, product_id, expires_at, last_event_id, last_event_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8::timestamptz, $9::timestamptz)
       ON CONFLICT (user_id) DO UPDATE SET
         active = EXCLUDED.active, status = EXCLUDED.status,
         plan = COALESCE(EXCLUDED.plan, subscription.plan),
         product_id = COALESCE(EXCLUDED.product_id, subscription.product_id),
         expires_at = COALESCE(EXCLUDED.expires_at, subscription.expires_at),
         last_event_id = EXCLUDED.last_event_id, last_event_at = EXCLUDED.last_event_at,
         updated_at = EXCLUDED.updated_at
       WHERE (subscription.last_event_id IS DISTINCT FROM EXCLUDED.last_event_id OR EXCLUDED.last_event_id IS NULL)
         AND (subscription.last_event_at IS NULL OR EXCLUDED.last_event_at >= subscription.last_event_at)`,
      [
        user.id,
        transition.active,
        transition.status,
        planFor(productId),
        productId ?? null,
        expiresAt,
        ev.id ?? null,
        eventAt,
        clock.now().toISOString(),
      ],
    );
    return c.json({ ok: true });
  });

  return r;
}
