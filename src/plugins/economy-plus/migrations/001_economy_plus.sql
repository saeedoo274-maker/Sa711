-- ============================================================
--  توسعة الاقتصاد: فوق accounts/transactions/loans الموجودة (لا اقتصاد ثانٍ)
--  والمخزون الموحّد هو rp_inventory الموجود.
-- ============================================================

-- تبريد وسلاسل المطالبات (يومي/أسبوعي/شهري/عمل/سرقة) — ذرّي بشرط داخل UPDATE
CREATE TABLE IF NOT EXISTS econ_cooldowns (
  guild_id   TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  action     TEXT NOT NULL,
  last_at    INTEGER NOT NULL,
  period     TEXT,
  streak     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, action)
);

CREATE TABLE IF NOT EXISTS econ_jobs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  emoji           TEXT,
  min_pay         INTEGER NOT NULL,
  max_pay         INTEGER NOT NULL,
  required_level  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE IF NOT EXISTS econ_member_jobs (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  job_id    INTEGER NOT NULL,
  since     INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- المتجر
CREATE TABLE IF NOT EXISTS shop_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id         TEXT NOT NULL,
  key              TEXT NOT NULL,
  name             TEXT NOT NULL,
  description      TEXT,
  emoji            TEXT,
  type             TEXT NOT NULL DEFAULT 'item' CHECK (type IN ('item', 'role', 'cosmetic', 'badge')),
  price            INTEGER NOT NULL CHECK (price >= 0),
  sell_price       INTEGER,
  stock            INTEGER,
  role_id          TEXT,
  badge_key        TEXT,
  data             TEXT,
  discount_percent INTEGER NOT NULL DEFAULT 0,
  offer_ends_at    INTEGER,
  per_user_limit   INTEGER,
  required_level   INTEGER NOT NULL DEFAULT 0,
  enabled          INTEGER NOT NULL DEFAULT 1,
  created_at       INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  item_id     INTEGER NOT NULL,
  item_key    TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  unit_price  INTEGER NOT NULL,
  total       INTEGER NOT NULL,
  refunded    INTEGER NOT NULL DEFAULT 0,
  refunded_by TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shop_purchases_user ON shop_purchases (guild_id, user_id, created_at DESC);

-- التجميلات المُجهّزة (مثل خلفية بطاقة الرتبة)
CREATE TABLE IF NOT EXISTS member_cosmetics (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  slot      TEXT NOT NULL,
  item_key  TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id, slot)
);

-- الاستثمارات (ودائع لأجل بعائد)
CREATE TABLE IF NOT EXISTS econ_investments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  plan        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  rate        REAL NOT NULL,
  started_at  INTEGER NOT NULL,
  matures_at  INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active', -- active | claimed | withdrawn
  payout      INTEGER,
  closed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invest_user ON econ_investments (guild_id, user_id, status);

-- السوق بين الأعضاء
CREATE TABLE IF NOT EXISTS econ_market (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  seller_id   TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  quantity    INTEGER NOT NULL,
  price       INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active', -- active | sold | cancelled
  buyer_id    TEXT,
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_market_active ON econ_market (guild_id, status, created_at DESC);

-- المزادات: المزايدة الأعلى محجوزة من رصيد صاحبها وتُعاد عند تجاوزها
CREATE TABLE IF NOT EXISTS econ_auctions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  seller_id    TEXT NOT NULL,
  item_key     TEXT NOT NULL,
  quantity     INTEGER NOT NULL,
  min_bid      INTEGER NOT NULL,
  top_bid      INTEGER,
  top_bidder   TEXT,
  channel_id   TEXT,
  message_id   TEXT,
  ends_at      INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active', -- active | ended | cancelled
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auctions_active ON econ_auctions (guild_id, status, ends_at);

CREATE TABLE IF NOT EXISTS econ_bids (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id  INTEGER NOT NULL REFERENCES econ_auctions(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);

-- التداول: عرض بين عضوين (مال + عناصر من الطرفين)
CREATE TABLE IF NOT EXISTS econ_trades (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  offer_money   INTEGER NOT NULL DEFAULT 0,
  offer_item    TEXT,
  offer_qty     INTEGER NOT NULL DEFAULT 0,
  want_money    INTEGER NOT NULL DEFAULT 0,
  want_item     TEXT,
  want_qty      INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled | expired
  expires_at    INTEGER NOT NULL,
  created_at    INTEGER NOT NULL,
  closed_at     INTEGER
);

-- القروض الموجودة: فائدة وموعد استحقاق (أعمدة جديدة بقيم افتراضية آمنة للبيانات القديمة)
ALTER TABLE loans ADD COLUMN interest_percent REAL NOT NULL DEFAULT 0;
ALTER TABLE loans ADD COLUMN due_at INTEGER;

-- @down
ALTER TABLE loans DROP COLUMN due_at;
ALTER TABLE loans DROP COLUMN interest_percent;
DROP TABLE IF EXISTS econ_trades;
DROP TABLE IF EXISTS econ_bids;
DROP TABLE IF EXISTS econ_auctions;
DROP TABLE IF EXISTS econ_market;
DROP TABLE IF EXISTS econ_investments;
DROP TABLE IF EXISTS member_cosmetics;
DROP TABLE IF EXISTS shop_purchases;
DROP TABLE IF EXISTS shop_items;
DROP TABLE IF EXISTS econ_member_jobs;
DROP TABLE IF EXISTS econ_jobs;
DROP TABLE IF EXISTS econ_cooldowns;
