/**
 * Photo uploads to Workers KV (item photos, restaurant logos).
 *
 * Photos are stored as binary KV values; the upload content-type is kept
 * in the KV metadata so the serve route can return it. (KV was chosen
 * over R2 because R2 activation needs a payment method + billing address;
 * if R2 billing is activated later, photos can move back to R2.)
 *
 * Rules from the spec:
 * - JPG / WebP / PNG only. SVG is never accepted (it can carry scripts).
 * - Server-side size limit: 2 MB per photo (well under KV's 25 MB value limit).
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

/** Metadata stored with each photo KV value. */
export interface PhotoMetadata {
  contentType: string;
}

export async function handlePhotoUpload(
  kv: KVNamespace,
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
  await kv.put(key, buf, { metadata: { contentType: file.type } satisfies PhotoMetadata });
  return { ok: true, path: `/photos/${encodeURIComponent(key).replace(/%2F/g, '/')}` };
}

/** Delete a KV photo for a stored /photos/... path (best effort, errors ignored). */
export async function deletePhoto(kv: KVNamespace, photoPath: string | null): Promise<void> {
  if (!photoPath || !photoPath.startsWith('/photos/')) return;
  try {
    await kv.delete(decodeURIComponent(photoPath.slice('/photos/'.length)));
  } catch {
    // best effort only
  }
}
