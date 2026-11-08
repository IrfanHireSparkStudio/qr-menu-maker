/** Server-rendered HTML helpers. All user content goes through esc(). */

import { esc } from './util';

export { esc } from './util';

export interface LayoutOpts {
  title: string;
  body: string;
  /** Extra markup for <head> (e.g. the Turnstile script, only when enabled). */
  extraHead?: string;
  /** 'en' (LTR) or 'ur' (RTL) for the whole page. */
  lang?: 'en' | 'ur';
}

export function layout(opts: LayoutOpts): string {
  const lang = opts.lang ?? 'en';
  const dir = lang === 'ur' ? 'rtl' : 'ltr';
  return `<!doctype html>
<html lang="${lang}" dir="${dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)} — QR Menu Maker</title>
<link rel="stylesheet" href="/styles.css">
<script src="/app.js" defer></script>
${opts.extraHead ?? ''}
</head>
<body>
<header class="topbar">
  <a class="brand" href="/">QR Menu Maker</a>
  <nav>
    <a href="/login">Owner login</a>
  </nav>
</header>
<main class="container">
${opts.body}
</main>
<footer class="footer">QR Menu Maker — V1</footer>
</body>
</html>`;
}

/** A dismissible notice shown after a redirect (?ok=1 / ?err=...). */
export function notice(kind: 'ok' | 'err', text: string): string {
  return `<p class="notice ${kind}" role="status">${esc(text)}</p>`;
}

/** Inline error box shown when a submitted form fails validation. */
export function formError(text: string): string {
  return `<p class="notice err" role="alert">${esc(text)}</p>`;
}

export function field(label: string, name: string, type: string, value: string, attrs = ''): string {
  return `<label class="field"><span>${esc(label)}</span>
<input type="${type}" name="${name}" value="${esc(value)}" ${attrs}></label>`;
}

export function textField(label: string, name: string, value: string, attrs = ''): string {
  return field(label, name, 'text', value, attrs);
}

export function hiddenField(name: string, value: string): string {
  return `<input type="hidden" name="${name}" value="${esc(value)}">`;
}

export function submitButton(label: string): string {
  return `<button class="btn primary" type="submit">${esc(label)}</button>`;
}
