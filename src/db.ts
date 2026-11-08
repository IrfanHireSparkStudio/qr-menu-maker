/** D1 data access. Every query uses prepared statements with bound values. */

import type {
  CategoryRow,
  ItemRow,
  PriceRow,
  RestaurantRow,
  SetupTokenRow,
  UserRow,
} from './types';

/** Free-plan item limit (25 items per restaurant, per the video spec). */
export const FREE_ITEM_LIMIT = 25;

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  const row = await db
    .prepare('SELECT * FROM users WHERE email = ?')
    .bind(email.toLowerCase())
    .first<UserRow>();
  return row ?? null;
}

export async function getUserById(db: D1Database, id: number): Promise<UserRow | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  return row ?? null;
}

export async function countAdmins(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getRestaurantByOwner(db: D1Database, ownerId: number): Promise<RestaurantRow | null> {
  const row = await db
    .prepare('SELECT * FROM restaurants WHERE owner_id = ?')
    .bind(ownerId)
    .first<RestaurantRow>();
  return row ?? null;
}

export async function getRestaurantBySlug(db: D1Database, slug: string): Promise<RestaurantRow | null> {
  const row = await db
    .prepare('SELECT * FROM restaurants WHERE slug = ?')
    .bind(slug)
    .first<RestaurantRow>();
  return row ?? null;
}

export async function getRestaurantById(db: D1Database, id: number): Promise<RestaurantRow | null> {
  const row = await db.prepare('SELECT * FROM restaurants WHERE id = ?').bind(id).first<RestaurantRow>();
  return row ?? null;
}

export async function countItems(db: D1Database, restaurantId: number): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM items WHERE restaurant_id = ?')
    .bind(restaurantId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getCategories(db: D1Database, restaurantId: number): Promise<CategoryRow[]> {
  const res = await db
    .prepare('SELECT * FROM categories WHERE restaurant_id = ? ORDER BY sort_order ASC, id ASC')
    .bind(restaurantId)
    .all<CategoryRow>();
  return res.results ?? [];
}

export async function getItemsWithPrices(
  db: D1Database,
  restaurantId: number,
): Promise<Array<ItemRow & { prices: PriceRow[] }>> {
  const itemsRes = await db
    .prepare(
      'SELECT * FROM items WHERE restaurant_id = ? ORDER BY category_id ASC, sort_order ASC, id ASC',
    )
    .bind(restaurantId)
    .all<ItemRow>();
  const items = itemsRes.results ?? [];
  const pricesRes = await db
    .prepare('SELECT * FROM prices WHERE restaurant_id = ? ORDER BY item_id ASC, sort_order ASC, id ASC')
    .bind(restaurantId)
    .all<PriceRow>();
  const byItem = new Map<number, PriceRow[]>();
  for (const p of pricesRes.results ?? []) {
    const list = byItem.get(p.item_id) ?? [];
    list.push(p);
    byItem.set(p.item_id, list);
  }
  return items.map((item) => ({ ...item, prices: byItem.get(item.id) ?? [] }));
}

export async function getSetupToken(db: D1Database, token: string): Promise<SetupTokenRow | null> {
  const row = await db
    .prepare('SELECT * FROM setup_tokens WHERE token = ?')
    .bind(token)
    .first<SetupTokenRow>();
  return row ?? null;
}

/** The latest still-valid, unused setup token for a user (for the admin "copy link" box). */
export async function getActiveSetupToken(db: D1Database, userId: number): Promise<SetupTokenRow | null> {
  const row = await db
    .prepare(
      'SELECT * FROM setup_tokens WHERE user_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1',
    )
    .bind(userId, Date.now())
    .first<SetupTokenRow>();
  return row ?? null;
}
