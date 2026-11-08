/**
 * Public routes: landing page, public menu, QR SVG, photo serving.
 *
 * The public menu is plain server-rendered HTML with no JavaScript, so it
 * loads fast on cheap Android phones and weak internet. Photos are optional
 * (many dhabas have none).
 */

import type { App } from './types';
import type { PhotoMetadata } from './upload';
import { getCategories, getItemsWithPrices, getRestaurantBySlug } from './db';
import { qrSvgForUrl } from './qr';
import { langFromRequest, t, type Lang } from './i18n';
import { esc, layout } from './html';
import { formatMoney } from './util';

export function registerPublicRoutes(app: App): void {
  // ---- Landing page ----
  app.get('/', (c) => {
    return c.html(
      layout({
        title: 'QR Menu Maker',
        body: `<h1>QR Menu Maker</h1>
<p>Put your restaurant menu online and get a QR code for the table. Customers scan the code with their phone and see the menu. Change the menu any time — the QR code never changes.</p>
<ul>
<li>One page per restaurant, light enough for weak internet</li>
<li>Half / Full and Small / Medium / Large prices</li>
<li>Urdu and English menus</li>
<li>Free plan: 25 items · Pro plan: unlimited items, your own logo</li>
</ul>
<p><a class="btn primary" href="/login">Owner login</a></p>
<p class="muted">Are you a restaurant owner? Ask the admin for your account and password-setup link.</p>`,
      }),
    );
  });

  // ---- Public menu ----
  app.get('/r/:slug', async (c) => {
    const slug = c.req.param('slug');
    const lang: Lang = langFromRequest(c.req.url);
    const r = await getRestaurantBySlug(c.env.DB, slug);
    if (!r) {
      return c.html(
        layout({ title: 'Menu not found', body: '<h1>Menu not found</h1><p>Check the QR code or the link and try again.</p>' }),
        404,
      );
    }
    const cats = await getCategories(c.env.DB, r.id);
    const items = await getItemsWithPrices(c.env.DB, r.id);
    const otherLang: Lang = lang === 'ur' ? 'en' : 'ur';
    const otherUrl = `/r/${esc(r.slug)}?lang=${otherLang}`;
    const byCat = new Map<number, typeof items>();
    for (const item of items) {
      if (!item.is_available) continue;
      const list = byCat.get(item.category_id) ?? [];
      list.push(item);
      byCat.set(item.category_id, list);
    }
    let menuHtml = '';
    for (const cat of cats) {
      const catItems = byCat.get(cat.id) ?? [];
      if (catItems.length === 0) continue;
      const catName = lang === 'ur' && cat.name_ur ? cat.name_ur : cat.name;
      menuHtml += `<section class="menu-cat"><h2>${esc(catName)}</h2><ul class="menu-list">`;
      for (const item of catItems) {
        const name = lang === 'ur' && item.name_ur ? item.name_ur : item.name;
        const desc =
          lang === 'ur' && item.description_ur ? item.description_ur : item.description;
        const priceText = item.prices
          .map((p) => {
            const label = lang === 'ur' && p.label_ur ? p.label_ur : p.label;
            const showLabel = item.prices.length > 1 || label.toLowerCase() !== 'regular';
            return showLabel
              ? `${esc(label)} ${esc(formatMoney(p.amount, p.currency))}`
              : esc(formatMoney(p.amount, p.currency));
          })
          .join(' · ');
        menuHtml += `<li class="menu-item">
${item.photo_url ? `<img src="${esc(item.photo_url)}" alt="" loading="lazy" class="menu-photo">` : ''}
<div><strong>${esc(name)}</strong>
${desc ? `<br><span class="muted">${esc(desc)}</span>` : ''}
<br><span class="price">${priceText || ''}</span></div>
</li>`;
      }
      menuHtml += '</ul></section>';
    }
    const whatsappHref = r.whatsapp_number
      ? `https://wa.me/${esc(r.whatsapp_number.replace(/^\+/, ''))}`
      : null;
    return c.html(
      layout({
        title: r.name,
        lang,
        body: `<article class="public-menu">
<p class="lang-switch"><a href="${otherUrl}">${esc(t(lang, lang === 'ur' ? 'switchToEnglish' : 'switchToUrdu'))}</a></p>
${r.plan === 'pro' && r.logo_url ? `<p><img src="${esc(r.logo_url)}" alt="${esc(r.name)} logo" class="logo"></p>` : ''}
<h1>${esc(r.name)}</h1>
${r.description ? `<p>${esc(r.description)}</p>` : ''}
${r.address ? `<p class="muted">${esc(r.address)}</p>` : ''}
<p class="menu-links">
${r.maps_url ? `<a href="${esc(r.maps_url)}" target="_blank" rel="noopener">${esc(t(lang, 'viewOnMap'))}</a>` : ''}
${whatsappHref ? `<a href="${esc(whatsappHref)}" target="_blank" rel="noopener">${esc(t(lang, 'whatsapp'))}</a>` : ''}
</p>
<h2 class="menu-title">${esc(t(lang, 'menu'))}</h2>
<p class="muted">${esc(t(lang, 'pricesIn'))}</p>
${menuHtml || `<p class="muted">${esc(t(lang, 'noMenu'))}</p>`}
<p class="muted">${esc(t(lang, 'orderNote'))}</p>
${r.plan === 'free' ? `<footer class="powered">${esc(t(lang, 'poweredBy'))}</footer>` : ''}
</article>`,
      }),
    );
  });

  // ---- QR code as SVG (the dashboard converts it to PNG in the browser) ----
  app.get('/r/:slug/qr.svg', async (c) => {
    const slug = c.req.param('slug');
    const r = await getRestaurantBySlug(c.env.DB, slug);
    if (!r) return c.text('Menu not found.', 404);
    const origin = new URL(c.req.url).origin;
    let svg: string;
    try {
      svg = qrSvgForUrl(`${origin}/r/${r.slug}`);
    } catch {
      return c.text('Menu URL is too long for a QR code.', 500);
    }
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });

  // ---- Photos from Workers KV (same-origin, so the CSP stays tight) ----
  // KV reads are eventually consistent: a photo uploaded a moment ago
  // can take a few seconds to appear on every edge.
  app.get('/photos/*', async (c) => {
    const key = c.req.path.replace(/^\/photos\//, '');
    if (!key.startsWith('restaurants/') || key.includes('..')) {
      return c.text('Not found.', 404);
    }
    const result = await c.env.MENU_PHOTOS.getWithMetadata<PhotoMetadata>(
      decodeURIComponent(key),
      'arrayBuffer',
    );
    if (!result.value) return c.text('Not found.', 404);
    const headers = new Headers();
    headers.set('Content-Type', contentTypeFor(key, result.metadata?.contentType));
    headers.set('Cache-Control', 'public, max-age=86400');
    return new Response(result.value, { headers });
  });
}

/** Content-type for a stored photo: KV metadata first, extension as fallback. */
function contentTypeFor(key: string, stored?: string): string {
  if (stored) return stored;
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}
