/**
 * Owner dashboard: restaurant profile, categories, items + prices, QR code.
 *
 * Tenant scoping: every query is filtered by the logged-in owner's own
 * restaurant (loaded by the auth middleware). An owner can never see or
 * touch another restaurant's data.
 *
 * Free-plan gate: a free restaurant can hold at most 25 items. The check
 * runs server-side on item creation (the count shown in the UI is only
 * informational).
 */

import type { App, ItemRow, PriceRow, RestaurantRow } from './types';
import { FREE_ITEM_LIMIT, countItems, getCategories, getItemsWithPrices } from './db';
import { deletePhoto, handlePhotoUpload } from './upload';
import { originOk } from './security';
import { esc, formError, hiddenField, layout, notice, submitButton } from './html';
import { cleanText, formatMoney, isValidHttpUrl, isValidPhone, parseAmountToMinor, toInt } from './util';
import type { Context } from 'hono';
import type { Ctx, Env, Vars } from './types';

function needRestaurant(c: Ctx): RestaurantRow | null {
  return c.get('restaurant');
}

function noRestaurantPage(): string {
  return layout({
    title: 'No restaurant yet',
    body: '<h1>No restaurant yet</h1><p>Your admin has not created a restaurant for your account. Please ask your admin.</p>',
  });
}

function priceRowInputs(prices: Array<{ label: string; amount: number }>): string {
  if (prices.length === 0) prices = [{ label: 'Regular', amount: 0 }];
  return prices
    .map(
      (p) => `<div class="price-row">
  <label>Label <input type="text" name="price_label" value="${esc(p.label)}" maxlength="30" placeholder="Half / Full / Small"></label>
  <label>Price (Rs) <input type="text" name="price_amount" value="${p.amount ? String(p.amount / 100) : ''}" inputmode="decimal" placeholder="450"></label>
</div>`,
    )
    .join('');
}

/** Parse repeated price_label / price_amount fields. Returns null on any invalid row. */
function parsePrices(form: FormData): Array<{ label: string; amount: number }> | null {
  const labels = form.getAll('price_label').map((v) => String(v ?? ''));
  const amounts = form.getAll('price_amount').map((v) => String(v ?? ''));
  const out: Array<{ label: string; amount: number }> = [];
  for (let i = 0; i < Math.max(labels.length, amounts.length); i++) {
    const label = cleanText(labels[i] ?? '', 30);
    const rawAmount = (amounts[i] ?? '').trim();
    if (!label && !rawAmount) continue; // empty row: skip
    const amount = parseAmountToMinor(rawAmount);
    if (!label || amount === null) return null;
    out.push({ label, amount });
  }
  return out.length > 0 ? out : null;
}

