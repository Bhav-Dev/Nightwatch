import { describe, expect, it } from 'vitest';

import { planFor } from '../src/routes/subscription.ts';
import { harness, WEBHOOK_AUTH } from './helpers.ts';

const T0 = Date.parse('2026-10-14T04:00:00Z');
const DAY = 86_400_000;

describe('subscription', () => {
  it('needs the RevenueCat authorization header', async () => {
    const h = await harness();
    const event = { type: 'INITIAL_PURCHASE', app_user_id: crypto.randomUUID() };
    expect((await h.call('POST', '/v1/subscription/webhook', { body: { event } })).status).toBe(401);
    const wrong = await h.call('POST', '/v1/subscription/webhook', { body: { event }, headers: { Authorization: 'Bearer nope' } });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('unauthorized');
    h.deps.config.revenueCatWebhookAuth = null;
    const unset = await h.call('POST', '/v1/subscription/webhook', { body: { event }, headers: { Authorization: WEBHOOK_AUTH } });
    expect(unset.status).toBe(401);
  });

  it('follows purchase, cancellation, expiry and renewal', async () => {
    const h = await harness();
    const { token, userId } = await h.user();
    const sub = async () => (await h.call('GET', '/v1/subscription', { token })).body;
    let at = T0;
    const send = async (type: string, extra: Record<string, unknown> = {}) => {
      at += 1000;
      const res = await h.call('POST', '/v1/subscription/webhook', {
        headers: { Authorization: WEBHOOK_AUTH },
        body: {
          api_version: '1.0',
          event: {
            id: crypto.randomUUID(),
            type,
            app_user_id: userId,
            product_id: 'nightwatch_insight_monthly',
            entitlement_ids: ['insight'],
            expiration_at_ms: T0 + 30 * DAY,
            event_timestamp_ms: at,
            ...extra,
          },
        },
      });
      expect(res.status).toBe(200);
      return res.body;
    };

    expect(await sub()).toEqual({ active: false, plan: null, expires_at: null });
    await send('INITIAL_PURCHASE');
    expect(await sub()).toEqual({ active: true, plan: 'monthly', expires_at: '2026-11-13T04:00:00.000Z' });

    await send('BILLING_ISSUE');
    expect((await sub()).active).toBe(true);

    // Cancelled: still active until the period ends.
    await send('CANCELLATION');
    expect((await sub()).active).toBe(true);
    h.clock.advance(31 * DAY);
    expect((await sub()).active).toBe(false);

    await send('UNCANCELLATION', { expiration_at_ms: T0 + 60 * DAY });
    expect((await sub()).active).toBe(true);

    await send('EXPIRATION');
    expect(await sub()).toMatchObject({ active: false, plan: null });

    await send('RENEWAL', { expiration_at_ms: T0 + 90 * DAY });
    expect((await sub()).active).toBe(true);

    await send('PRODUCT_CHANGE', { new_product_id: 'nightwatch_insight_annual', expiration_at_ms: T0 + 400 * DAY });
    expect(await sub()).toEqual({ active: true, plan: 'yearly', expires_at: '2027-11-18T04:00:00.000Z' });
  });

  it('ignores late, duplicate, foreign and unknown events', async () => {
    const h = await harness();
    const { token, userId } = await h.user();
    const post = (event: Record<string, unknown>) =>
      h.call('POST', '/v1/subscription/webhook', {
        headers: { Authorization: WEBHOOK_AUTH },
        body: { event: { app_user_id: userId, entitlement_ids: ['insight'], product_id: 'yearly', ...event } },
      });
    await post({ id: 'e2', type: 'RENEWAL', event_timestamp_ms: T0, expiration_at_ms: T0 + 365 * DAY });
    // An expiration from before the renewal arrives late.
    await post({ id: 'e1', type: 'EXPIRATION', event_timestamp_ms: T0 - DAY, expiration_at_ms: T0 - DAY });
    expect((await h.call('GET', '/v1/subscription', { token })).body.active).toBe(true);
    // Another entitlement, an unknown user, an anonymous id, an event we do not handle.
    expect((await post({ id: 'e3', type: 'EXPIRATION', entitlement_ids: ['other'], event_timestamp_ms: T0 + 1 })).body).toEqual({
      ignored: 'entitlement',
    });
    expect((await post({ id: 'e4', type: 'EXPIRATION', app_user_id: crypto.randomUUID(), event_timestamp_ms: T0 + 1 })).body).toEqual({
      ignored: 'unknown user',
    });
    expect((await post({ id: 'e5', type: 'EXPIRATION', app_user_id: '$RCAnonymousID:abc', event_timestamp_ms: T0 + 1 })).body).toEqual({
      ignored: 'unknown user',
    });
    expect((await post({ id: 'e6', type: 'TRANSFER', event_timestamp_ms: T0 + 1 })).body).toEqual({ ignored: 'event type' });
    expect((await h.call('GET', '/v1/subscription', { token })).body.active).toBe(true);

    // Our id among the aliases of an anonymous purchase still matches.
    await post({ id: 'e7', type: 'EXPIRATION', app_user_id: '$RCAnonymousID:abc', aliases: [userId], event_timestamp_ms: T0 + 2 });
    expect((await h.call('GET', '/v1/subscription', { token })).body.active).toBe(false);
  });

  it('reads the plan from the product id', () => {
    expect(planFor('nightwatch.insight.yearly')).toBe('yearly');
    expect(planFor('insight_annual_2026')).toBe('yearly');
    expect(planFor('insight_monthly')).toBe('monthly');
    expect(planFor('lifetime')).toBeNull();
  });
});
