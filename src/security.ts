/**
 * Security by default.
 *
 * - Passwords: PBKDF2-HMAC-SHA-256, 100,000 iterations, 16-byte random salt,
 *   32-byte key (WebCrypto — bcrypt is not available in Workers; plain
 *   SHA-256 without a salt is never used).
 *   NOTE on CPU: PBKDF2 costs real CPU time. On the Cloudflare free plan the
 *   CPU limit is 10ms per request and a login can take 10-20ms, so take
 *   Workers Paid ($5/month) before the first paying client, as advised in
 *   the video spec.
 * - Sessions: random 32-byte tokens stored in D1; cookie is HTTP-only,
 *   Secure on https, SameSite=Lax, 7-day expiry.
 * - Login attempts: max 5 failed attempts per email per 15 minutes.
 * - Turnstile: verified server-side when keys are configured; skipped when
 *   they are not (so the app still deploys without keys).
 * - Origin check on form submits: a present Origin header must match the
 *   request origin; a missing Origin header is allowed (curl, old clients).
 */

import type { Env, UserRow } from './types';
import type { Ctx } from './types';

const PBKDF2_ITERATIONS = 100_000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Constant-time comparison so password checks do not leak timing. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

/** Returns false for unusable hashes (invited accounts start with '!'). */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || stored.startsWith('!')) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = parseInt(parts[1] ?? '', 10);
  const saltHex = parts[2] ?? '';
  const hashHex = parts[3] ?? '';
  if (!Number.isFinite(iterations) || !saltHex || !hashHex) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return constantTimeEqual(bytesToHex(new Uint8Array(bits)), hashHex);
}

/** Create a session row and return its token. */
export async function createSession(db: D1Database, userId: number): Promise<string> {
  const token = randomToken(32);
  const now = Date.now();
  await db
    .prepare('INSERT INTO sessions (user_id, token, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(userId, token, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

/** Look up the logged-in user from the session cookie. Returns null when absent/expired. */
export async function getSessionUser(db: D1Database, token: string | undefined): Promise<UserRow | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .bind(token, Date.now())
    .first<UserRow>();
  return row ?? null;
}

export async function destroySession(db: D1Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

/** Session cookie value. Secure is only set on https (local dev runs over http). */
export function sessionCookie(token: string, reqUrl: string, maxAgeSeconds: number): string {
  const secure = new URL(reqUrl).protocol === 'https:' ? '; Secure' : '';
  return `session=${token}; HttpOnly; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax${secure}`;
}

export function clearSessionCookie(): string {
  return 'session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
}

/** Record a failed login attempt (email is normalised to lowercase). */
export async function recordLoginAttempt(db: D1Database, email: string, ip: string): Promise<void> {
  await db
    .prepare('INSERT INTO login_attempts (email, ip, attempted_at) VALUES (?, ?, ?)')
    .bind(email.toLowerCase(), ip, Date.now())
    .run();
}

export async function clearLoginAttempts(db: D1Database, email: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email.toLowerCase()).run();
}

/** True when the email has failed too many logins in the window. */
export async function isLoginLocked(db: D1Database, email: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND attempted_at > ?')
    .bind(email.toLowerCase(), Date.now() - LOGIN_WINDOW_MS)
    .first<{ n: number }>();
  return (row?.n ?? 0) >= LOGIN_MAX_ATTEMPTS;
}

/** Best-effort client IP (Cloudflare header, then none). */
export function clientIp(c: Ctx): string {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'unknown';
}

/**
 * Origin check for form submits. A present Origin header must match the
 * request origin, otherwise the request is rejected (CSRF protection,
 * together with SameSite=Lax cookies).
 */
export function originOk(c: Ctx): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(c.req.url).origin;
  } catch {
    return false;
  }
}

/** Security headers + Content-Security-Policy. Turnstile origins are only added when enabled. */
export function securityHeaders(c: Ctx, next: () => Promise<void>): Promise<void> {
  const turnstile = Boolean(c.env.TURNSTILE_SITE_KEY && c.env.TURNSTILE_SECRET_KEY);
  const scriptSrc = turnstile ? `'self' https://challenges.cloudflare.com` : `'self'`;
  const frameSrc = turnstile ? `https://challenges.cloudflare.com` : `'none'`;
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      `default-src 'self'`,
      `script-src ${scriptSrc}`,
      `style-src 'self'`,
      `img-src 'self' data:`,
      `font-src 'self'`,
      `connect-src 'self'`,
      `frame-src ${frameSrc}`,
      `object-src 'none'`,
      `base-uri 'self'`,
      `frame-ancestors 'none'`,
      `form-action 'self'`,
    ].join('; '),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
  return next().then(() => {
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });
}

/** Verify a Turnstile token server-side. Returns true when Turnstile is not configured. */
export async function verifyTurnstile(env: Env, token: string | undefined, ip: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true; // not configured: disabled
  if (!token) return false;
  const form = new URLSearchParams();
  form.set('secret', env.TURNSTILE_SECRET_KEY);
  form.set('response', token);
  form.set('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { success?: boolean };
  return data.success === true;
}
