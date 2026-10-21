import { Hono } from 'hono';

import { revokeAppleTokenFor } from '../auth/appleTokens.ts';
import { hmacHex } from '../crypto.ts';
import type { AppEnv, Deps } from '../deps.ts';

export function accountRoutes(deps: Deps) {
  const { sql, clock, config } = deps;
  const r = new Hono<AppEnv>();

  /**
   * Deletes the account and everything synced (nights, logs, devices, profile, subscription
   * mirror, contribution rows, the kept Apple token) by cascade. Contributor ids go on the
   * exclusion list first; that list holds no user id, so it survives and the next aggregation
   * drops them. Published aggregates hold no per-person data, so nothing else needs removing.
   * Remedy suggestions hold no user id either, so they are found by the keys catalogue.ts files
   * them under: the contributor id, or the keyed hash of the user id.
   *
   * A Sign in with Apple account's token is revoked first, as Apple requires. That step never
   * blocks the deletion: a failure is logged and alerted.
   */
  r.delete('/account', async (c) => {
    const userId = c.get('userId');
    await revokeAppleTokenFor(deps, userId);
    const now = clock.now().toISOString();
    const hashedKey = `h:${await hmacHex(config.sessionSecret, `suggest:${userId}`)}`;
    await sql.transaction(async (tx) => {
      await tx.query(
        `DELETE FROM catalogue_suggestion
         WHERE submitter_key = $2 OR submitter_key IN (SELECT 'c:' || contributor_id::text FROM contribution WHERE user_id = $1)`,
        [userId, hashedKey],
      );
      await tx.query(
        `INSERT INTO contributor_exclusion (contributor_id, reason, excluded_at)
         SELECT contributor_id, 'account_deleted', $2::timestamptz FROM contribution WHERE user_id = $1
         ON CONFLICT (contributor_id) DO UPDATE SET reason = 'account_deleted'`,
        [userId, now],
      );
      await tx.query(
        `DELETE FROM magic_link WHERE email IN (SELECT email FROM app_user WHERE id = $1 AND email IS NOT NULL)`,
        [userId],
      );
      await tx.query('DELETE FROM app_user WHERE id = $1', [userId]);
    });
    return c.body(null, 204);
  });

  return r;
}
