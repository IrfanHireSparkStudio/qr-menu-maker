/**
 * QR Menu Maker — Cloudflare Workers entry point.
 *
 * Middleware order matters:
 *   1. securityHeaders (CSP + hardening headers on every response)
 *   2. authMiddleware (loads the session user, if any, and the owner's
 *      restaurant for /owner/* routes)
 *   3. role guards on /admin/* and /owner/* (checked after auth)
 */

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import type { App, Env, RestaurantRow, UserRow, Vars } from './types';
import { getRestaurantByOwner } from './db';
import { getSessionUser, securityHeaders } from './security';
import { getCookie, registerAuthRoutes } from './auth';
import { registerAdminRoutes } from './admin';
import { registerOwnerRoutes } from './owner';
import { registerPublicRoutes } from './public';
import { layout } from './html';

const app: App = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('*', securityHeaders);

app.use('*', async (c, next) => {
  const token = getCookie(c.req.header('Cookie') ?? '', 'session');
  const user: UserRow | null = await getSessionUser(c.env.DB, token);
  c.set('user', user);
  let restaurant: RestaurantRow | null = null;
  if (user && user.role === 'owner') {
    restaurant = await getRestaurantByOwner(c.env.DB, user.id);
  }
  c.set('restaurant', restaurant);
  await next();
});

function requireRole(role: 'admin' | 'owner') {
  return async (c: Context<{ Bindings: Env; Variables: Vars }>, next: Next) => {
    const user = c.get('user');
    if (!user || user.role !== role) {
      return c.redirect('/login');
    }
    await next();
  };
}

// Role guards. '/owner' itself needs guarding too ('/owner/*' alone does not match it).
app.use('/admin', requireRole('admin'));
app.use('/admin/*', requireRole('admin'));
app.use('/owner', requireRole('owner'));
app.use('/owner/*', requireRole('owner'));

registerAuthRoutes(app);
registerAdminRoutes(app);
registerOwnerRoutes(app);
registerPublicRoutes(app);

app.notFound((c) =>
  c.html(layout({ title: 'Not found', body: '<h1>Page not found</h1><p><a href="/">Back to home</a></p>' }), 404),
);

app.onError((err, c) => {
  console.error(err);
  return c.html(
    layout({
      title: 'Something went wrong',
      body: '<h1>Something went wrong</h1><p>Please try again. If it keeps happening, tell the admin.</p>',
    }),
    500,
  );
});

export default app;
