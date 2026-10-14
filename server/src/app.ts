import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { verifySession } from './auth/session.ts';
import type { AppEnv, Deps } from './deps.ts';
import { HttpError, unauthorized } from './errors.ts';
import { accountRoutes } from './routes/account.ts';
import { aggregateRoutes } from './routes/aggregates.ts';
import { authRoutes } from './routes/auth.ts';
import { catalogueRoutes } from './routes/catalogue.ts';
import { profileRoutes } from './routes/profile.ts';
import { subscriptionRoutes, webhookRoutes } from './routes/subscription.ts';
import { syncRoutes } from './routes/sync.ts';

/**
 * The HTTP API. Every dependency comes in through `deps`, so the same app runs under
 * @hono/node-server on a VPS, under Deno.serve on Supabase Edge, and in tests with fakes.
 */
export function createApp(deps: Deps) {
  const logError = deps.logError ?? ((err: unknown) => console.error(err));
  const root = new Hono<AppEnv>();
  const v1 = new Hono<AppEnv>();

  v1.use(
    '*',
    bodyLimit({
      maxSize: 4 * 1024 * 1024,
      onError: () => {
        throw new HttpError(413, 'too_large', 'Request body is too large. Sync fewer nights at a time.');
      },
    }),
  );

  // Public routes come first; Hono runs handlers in registration order, so the session
  // middleware below never sees them.
  v1.get('/health', (c) => c.json({ ok: true }));
  v1.route('/', authRoutes(deps));
  v1.route('/', webhookRoutes(deps));

  // Everything else needs a session. A token for a deleted account is refused even before expiry.
  v1.use('*', async (c, next) => {
    const header = c.req.header('Authorization') ?? '';
    const match = /^Bearer (.+)$/i.exec(header);
    if (!match) throw unauthorized();
    let userId: string;
    try {
      userId = await verifySession(match[1], deps.config.sessionSecret, deps.clock.now());
    } catch {
      throw unauthorized('Your session has expired. Sign in again.', 'invalid_session');
    }
    const [user] = await deps.sql.query('SELECT 1 FROM app_user WHERE id = $1', [userId]);
    if (!user) throw unauthorized('This account no longer exists.', 'invalid_session');
    c.set('userId', userId);
    await next();
  });

  v1.route('/', catalogueRoutes(deps));
  v1.route('/', syncRoutes(deps));
  v1.route('/', profileRoutes(deps));
  v1.route('/', aggregateRoutes(deps));
  v1.route('/', subscriptionRoutes(deps));
  v1.route('/', accountRoutes(deps));

  root.route(`${deps.config.basePath}/v1`, v1);

  root.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found.' } }, 404));
  root.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status, err.headers);
    }
    logError(err);
    return c.json({ error: { code: 'internal', message: 'Something went wrong. Try again later.' } }, 500);
  });
  return root;
}
