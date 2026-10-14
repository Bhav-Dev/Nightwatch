import { Hono } from 'hono';

import type { AppEnv, Deps } from '../deps.ts';

export function accountRoutes(deps: Deps) {
  const { sql, clock } = deps;
  const r = new Hono<AppEnv>();

  /**
   * Deletes the account and everything synced (nights, logs, devices, profile, subscription
   * mirror, contribution rows) by cascade. Contributor ids go on the exclusion list first;
   * that list holds no user id, so it survives and the next aggregation drops them.
   * Published aggregates hold no per-person data, so nothing else needs removing.
   */
  r.delete('/account', async (c) => {
    const userId = c.get('userId');
    const now = clock.now().toISOString();
    await sql.transaction(async (tx) => {
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
