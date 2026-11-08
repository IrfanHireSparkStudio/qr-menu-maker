# QR Menu Maker — V1 (Cloudflare Workers)

Multi-restaurant (multi-tenant) SaaS: restaurant owners sign up, create a
restaurant profile, add categories, items and prices, and get a public menu
link plus a downloadable/printable QR code. A customer scans the QR with a
phone to see the menu; the menu can change without the QR changing.

Stack (as in the video spec): Cloudflare Workers (not Pages), TypeScript,
Hono, server-rendered HTML (not a React app, so pages stay light),
Cloudflare D1 database, R2 bucket for photos.

## What V1 includes

- Owner sign-up is admin-invited: the admin creates the owner account and a
  one-time password-setup link, then sends it to the owner on WhatsApp
  manually. No public self-signup form.
- Only two roles: **admin** and **owner**. The customer never logs in.
- Restaurant profile: name, description, address, Google Maps link,
  WhatsApp number, logo (Pro only).
- Categories, items, and price variants per item — Half / Full (karahi),
  Small / Medium / Large (pizza), or a single Regular price.
- Free plan: **25 items** per restaurant, "Powered by" shown. Pro plan:
  unlimited items, own logo, "Powered by" removed. The 25-item limit is
  enforced server-side. The admin flips Free/Pro by hand (no payment
  integration in V1).
- Public menu: light HTML, no JavaScript, Urdu/English toggle, Maps and
  WhatsApp links, photos optional (many dhabas have none).
- QR code: generated server-side as SVG (`/r/:slug/qr.svg`); the dashboard
  has a "Download PNG" button (SVG → PNG in the browser via canvas) and a
  "Print QR" button. No external QR API is called.
- **The slug never changes.** The public menu URL and the printed QR depend
  on it, so the app never offers to edit it.
- Security by default: PBKDF2-hashed passwords, HTTP-only Secure SameSite
  session cookies, login-attempt limits (5 per 15 minutes), optional
  Cloudflare Turnstile on the password-setup form, server-side input
  validation, prepared statements only, security headers + CSP, origin
  check on form submits, JPG/WebP/PNG uploads only (never SVG, max 2 MB),
  secrets only in Wrangler secrets — the repo contains no real secrets.

## What V1 deliberately does NOT include (Pro+ / V2)

Online ordering, payment, table booking, WhatsApp ordering, kitchen
display, scan counter, AI filling items from a photo of a printed menu
card, branches, currency/country switching, open/closed status. The code
is structured so these can be added later (see "Where things live").

## Deploy — step by step

### 1. Prerequisites

- Node.js 18 or newer and npm.
- A Cloudflare account.
- Wrangler is installed as a dev dependency (`npm install` below).

### 2. Install

```bash
cd qr-menu-maker
npm install
```

### 3. Log in to Cloudflare

```bash
npx wrangler login
```

### 4. Create the D1 database and paste its ID into wrangler.toml

```bash
npx wrangler d1 create qr-menu-maker-db
```

Copy the `database_id` from the output into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 5. Create the R2 bucket for photos

```bash
npx wrangler r2 bucket create qr-menu-maker-photos
```

### 6. Apply the database migrations

Local dev database:

```bash
npm run db:migrate:local
```

Production database:

```bash
npm run db:migrate:remote
```

### 7. Set the secrets

```bash
# One-time token protecting the first-admin setup page. Generate one:
#   openssl rand -hex 32
npx wrangler secret put SETUP_TOKEN
```

Optional — Cloudflare Turnstile (leave unset to run without it):

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
# and put the public site key in wrangler.toml [vars] TURNSTILE_SITE_KEY
```

For local development, copy `.env.example` to `.dev.vars` and fill in the
same values. Never commit `.dev.vars`.

### 8. Test locally

```bash
npm run dev
```

Open http://localhost:8787. The local D1 database is used automatically.

### 9. Deploy

```bash
npm run deploy
# or: npx wrangler deploy
```

### 10. Add your own domain — BEFORE printing any QR

The default `*.workers.dev` URL is not permanent. Add a custom domain in
the Cloudflare dashboard: **Workers & Pages → qr-menu-maker → Settings →
Custom Domains → Add custom domain**. (Alternative: add this to
`wrangler.toml` and deploy again — the domain must already be a zone in
your account:

```toml
routes = [{ pattern = "qr.example.com", custom_domain = true }]
```

**Warning: print QR codes only after the custom domain is live.** The QR
links to the public menu URL, and the slug/URL must never change.

### 11. Create the first admin account

Open (replace the token with your `SETUP_TOKEN` value):

```
https://YOUR-DOMAIN/admin-setup?token=YOUR_SETUP_TOKEN
```

Fill in name, email and password. After the first admin exists, this page
stops working.

### 12. Onboard the first restaurant

1. Log in as admin and open **Admin → Create new owner + restaurant**.
2. Fill in the owner name, owner email, restaurant name and slug.
   **The slug can never be changed — pick it carefully.**
3. Copy the one-time password-setup link shown on the Admin page and send
   it to the owner on WhatsApp yourself.
4. The owner opens the link, sets a password (at least 10 characters),
   logs in, fills in the restaurant profile, adds categories, items and
   prices, then downloads/prints the QR from the dashboard.
5. **Test the QR by printing it first** and scanning it from a phone
   before giving it to the restaurant.

## Paid plan note (from the video spec)

Password hashing (PBKDF2) costs real CPU time. The Cloudflare free plan
allows 10ms of CPU per request and a login can take 10–20ms, so take
**Workers Paid ($5/month)** before the first paying client.

## Where things live

```
wrangler.toml            Bindings (D1 + R2), static assets from ./public
migrations/0001_init.sql D1 schema (users, sessions, restaurants,
                         categories, items, prices + support tables)
public/styles.css        Mobile-first CSS
public/app.js            Dashboard JS only (QR PNG download, copy buttons,
                         price rows, delete confirmations)
src/index.ts             App entry, middleware order, role guards
src/types.ts             Env bindings + DB row types
src/db.ts                D1 queries (prepared statements only)
src/security.ts          PBKDF2 passwords, sessions, login limits,
                         Turnstile, CSP/headers, origin check
src/html.ts              Server-rendered page layout + form helpers
src/i18n.ts              English/Urdu strings for the public menu
src/qr.ts                Server-side QR code as SVG
src/auth.ts              Login/logout, first-admin setup, password setup
src/admin.ts             Admin: owners, restaurants, plan flips, setup links
src/owner.ts             Owner dashboard: profile, categories, items,
                         prices, photos, QR download/print
src/public.ts            Landing page, public menu, QR SVG, photo serving
src/upload.ts            R2 photo upload validation (JPG/WebP/PNG, max 2 MB)
```

## Useful commands

```bash
npm run typecheck   # tsc --noEmit
npm run dev         # local dev server with local D1 + R2
npm run deploy      # deploy to Cloudflare
```

## Troubleshooting

- **"D1 database not found"** — the `database_id` in `wrangler.toml`
  does not match a database in your account. Re-run step 4.
- **Admin setup page says "Not found"** — the `?token=` value must equal
  the `SETUP_TOKEN` secret exactly.
- **Setup link says "not valid"** — the link expires after 72 hours and
  works once. The admin can generate a new one from the Admin page.
- **Login says "Too many failed attempts"** — wait 15 minutes, or clear
  the `login_attempts` rows in D1.
- **Photos do not load** — check the R2 bucket name in `wrangler.toml`
  and that the bucket exists in the same account.
