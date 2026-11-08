/**
 * Admin routes: manage owners and restaurants.
 *
 * The admin creates an owner account together with its restaurant, then
 * copies the one-time password-setup link and sends it to the owner on
 * WhatsApp manually. The admin also flips the Free/Pro plan by hand
 * (there is no payment integration in V1).
 */

import type { App } from './types';
import { getActiveSetupToken } from './db';
import { createSetupToken } from './auth';
import { originOk, randomToken } from './security';
import { esc, formError, hiddenField, layout, notice, submitButton, textField } from './html';
import { cleanText, isValidEmail, isValidSlug } from './util';

interface AdminRow {
  id: number;
  name: string;
  slug: string;
  owner_id: number;
  owner_email: string;
  owner_name: string | null;
  password_hash: string;
  plan: string;
  item_count: number;
}

export function registerAdminRoutes(app: App): void {
  // ---- Admin home: all restaurants ----
  app.get('/admin', async (c) => {
    const res = await c.env.DB.prepare(
      `SELECT r.*, u.email AS owner_email, u.name AS owner_name, u.password_hash,
              (SELECT COUNT(*) FROM items i WHERE i.restaurant_id = r.id) AS item_count
       FROM restaurants r JOIN users u ON u.id = r.owner_id
       ORDER BY r.id DESC`,
    ).all<AdminRow>();
    const rows = res.results ?? [];
    const created = c.req.query('created') === '1';
    const planSaved = c.req.query('plan') === '1';
    const origin = new URL(c.req.url).origin;

    let cards = '';
    for (const r of rows) {
      const needsSetup = r.password_hash.startsWith('!');
      const token = needsSetup ? await getActiveSetupToken(c.env.DB, r.owner_id) : null;
      const setupBox = needsSetup
        ? token
          ? `<p><strong>Setup link (send on WhatsApp):</strong><br>
               <code>${esc(origin)}/setup?token=${esc(token.token)}</code>
               <button class="btn small" type="button" data-copy="${esc(origin)}/setup?token=${esc(token.token)}">Copy link</button></p>`
          : `<p class="muted">No active setup link.</p>
             <form method="post" action="/admin/owners/${r.owner_id}/setup-link">
               <button class="btn small" type="submit">Generate new setup link</button>
             </form>`
        : `<p class="muted">Owner has set a password.</p>`;
      cards += `<article class="card">
<h2>${esc(r.name)}</h2>
<p class="muted">${esc(r.slug)} · ${esc(r.owner_name ?? '')} (${esc(r.owner_email)})</p>
<p>Plan: <strong>${esc(r.plan)}</strong> · Items: <strong>${r.item_count}</strong>${r.plan === 'free' ? ' / 25' : ' (unlimited)'}</p>
<p><a href="/r/${esc(r.slug)}" target="_blank" rel="noopener">View public menu</a></p>
${setupBox}
<form method="post" action="/admin/owners/${r.owner_id}/plan" class="inline-form">
  <label>Plan
    <select name="plan">
      <option value="free"${r.plan === 'free' ? ' selected' : ''}>Free (25 items)</option>
      <option value="pro"${r.plan === 'pro' ? ' selected' : ''}>Pro (unlimited)</option>
    </select>
  </label>
  <button class="btn small" type="submit">Save plan</button>
</form>
</article>`;
    }

    return c.html(
      layout({
        title: 'Admin',
        body: `<h1>Admin</h1>
${created ? notice('ok', 'Owner created. Copy the setup link below and send it to the owner on WhatsApp.') : ''}
${planSaved ? notice('ok', 'Plan saved.') : ''}
<p><a class="btn primary" href="/admin/owners/new">Create new owner + restaurant</a></p>
${cards || '<p class="muted">No restaurants yet.</p>'}
<form method="post" action="/logout" class="inline-form"><button class="btn" type="submit">Log out</button></form>`,
      }),
    );
  });

  // ---- Create owner + restaurant ----
  app.get('/admin/owners/new', (c) => {
    return c.html(
      layout({
        title: 'Create owner',
        body: `<h1>Create owner + restaurant</h1>
<p class="muted">The owner gets a one-time password-setup link. You send it to them on WhatsApp yourself.</p>
<form method="post" action="/admin/owners/new">
${textField('Owner name', 'owner_name', '', 'required maxlength="100"')}
${textField('Owner email', 'owner_email', '', 'required type="email" maxlength="254"')}
${textField('Restaurant name', 'restaurant_name', '', 'required maxlength="120"')}
${textField('Restaurant slug (public URL, never changes)', 'slug', '', 'required maxlength="64" pattern="[a-z0-9][a-z0-9-]{1,62}" title="Lowercase letters, digits and hyphens only"')}
<p class="muted"><strong>Warning:</strong> the slug becomes the public menu URL and the QR code link. It can never be changed after this — pick it carefully.</p>
${submitButton('Create owner')}
</form>`,
      }),
    );
  });

  app.post('/admin/owners/new', async (c) => {
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const form = await c.req.formData();
    const ownerName = cleanText(form.get('owner_name'), 100);
    const ownerEmail = cleanText(form.get('owner_email'), 254).toLowerCase();
    const restaurantName = cleanText(form.get('restaurant_name'), 120);
    const slug = cleanText(form.get('slug'), 64).toLowerCase();
    let error = '';
    if (!ownerName || !isValidEmail(ownerEmail) || !restaurantName) {
      error = 'Fill in the owner name, a valid email, and the restaurant name.';
    } else if (!isValidSlug(slug)) {
      error = 'Slug: lowercase letters, digits and hyphens only, 2–64 characters.';
    }
    if (!error) {
      const emailTaken = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
        .bind(ownerEmail)
        .first();
      if (emailTaken) error = 'That email is already registered.';
    }
    if (!error) {
      const slugTaken = await c.env.DB.prepare('SELECT id FROM restaurants WHERE slug = ?')
        .bind(slug)
        .first();
      if (slugTaken) error = 'That slug is already taken. Pick another one.';
    }
    if (error) {
      return c.html(
        layout({
          title: 'Create owner',
          body: `<h1>Create owner + restaurant</h1>${formError(error)}<p><a href="/admin/owners/new">Back</a></p>`,
        }),
        400,
      );
    }
    const now = Date.now();
    // Unusable password until the owner sets one via the setup link.
    const unusable = '!' + randomToken(16);
    const userRes = await c.env.DB.prepare(
      "INSERT INTO users (email, password_hash, role, name, created_at) VALUES (?, ?, 'owner', ?, ?)",
    )
      .bind(ownerEmail, unusable, ownerName, now)
      .run();
    const ownerId = Number(userRes.meta.last_row_id);
    await c.env.DB.prepare(
      `INSERT INTO restaurants (owner_id, name, slug, currency, plan, created_at, updated_at)
       VALUES (?, ?, ?, 'PKR', 'free', ?, ?)`,
    )
      .bind(ownerId, restaurantName, slug, now, now)
      .run();
    await createSetupToken(c.env.DB, ownerId);
    return c.redirect('/admin?created=1');
  });

  // ---- Flip Free / Pro ----
  app.post('/admin/owners/:id/plan', async (c) => {
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const ownerId = Number(c.req.param('id'));
    const form = await c.req.formData();
    const plan = String(form.get('plan') ?? '');
    if (plan !== 'free' && plan !== 'pro') return c.text('Invalid plan.', 400);
    await c.env.DB.prepare('UPDATE restaurants SET plan = ?, updated_at = ? WHERE owner_id = ?')
      .bind(plan, Date.now(), ownerId)
      .run();
    return c.redirect('/admin?plan=1');
  });

  // ---- Regenerate the setup link ----
  app.post('/admin/owners/:id/setup-link', async (c) => {
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const ownerId = Number(c.req.param('id'));
    await c.env.DB.prepare('UPDATE setup_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .bind(Date.now(), ownerId)
      .run();
    await createSetupToken(c.env.DB, ownerId);
    return c.redirect('/admin?created=1');
  });
}
