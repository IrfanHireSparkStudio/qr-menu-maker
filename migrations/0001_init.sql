-- QR Menu Maker — D1 schema (V1)
-- Apply with: wrangler d1 migrations apply qr-menu-maker-db --remote
-- (or --local for local development)
--
-- Rules from the spec:
--   * Tables: users, sessions, restaurants, categories, items, prices.
--   * Every table holding restaurant data has a restaurant_id column.
--   * An auto-increment ID column in every table.
--   * setup_tokens + login_attempts are supporting tables (invites + login limits).
--   * One owner = one restaurant (restaurants.owner_id is UNIQUE).
--   * A restaurant slug NEVER changes once set (enforced in the app, not in SQL).

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  -- PBKDF2 hash, format: pbkdf2$100000$<hex salt>$<hex key>.
  -- Invited owners get an unusable hash starting with '!' until they set a password.
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'owner')),
  name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE restaurants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  address TEXT,
  maps_url TEXT,
  whatsapp_number TEXT,
  logo_url TEXT,
  -- V1 is PKR-only. The column exists so V2 can add currency/country switching.
  currency TEXT NOT NULL DEFAULT 'PKR',
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  name TEXT NOT NULL,
  name_ur TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  category_id INTEGER NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  name_ur TEXT,
  description TEXT,
  description_ur TEXT,
  photo_url TEXT,
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Price variants per item: Half / Full, Small / Medium / Large, Regular, ...
-- One row per variant. An item with a single 'Regular' price shows just the amount.
CREATE TABLE prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  label TEXT NOT NULL,
  label_ur TEXT,
  amount INTEGER NOT NULL, -- minor units (paisa). 45000 = Rs 450
  currency TEXT NOT NULL DEFAULT 'PKR',
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- One-time password-setup links for admin-invited owners (72h expiry).
CREATE TABLE setup_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- Failed login attempts, for the login-attempt limit (5 per 15 minutes per email).
CREATE TABLE login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_restaurants_slug ON restaurants(slug);
CREATE INDEX idx_restaurants_owner ON restaurants(owner_id);
CREATE INDEX idx_categories_restaurant ON categories(restaurant_id);
CREATE INDEX idx_items_restaurant ON items(restaurant_id);
CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_prices_item ON prices(item_id);
CREATE INDEX idx_setup_tokens_token ON setup_tokens(token);
CREATE INDEX idx_login_attempts_email ON login_attempts(email, attempted_at);
