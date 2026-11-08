/**
 * Auth routes: login / logout, first-admin setup, owner password setup.
 *
 * Onboarding is admin-invited only in V1: the admin creates the owner
 * account and a one-time setup link (72h). There is no public self-signup
 * form. The owner opens the link, sets a password, then logs in.
 */

import type { App } from './types';
import { countAdmins, getActiveSetupToken, getSetupToken, getUserByEmail } from './db';
import {
  clearLoginAttempts,
  clearSessionCookie,
  clientIp,
  createSession,
  destroySession,
  hashPassword,
  isLoginLocked,
  originOk,
  randomToken,
  recordLoginAttempt,
  sessionCookie,
  verifyPassword,
  verifyTurnstile,
} from './security';
import { esc, formError, hiddenField, layout, notice, submitButton, textField } from './html';
import { cleanText, isValidEmail } from './util';

const SETUP_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 72 hours

function loginForm(error = '', email = ''): string {
  return layout({
    title: 'Owner login',
    body: `<h1>Owner login</h1>
${error ? formError(error) : ''}
<form method="post" action="/login">
${textField('Email', 'email', email, 'required type="email" autocomplete="username"')}
<label class="field"><span>Password</span>
<input type="password" name="password" required autocomplete="current-password"></label>
${submitButton('Log in')}
</form>
<p class="muted">New owner? Use the password-setup link your admin sent you on WhatsApp.</p>`,
  });
}