export function registerOwnerRoutes(app: App): void {
  // ---- Dashboard ----
  app.get('/owner', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    const count = await countItems(c.env.DB, r.id);
    const origin = new URL(c.req.url).origin;
    const menuUrl = `${origin}/r/${r.slug}`;
    const limitText =
      r.plan === 'free' ? `${count} / ${FREE_ITEM_LIMIT} items used` : `${count} items (Pro, unlimited)`;
    const saved = c.req.query('saved') === '1';
    return c.html(
      layout({
        title: 'Owner dashboard',
        body: `<h1>${esc(r.name)}</h1>
${saved ? notice('ok', 'Saved.') : ''}
<p><span class="badge">${esc(r.plan)}</span> ${esc(limitText)}</p>
<p>Public menu: <a href="${esc(menuUrl)}" target="_blank" rel="noopener">${esc(menuUrl)}</a>
<button class="btn small" type="button" data-copy="${esc(menuUrl)}">Copy link</button></p>
<div class="qr-box" id="qr-box">
  <img src="/r/${esc(r.slug)}/qr.svg" alt="QR code for ${esc(r.name)}" width="220" height="220">
  <p class="muted">Scan this QR to open the menu. The link never changes, so a printed QR keeps working.</p>
  <p>
    <button class="btn" type="button" data-qr-png="/r/${esc(r.slug)}/qr.svg" data-filename="${esc(r.slug)}-qr.png">Download PNG</button>
    <button class="btn" type="button" data-print-qr>Print QR</button>
  </p>
</div>
<nav class="dash-links">
  <a class="btn" href="/owner/restaurant">Edit restaurant</a>
  <a class="btn" href="/owner/categories">Categories</a>
  <a class="btn" href="/owner/items">Menu items</a>
  <a class="btn" href="/r/${esc(r.slug)}" target="_blank" rel="noopener">View public menu</a>
</nav>
<form method="post" action="/logout" class="inline-form"><button class="btn" type="submit">Log out</button></form>`,
      }),
    );
  });

  // ---- Restaurant profile ----
  app.get('/owner/restaurant', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    return c.html(
      layout({
        title: 'Edit restaurant',
        body: `<h1>Edit restaurant</h1>
<p class="muted">Slug <code>${esc(r.slug)}</code> can never be changed — the public menu URL and the printed QR depend on it.</p>
<form method="post" action="/owner/restaurant">
<label class="field"><span>Restaurant name</span>
<input type="text" name="name" value="${esc(r.name)}" required maxlength="120"></label>
<label class="field"><span>Description</span>
<textarea name="description" rows="3" maxlength="500">${esc(r.description ?? '')}</textarea></label>
<label class="field"><span>Address</span>
<input type="text" name="address" value="${esc(r.address ?? '')}" maxlength="200"></label>
<label class="field"><span>Google Maps link</span>
<input type="url" name="maps_url" value="${esc(r.maps_url ?? '')}" maxlength="500" placeholder="https://maps.google.com/..."></label>
<label class="field"><span>WhatsApp number (with country code, e.g. 923001234567)</span>
<input type="tel" name="whatsapp_number" value="${esc(r.whatsapp_number ?? '')}" maxlength="20"></label>
${submitButton('Save restaurant')}
</form>
<h2>Logo ${r.plan === 'pro' ? '' : '(Pro only — shown on the public menu when the plan is Pro)'}</h2>
${r.logo_url ? `<p><img src="${esc(r.logo_url)}" alt="Restaurant logo" class="logo-preview"></p>` : ''}
<form method="post" action="/owner/restaurant/logo" enctype="multipart/form-data">
<label class="field"><span>Logo photo (JPG, PNG or WebP, max 2 MB)</span>
<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required></label>
${submitButton('Upload logo')}
</form>
<p><a href="/owner">Back to dashboard</a></p>`,
      }),
    );
  });

  app.post('/owner/restaurant', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const form = await c.req.formData();
    const name = cleanText(form.get('name'), 120);
    const description = cleanText(form.get('description'), 500);
    const address = cleanText(form.get('address'), 200);
    const mapsUrl = cleanText(form.get('maps_url'), 500);
    const whatsapp = cleanText(form.get('whatsapp_number'), 20).replace(/[\s-]/g, '');
    if (!name) return c.html(layout({ title: 'Edit restaurant', body: `<h1>Edit restaurant</h1>${formError('Restaurant name is required.')}` }), 400);
    if (mapsUrl && !isValidHttpUrl(mapsUrl)) {
      return c.html(layout({ title: 'Edit restaurant', body: `<h1>Edit restaurant</h1>${formError('Maps link must be a valid http(s) URL.')}` }), 400);
    }
    if (whatsapp && !isValidPhone(whatsapp)) {
      return c.html(layout({ title: 'Edit restaurant', body: `<h1>Edit restaurant</h1>${formError('WhatsApp number: digits only, with country code.')}` }), 400);
    }
    await c.env.DB.prepare(
      'UPDATE restaurants SET name = ?, description = ?, address = ?, maps_url = ?, whatsapp_number = ?, updated_at = ? WHERE id = ?',
    )
      .bind(name, description || null, address || null, mapsUrl || null, whatsapp || null, Date.now(), r.id)
      .run();
    return c.redirect('/owner?saved=1');
  });

  app.post('/owner/restaurant/logo', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const form = await c.req.formData();
    const file = form.get('photo');
    const result = await handlePhotoUpload(
      c.env.MENU_PHOTOS,
      file instanceof File ? file : null,
      `restaurants/${r.id}/logo`,
    );
    if (!result.ok || !result.path) {
      return c.html(
        layout({ title: 'Edit restaurant', body: `<h1>Edit restaurant</h1>${formError(result.error ?? 'Upload failed.')}<p><a href="/owner/restaurant">Back</a></p>` }),
        400,
      );
    }
    await deletePhoto(c.env.MENU_PHOTOS, r.logo_url);
    await c.env.DB.prepare('UPDATE restaurants SET logo_url = ?, updated_at = ? WHERE id = ?')
      .bind(result.path, Date.now(), r.id)
      .run();
    return c.redirect('/owner?saved=1');
  });

  // ---- Categories ----
  app.get('/owner/categories', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    const cats = await getCategories(c.env.DB, r.id);
    const rows = cats
      .map(
        (cat) => `<li>${esc(cat.name)}${cat.name_ur ? ` (${esc(cat.name_ur)})` : ''}
<form method="post" action="/owner/categories/${cat.id}/delete" class="inline-form" data-confirm="Delete this category? Items inside it block deletion.">
<button class="btn small danger" type="submit">Delete</button></form></li>`,
      )
      .join('');
    return c.html(
      layout({
        title: 'Categories',
        body: `<h1>Categories</h1>
<ul class="list">${rows || '<li class="muted">No categories yet.</li>'}</ul>
<h2>Add category</h2>
<form method="post" action="/owner/categories">
<label class="field"><span>Name (English)</span>
<input type="text" name="name" required maxlength="80"></label>
<label class="field"><span>Name (Urdu, optional)</span>
<input type="text" name="name_ur" maxlength="80"></label>
${submitButton('Add category')}
</form>
<p><a href="/owner">Back to dashboard</a></p>`,
      }),
    );
  });

  app.post('/owner/categories', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const form = await c.req.formData();
    const name = cleanText(form.get('name'), 80);
    const nameUr = cleanText(form.get('name_ur'), 80);
    if (!name) return c.text('Category name is required.', 400);
    const maxOrder = await c.env.DB.prepare('SELECT MAX(sort_order) AS m FROM categories WHERE restaurant_id = ?')
      .bind(r.id)
      .first<{ m: number | null }>();
    await c.env.DB.prepare(
      'INSERT INTO categories (restaurant_id, name, name_ur, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    )
      .bind(r.id, name, nameUr || null, (maxOrder?.m ?? -1) + 1, Date.now())
      .run();
    return c.redirect('/owner/categories');
  });

  app.post('/owner/categories/:id/delete', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const id = Number(c.req.param('id'));
    const cat = await c.env.DB.prepare(
      'SELECT * FROM categories WHERE id = ? AND restaurant_id = ?',
    )
      .bind(id, r.id)
      .first();
    if (!cat) return c.text('Category not found.', 404);
    const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE category_id = ?')
      .bind(id)
      .first<{ n: number }>();
    if ((used?.n ?? 0) > 0) {
      return c.html(
        layout({
          title: 'Categories',
          body: `<h1>Categories</h1>${formError('This category still has items. Move or delete the items first.')}<p><a href="/owner/categories">Back</a></p>`,
        }),
        400,
      );
    }
    await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    return c.redirect('/owner/categories');
  });

  // ---- Items ----
  app.get('/owner/items', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    const cats = await getCategories(c.env.DB, r.id);
    const items = await getItemsWithPrices(c.env.DB, r.id);
    const count = items.length;
    const atLimit = r.plan === 'free' && count >= FREE_ITEM_LIMIT;
    const byCat = new Map<number, typeof items>();
    for (const item of items) {
      const list = byCat.get(item.category_id) ?? [];
      list.push(item);
      byCat.set(item.category_id, list);
    }
    let listHtml = '';
    for (const cat of cats) {
      const catItems = byCat.get(cat.id) ?? [];
      listHtml += `<h2>${esc(cat.name)}</h2>`;
      if (catItems.length === 0) {
        listHtml += '<p class="muted">No items in this category yet.</p>';
        continue;
      }
      listHtml += '<ul class="list">';
      for (const item of catItems) {
        const priceText = item.prices
          .map((p) => `${esc(p.label)}: ${esc(formatMoney(p.amount, p.currency))}`)
          .join(' · ');
        listHtml += `<li>
${item.photo_url ? `<img src="${esc(item.photo_url)}" alt="" class="thumb">` : ''}
<strong>${esc(item.name)}</strong> ${item.is_available ? '' : '<span class="badge">hidden</span>'}
<br><span class="muted">${priceText || 'No prices set'}</span>
<form method="post" action="/owner/items/${item.id}/toggle" class="inline-form">
<button class="btn small" type="submit">${item.is_available ? 'Hide' : 'Show'}</button></form>
<a class="btn small" href="/owner/items/${item.id}/edit">Edit</a>
<form method="post" action="/owner/items/${item.id}/delete" class="inline-form" data-confirm="Delete this item and its prices?">
<button class="btn small danger" type="submit">Delete</button></form>
<form method="post" action="/owner/items/${item.id}/photo" enctype="multipart/form-data" class="inline-form">
<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required>
<button class="btn small" type="submit">Upload photo</button></form>
</li>`;
      }
      listHtml += '</ul>';
    }
    const options = cats
      .map((cat) => `<option value="${cat.id}">${esc(cat.name)}</option>`)
      .join('');
    return c.html(
      layout({
        title: 'Menu items',
        body: `<h1>Menu items</h1>
<p>${r.plan === 'free' ? `${count} / ${FREE_ITEM_LIMIT} items used (Free plan)` : `${count} items (Pro, unlimited)`}</p>
${atLimit ? formError('Free plan limit reached (25 items). Ask your admin to switch this restaurant to Pro to add more.') : ''}
${listHtml || '<p class="muted">No categories yet — add a category first.</p>'}
<h2>Add item</h2>
${cats.length === 0 ? '<p class="muted">Add a category first, then add items to it.</p>' : `
<form method="post" action="/owner/items">
<label class="field"><span>Category</span>
<select name="category_id">${options}</select></label>
<label class="field"><span>Item name (English)</span>
<input type="text" name="name" required maxlength="120"></label>
<label class="field"><span>Item name (Urdu, optional)</span>
<input type="text" name="name_ur" maxlength="120"></label>
<label class="field"><span>Description (optional)</span>
<textarea name="description" rows="2" maxlength="300"></textarea></label>
<fieldset><legend>Prices — one row per variant (Half / Full, Small / Medium / Large)</legend>
<div id="price-rows">${priceRowInputs([])}</div>
<button class="btn small" type="button" data-add-price>Add another price</button>
</fieldset>
<label class="check"><input type="checkbox" name="is_available" checked> Available on the menu</label>
${submitButton('Add item')}
</form>`}
<p><a href="/owner">Back to dashboard</a></p>`,
      }),
    );
  });

  app.post('/owner/items', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    // Free-plan gate (server-side — the count in the UI is only informational).
    if (r.plan === 'free' && (await countItems(c.env.DB, r.id)) >= FREE_ITEM_LIMIT) {
      return c.html(
        layout({
          title: 'Menu items',
          body: `<h1>Menu items</h1>${formError('Free plan limit reached (25 items). Ask your admin to switch this restaurant to Pro to add more.')}<p><a href="/owner/items">Back</a></p>`,
        }),
        403,
      );
    }
    const form = await c.req.formData();
    const categoryId = Number(form.get('category_id'));
    const name = cleanText(form.get('name'), 120);
    const nameUr = cleanText(form.get('name_ur'), 120);
    const description = cleanText(form.get('description'), 300);
    const isAvailable = form.get('is_available') === 'on' ? 1 : 0;
    const prices = parsePrices(form);
    const cat = await c.env.DB.prepare(
      'SELECT id FROM categories WHERE id = ? AND restaurant_id = ?',
    )
      .bind(categoryId, r.id)
      .first();
    if (!cat || !name || !prices) {
      return c.html(
        layout({
          title: 'Menu items',
          body: `<h1>Menu items</h1>${formError('Check the form: a category, an item name, and at least one valid price (label + amount).')}<p><a href="/owner/items">Back</a></p>`,
        }),
        400,
      );
    }
    const maxOrder = await c.env.DB.prepare(
      'SELECT MAX(sort_order) AS m FROM items WHERE restaurant_id = ? AND category_id = ?',
    )
      .bind(r.id, categoryId)
      .first<{ m: number | null }>();
    const itemRes = await c.env.DB.prepare(
      `INSERT INTO items (restaurant_id, category_id, name, name_ur, description, photo_url, is_available, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
      .bind(r.id, categoryId, name, nameUr || null, description || null, isAvailable, (maxOrder?.m ?? -1) + 1, Date.now())
      .run();
    const itemId = Number(itemRes.meta.last_row_id);
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i]!;
      await c.env.DB.prepare(
        "INSERT INTO prices (restaurant_id, item_id, label, amount, currency, sort_order) VALUES (?, ?, ?, ?, 'PKR', ?)",
      )
        .bind(r.id, itemId, p.label, p.amount, i)
        .run();
    }
    return c.redirect('/owner/items');
  });

  app.get('/owner/items/:id/edit', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    const id = Number(c.req.param('id'));
    const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ? AND restaurant_id = ?')
      .bind(id, r.id)
      .first<ItemRow>();
    if (!item) return c.text('Item not found.', 404);
    const cats = await getCategories(c.env.DB, r.id);
    const prices = await c.env.DB.prepare(
      'SELECT * FROM prices WHERE item_id = ? ORDER BY sort_order ASC, id ASC',
    )
      .bind(id)
      .all<PriceRow>();
    const options = cats
      .map(
        (cat) =>
          `<option value="${cat.id}"${cat.id === item.category_id ? ' selected' : ''}>${esc(cat.name)}</option>`,
      )
      .join('');
    return c.html(
      layout({
        title: 'Edit item',
        body: `<h1>Edit item</h1>
<form method="post" action="/owner/items/${id}/edit">
<label class="field"><span>Category</span>
<select name="category_id">${options}</select></label>
<label class="field"><span>Item name (English)</span>
<input type="text" name="name" value="${esc(item.name)}" required maxlength="120"></label>
<label class="field"><span>Item name (Urdu, optional)</span>
<input type="text" name="name_ur" value="${esc(item.name_ur ?? '')}" maxlength="120"></label>
<label class="field"><span>Description (optional)</span>
<textarea name="description" rows="2" maxlength="300">${esc(item.description ?? '')}</textarea></label>
<fieldset><legend>Prices</legend>
<div id="price-rows">${priceRowInputs((prices.results ?? []).map((p) => ({ label: p.label, amount: p.amount })))}</div>
<button class="btn small" type="button" data-add-price>Add another price</button>
</fieldset>
<label class="check"><input type="checkbox" name="is_available" ${item.is_available ? 'checked' : ''}> Available on the menu</label>
${submitButton('Save item')}
</form>
<p><a href="/owner/items">Back to items</a></p>`,
      }),
    );
  });

  app.post('/owner/items/:id/edit', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const id = Number(c.req.param('id'));
    const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ? AND restaurant_id = ?')
      .bind(id, r.id)
      .first();
    if (!item) return c.text('Item not found.', 404);
    const form = await c.req.formData();
    const categoryId = Number(form.get('category_id'));
    const name = cleanText(form.get('name'), 120);
    const nameUr = cleanText(form.get('name_ur'), 120);
    const description = cleanText(form.get('description'), 300);
    const isAvailable = form.get('is_available') === 'on' ? 1 : 0;
    const prices = parsePrices(form);
    const cat = await c.env.DB.prepare(
      'SELECT id FROM categories WHERE id = ? AND restaurant_id = ?',
    )
      .bind(categoryId, r.id)
      .first();
    if (!cat || !name || !prices) {
      return c.html(
        layout({
          title: 'Edit item',
          body: `<h1>Edit item</h1>${formError('Check the form: a category, an item name, and at least one valid price.')}<p><a href="/owner/items">Back</a></p>`,
        }),
        400,
      );
    }
    await c.env.DB.prepare(
      'UPDATE items SET category_id = ?, name = ?, name_ur = ?, description = ?, is_available = ? WHERE id = ?',
    )
      .bind(categoryId, name, nameUr || null, description || null, isAvailable, id)
      .run();
    await c.env.DB.prepare('DELETE FROM prices WHERE item_id = ?').bind(id).run();
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i]!;
      await c.env.DB.prepare(
        "INSERT INTO prices (restaurant_id, item_id, label, amount, currency, sort_order) VALUES (?, ?, ?, ?, 'PKR', ?)",
      )
        .bind(r.id, id, p.label, p.amount, i)
        .run();
    }
    return c.redirect('/owner/items');
  });

  app.post('/owner/items/:id/delete', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const id = Number(c.req.param('id'));
    const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ? AND restaurant_id = ?')
      .bind(id, r.id)
      .first();
    if (!item) return c.text('Item not found.', 404);
    await deletePhoto(c.env.MENU_PHOTOS, item.photo_url as string | null);
    await c.env.DB.prepare('DELETE FROM prices WHERE item_id = ?').bind(id).run();
    await c.env.DB.prepare('DELETE FROM items WHERE id = ?').bind(id).run();
    return c.redirect('/owner/items');
  });

  app.post('/owner/items/:id/toggle', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const id = Number(c.req.param('id'));
    await c.env.DB.prepare(
      'UPDATE items SET is_available = 1 - is_available WHERE id = ? AND restaurant_id = ?',
    )
      .bind(id, r.id)
      .run();
    return c.redirect('/owner/items');
  });

  app.post('/owner/items/:id/photo', async (c) => {
    const r = needRestaurant(c);
    if (!r) return c.html(noRestaurantPage());
    if (!originOk(c)) return c.text('Request rejected (origin check).', 403);
    const id = Number(c.req.param('id'));
    const item = await c.env.DB.prepare('SELECT * FROM items WHERE id = ? AND restaurant_id = ?')
      .bind(id, r.id)
      .first();
    if (!item) return c.text('Item not found.', 404);
    const form = await c.req.formData();
    const file = form.get('photo');
    const result = await handlePhotoUpload(
      c.env.MENU_PHOTOS,
      file instanceof File ? file : null,
      `restaurants/${r.id}/items/${id}`,
    );
    if (!result.ok || !result.path) {
      return c.html(
        layout({
          title: 'Menu items',
          body: `<h1>Menu items</h1>${formError(result.error ?? 'Upload failed.')}<p><a href="/owner/items">Back</a></p>`,
        }),
        400,
      );
    }
    await deletePhoto(c.env.MENU_PHOTOS, item.photo_url as string | null);
    await c.env.DB.prepare('UPDATE items SET photo_url = ? WHERE id = ?').bind(result.path, id).run();
    return c.redirect('/owner/items');
  });
}
