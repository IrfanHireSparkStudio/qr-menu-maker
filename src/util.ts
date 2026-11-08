/** Small pure helpers: escaping, validation, money. No I/O here. */

/** Escape text for safe insertion into server-rendered HTML. */
export function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

/**
 * Slugs are permanent: the public menu URL and the printed QR depend on them.
 * Lowercase letters, digits and hyphens only; must start with a letter or digit.
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) && !slug.includes('--');
}

/** Only http(s) URLs are allowed for Maps links (no javascript: etc.). */
export function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** WhatsApp numbers: digits only, optional leading +, 7–15 digits. */
export function isValidPhone(value: string): boolean {
  return /^\+?[0-9]{7,15}$/.test(value.replace(/[\s-]/g, ''));
}

/**
 * Parse a typed price ("450", "450.50") into minor units (paisa).
 * Returns null for anything that is not a positive amount.
 */
export function parseAmountToMinor(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const minor = Math.round(parseFloat(s) * 100);
  if (minor <= 0 || minor > 100_000_000) return null; // max Rs 1,000,000 per price
  return minor;
}

/** Format minor units for display. V1 is PKR-only ("Rs 450", "Rs 450.50"). */
export function formatMoney(amountMinor: number, currency: string): string {
  const symbol = currency === 'USD' ? '$' : 'Rs ';
  const whole = Math.floor(amountMinor / 100);
  const rest = amountMinor % 100;
  if (rest === 0) return `${symbol}${whole.toLocaleString('en-US')}`;
  return `${symbol}${(amountMinor / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Clamp an integer parsed from a form field into a safe range. */
export function toInt(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Trim a form value to a max length (prevents oversized input reaching the DB). Non-strings (e.g. File) become ''. */
export function cleanText(raw: unknown, maxLen: number): string {
  return typeof raw === 'string' ? raw.trim().slice(0, maxLen) : '';
}
