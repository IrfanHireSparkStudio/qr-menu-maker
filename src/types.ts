import type { Context, Hono } from 'hono';

export interface Env {
  DB: D1Database;
  MENU_PHOTOS: R2Bucket;
  /** One-time token protecting the first-admin setup page. Set via `wrangler secret put`. */
  SETUP_TOKEN: string;
  /** Public Turnstile site key (not a secret). May be empty = Turnstile disabled. */
  TURNSTILE_SITE_KEY?: string;
  /** Turnstile secret key. Set via `wrangler secret put`. May be empty = Turnstile disabled. */
  TURNSTILE_SECRET_KEY?: string;
}

export type Role = 'admin' | 'owner';
export type Plan = 'free' | 'pro';

/** Hono context variables set by the auth middleware. */
export interface Vars {
  user: UserRow | null;
  restaurant: RestaurantRow | null;
}

export type App = Hono<{ Bindings: Env; Variables: Vars }>;

/** The request context type used by the shared helpers in security.ts. */
export type Ctx = Context<{ Bindings: Env; Variables: Vars }>;

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  role: Role;
  name: string | null;
  created_at: number;
}

export interface SessionRow {
  id: number;
  user_id: number;
  token: string;
  created_at: number;
  expires_at: number;
}

export interface RestaurantRow {
  id: number;
  owner_id: number;
  name: string;
  slug: string;
  description: string | null;
  address: string | null;
  maps_url: string | null;
  whatsapp_number: string | null;
  logo_url: string | null;
  currency: string;
  plan: Plan;
  created_at: number;
  updated_at: number;
}

export interface CategoryRow {
  id: number;
  restaurant_id: number;
  name: string;
  name_ur: string | null;
  sort_order: number;
  created_at: number;
}

export interface ItemRow {
  id: number;
  restaurant_id: number;
  category_id: number;
  name: string;
  name_ur: string | null;
  description: string | null;
  description_ur: string | null;
  photo_url: string | null;
  is_available: number;
  sort_order: number;
  created_at: number;
}

export interface PriceRow {
  id: number;
  restaurant_id: number;
  item_id: number;
  label: string;
  label_ur: string | null;
  amount: number; // minor units (paisa). 45000 = Rs 450
  currency: string;
  sort_order: number;
}

export interface SetupTokenRow {
  id: number;
  user_id: number;
  token: string;
  expires_at: number;
  used_at: number | null;
}
