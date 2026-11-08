/**
 * Photo uploads to R2 (item photos, restaurant logos).
 *
 * Rules from the spec:
 * - JPG / WebP / PNG only. SVG is never accepted (it can carry scripts).
 * - Server-side size limit: 2 MB per photo.
 * - Files are stored under restaurants/<restaurant_id>/... and served
 *   same-origin through /photos/:key, so the CSP stays tight.
 */

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

export interface UploadResult {
  ok: boolean;
  /** Same-origin path to use in <img src>, e.g. /photos/restaurants/3/items/9-a1b2.jpg */
  path?: string;
  error?: string;
}

export async function handlePhotoUpload(
  bucket: R2Bucket,
  file: File | null,
  keyPrefix: string,
): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: 'No file chosen.' };
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, error: 'Photo must be 2 MB or smaller.' };
  const ext = ALLOWED_TYPES.get(file.type);
  if (!ext) return { ok: false, error: 'Only JPG, PNG or WebP photos are allowed (never SVG).' };
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const key = `${keyPrefix}-${random}.${ext}`;
  const buf = await file.arrayBuffer();
  await bucket.put(key, buf, { httpMetadata: { contentType: file.type } });
  return { ok: true, path: `/photos/${encodeURIComponent(key).replace(/%2F/g, '/')}` };
}

/** Delete an R2 object for a stored /photos/... path (best effort, errors ignored). */
export async function deletePhoto(bucket: R2Bucket, photoPath: string | null): Promise<void> {
  if (!photoPath || !photoPath.startsWith('/photos/')) return;
  try {
    await bucket.delete(decodeURIComponent(photoPath.slice('/photos/'.length)));
  } catch {
    // best effort only
  }
}