export function registerAuthRoutes(app: App): void {
  // ---- Login ----
  app.get('/login', (c) => {
    const done = c.req.query('setup') === '1';
    return c.html(
      layout({
        title: 'Owner login',
        body: `<h1>Owner login</h1>
${done ? notice('ok', 'Password set. You can now log in.') : ''}
<form method="post" action="/login">
${textField('Email', 'email', '', 'required type="email" autocomplete="username"')}
<label class="field"><span>Password</span>
<input type="password" name="password" required autocomplete="current-password"></label>
${submitButton('Log in')}
</form>
<p class="muted">New owner? Use the password-setup link your admin sent you on WhatsApp.</p>`,
      }),
    );
  });

  app.post('/login', async (c) => {
    if (!originOk(c)) return c.html(loginForm('Request rejected (origin check).', ''), 403);
    const form = await c.req.formData();
    const email = cleanText(form.get('email'), 254).toLowerCase();
    const password = String(form.get('password') ?? '');
    if (!isValidEmail(email) || !password) {
      return c.html(loginForm('Enter a valid email and password.', email), 400);
    }
    if (await isLoginLocked(c.env.DB, email)) {
      return c.html(
        loginForm('Too many failed attempts. Wait 15 minutes and try again.', email),
        429,
      );
    }
    const user = await getUserByEmail(c.env.DB, email);
    const ok = user !== null && (await verifyPassword(password, user.password_hash));
    if (!ok || user === null) {
      await recordLoginAttempt(c.env.DB, email, clientIp(c));
      return c.html(loginForm('Wrong email or password.', email), 401);
    }
    await clearLoginAttempts(c.env.DB, email);
    const token = await createSession(c.env.DB, user.id);
    const headers = new Headers();
    headers.append('Set-Cookie', sessionCookie(token, c.req.url, 7 * 24 * 60 * 60));
    headers.append('Location', user.role === 'admin' ? '/admin' : '/owner');
    return new Response(null, { status: 302, headers });
  });

  // ---- Logout ----
  app.post('/logout', async (c) => {
    const token = getCookie(c.req.header('Cookie') ?? '', 'session');
    await destroySession(c.env.DB, token);
    const headers = new Headers();
    headers.append('Set-Cookie', clearSessionCookie());
    headers.append('Location', '/');
    return new Response(null, { status: 302, headers });
  });

  // ---- First-admin setup (protected by the SETUP_TOKEN secret) ----
  app.get('/admin-setup', async (c) => {
    if (c.req.query('token') !== c.env.SETUP_TOKEN || !c.env.SETUP_TOKEN) {
      return c.html(layout({ title: 'Not found', body: '<h1>Not found</h1>' }), 404);
    }
    if ((await countAdmins(c.env.DB)) > 0) {
      return c.html(
        layout({ title: 'Setup done', body: '<h1>Setup already done</h1><p>An admin account already exists.</p>' }),
        403,
      );
    }
    return c.html(
      layout({
        title: 'Create admin account',
        body: `<h1>Create the admin account</h1>
<p class="muted">One-time setup. After this page is used, it stops working.</p>
<form method="post" action="/admin-setup?token=${esc(c.req.query('token') ?? '')}">
${textField('Your name', 'name', '', 'required maxlength="100" autocomplete="name"')}
${textField('Email', 'email', '', 'required type="email" autocomplete="username"')}
<label class="field"><span>Password (at least 10 characters)</span>
<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
<label class="field"><span>Repeat password</span>
<input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
${submitButton('Create admin account')}
</form>`,
      }),
    );
  });

  app.post('/admin-setup', async (c) => {
    if (c.req.query('token') !== c.env.SETUP_TOKEN || !c.env.SETUP_TOKEN) {
      return c.html(layout({ title: 'Not found', body: '<h1>Not found</h1>' }), 404);
    }
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    if ((await countAdmins(c.env.DB)) > 0) return c.text('Setup already done.', 403);
    const form = await c.req.formData();
    const name = cleanText(form.get('name'), 100);
    const email = cleanText(form.get('email'), 254).toLowerCase();
    const password = String(form.get('password') ?? '');
    const password2 = String(form.get('password2') ?? '');
    if (!name || !isValidEmail(email) || password.length < 10 || password !== password2) {
      return c.html(
        layout({
          title: 'Create admin account',
          body: `<h1>Create the admin account</h1>${formError(
            'Check the form: a name, a valid email, and matching passwords of at least 10 characters.',
          )}`,
        }),
        400,
      );
    }
    const hash = await hashPassword(password);
    await c.env.DB.prepare(
      "INSERT INTO users (email, password_hash, role, name, created_at) VALUES (?, ?, 'admin', ?, ?)",
    )
      .bind(email, hash, name, Date.now())
      .run();
    return c.html(
      layout({
        title: 'Admin created',
        body: `<h1>Admin account created</h1>${notice('ok', 'You can now log in.')}<p><a class="btn primary" href="/login">Go to login</a></p>`,
      }),
    );
  });

  // ---- Owner password setup (invite link from the admin) ----
  app.get('/setup', async (c) => {
    const token = c.req.query('token') ?? '';
    const row = await getSetupToken(c.env.DB, token);
    if (!row || row.used_at !== null || row.expires_at <= Date.now()) {
      return c.html(
        layout({
          title: 'Link not valid',
          body: '<h1>This setup link is not valid</h1><p>It may have expired or already been used. Ask your admin for a new link.</p>',
        }),
        400,
      );
    }
    const turnstileOn = Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY);
    return c.html(
      layout({
        title: 'Set your password',
        body: `<h1>Set your password</h1>
<p class="muted">Choose a password of at least 10 characters. This link works once and expires after 72 hours.</p>
<form method="post" action="/setup?token=${esc(token)}">
<label class="field"><span>New password</span>
<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
<label class="field"><span>Repeat password</span>
<input type="password" name="password2" required minlength="10" autocomplete="new-password"></label>
${turnstileOn ? '<div class="cf-turnstile" data-sitekey="' + esc(c.env.TURNSTILE_SITE_KEY ?? '') + '"></div>' : ''}
${submitButton('Set password and continue')}
</form>`,
        extraHead: turnstileOn
          ? '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>'
          : undefined,
      }),
    );
  });

  app.post('/setup', async (c) => {
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const token = c.req.query('token') ?? '';
    const row = await getSetupToken(c.env.DB, token);
    if (!row || row.used_at !== null || row.expires_at <= Date.now()) {
      return c.html(
        layout({
          title: 'Link not valid',
          body: '<h1>This setup link is not valid</h1><p>It may have expired or already been used. Ask your admin for a new link.</p>',
        }),
        400,
      );
    }
    const form = await c.req.formData();
    const password = String(form.get('password') ?? '');
    const password2 = String(form.get('password2') ?? '');
    const turnstileOk = await verifyTurnstile(
      c.env,
      String(form.get('cf-turnstile-response') ?? ''),
      clientIp(c),
    );
    if (!turnstileOk) {
      return c.text('Security check failed. Try again.', 403);
    }
    if (password.length < 10 || password !== password2) {
      return c.html(
        layout({
          title: 'Set your password',
          body: `<h1>Set your password</h1>${formError('Passwords must match and be at least 10 characters.')}`,
        }),
        400,
      );
    }
    const hash = await hashPassword(password);
    await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(hash, row.user_id).run();
    await c.env.DB.prepare('UPDATE setup_tokens SET used_at = ? WHERE id = ?')
      .bind(Date.now(), row.id)
      .run();
    const headers = new Headers();
    headers.append('Location', '/login?setup=1');
    return new Response(null, { status: 302, headers });
  });
}

/** Read one cookie value from a Cookie header. Exported for reuse in index.ts. */
export function getCookie(header: string, name: string): string | undefined {
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Create a fresh one-time setup token for a user (used by the admin routes). */
export async function createSetupToken(db: D1Database, userId: number): Promise<string> {
  const token = randomToken(32);
  await db
    .prepare('INSERT INTO setup_tokens (user_id, token, expires_at, used_at) VALUES (?, ?, ?, NULL)')
    .bind(userId, token, Date.now() + SETUP_TOKEN_TTL_MS)
    .run();
  return token;
}

/** Re-exported so admin.ts can show the active link without a second import path. */
export { getActiveSetupToken };
