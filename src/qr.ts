/**
 * QR codes, generated server-side as SVG.
 *
 * Workers has no canvas, so the QR is an SVG string. The dashboard offers
 * a "Download PNG" button that converts this SVG to PNG in the browser
 * (canvas), and /r/:slug/qr.svg serves the same SVG directly.
 * No external QR API is called — no data leaves Cloudflare.
 */

import QRCode from 'qrcode-generator';

/** Build an SVG QR code for a URL. Throws when the URL is too long to encode. */
export function qrSvgForUrl(url: string): string {
  const qr = QRCode(0, 'M'); // 0 = auto version, M = medium error correction
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}
