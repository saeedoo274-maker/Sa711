-- ============================================================
--  أنظمة الحياة الواقعية (RP): العناصر، الوظائف، السرقات، السجن
--  تُبنى فوق نظام الاقتصاد الموجود (accounts) ولا تستبدله.
-- ============================================================

-- كتالوج العناصر — قابل للتعديل من الأوامر بلا لمس الكود
CREATE TABLE IF NOT EXISTS rp_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  key           TEXT NOT NULL,
  label         TEXT NOT NULL,
  emoji         TEXT,
  sell_price    INTEGER NOT NULL DEFAULT 0,
  buy_price     INTEGER,
  category      TEXT,
  illegal       INTEGER NOT NULL DEFAULT 0,
  stock         INTEGER,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);
CREATE INDEX IF NOT EXISTS idx_rp_items_guild ON rp_items (guild_id, enabled);

-- حقيبة كل عضو. الكمية لا تكون سالبة أبدًا (شرط داخل UPDATE نفسه).
CREATE TABLE IF NOT EXISTS rp_inventory (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_rp_inv_user ON rp_inventory (guild_id, user_id);

-- سجل حركة العناصر، للتتبّع وكشف أي تلاعب
CREATE TABLE IF NOT EXISTS rp_inventory_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  item_key    TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  actor_id    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_invlog ON rp_inventory_log (guild_id, user_id, created_at DESC);

-- الوظائف المدنية — تُعرَّف من الأوامر، وتقبل التوسّع بلا تعديل كود
CREATE TABLE IF NOT EXISTS rp_jobs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id       TEXT NOT NULL,
  key            TEXT NOT NULL,
  label          TEXT NOT NULL,
  emoji          TEXT,
  role_id        TEXT,
  image_url      TEXT,
  reward_item    TEXT,
  reward_min     INTEGER NOT NULL DEFAULT 1,
  reward_max     INTEGER NOT NULL DEFAULT 3,
  duration_ms    INTEGER NOT NULL DEFAULT 60000,
  cooldown_ms    INTEGER NOT NULL DEFAULT 0,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);

-- جلسة عمل واحدة مفتوحة لكل عضو في كل لحظة
CREATE TABLE IF NOT EXISTS rp_job_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  job_key      TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  ends_at      INTEGER NOT NULL,
  collected_at INTEGER,
  reward_item  TEXT,
  reward_qty   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rp_sessions_open ON rp_job_sessions (guild_id, user_id, collected_at);

-- مواقع العمل (مواقع الصيد/الحطب) — عرض توضيحي بالصور
CREATE TABLE IF NOT EXISTS rp_locations (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  job_key     TEXT NOT NULL,
  name        TEXT NOT NULL,
  image_url   TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_locations ON rp_locations (guild_id, job_key);

-- أنواع السرقات
CREATE TABLE IF NOT EXISTS rp_robberies (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  key             TEXT NOT NULL,
  label           TEXT NOT NULL,
  emoji           TEXT,
  image_url       TEXT,
  required_item   TEXT,
  consume_item    INTEGER NOT NULL DEFAULT 0,
  reward_min      INTEGER NOT NULL DEFAULT 100,
  reward_max      INTEGER NOT NULL DEFAULT 500,
  success_percent INTEGER NOT NULL DEFAULT 70,
  duration_ms     INTEGER NOT NULL DEFAULT 60000,
  cooldown_ms     INTEGER NOT NULL DEFAULT 600000,
  min_police      INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  UNIQUE (guild_id, key)
);

CREATE TABLE IF NOT EXISTS rp_robbery_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  robbery_key   TEXT NOT NULL,
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL,
  resolved_at   INTEGER,
  success       INTEGER,
  reward        INTEGER
);
CREATE INDEX IF NOT EXISTS idx_rp_rob_open ON rp_robbery_sessions (guild_id, user_id, resolved_at);

-- السجن — ينجو من إعادة تشغيل البوت لأن الحالة في القاعدة لا في الذاكرة
CREATE TABLE IF NOT EXISTS rp_jail (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  user_id       TEXT NOT NULL,
  reason        TEXT,
  duration_ms   INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  ends_at       INTEGER NOT NULL,
  released_at   INTEGER,
  released_by   TEXT,
  saved_roles   TEXT NOT NULL DEFAULT '[]',
  jailed_by     TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_jail_active ON rp_jail (guild_id, user_id, released_at);
CREATE INDEX IF NOT EXISTS idx_rp_jail_due ON rp_jail (released_at, ends_at);

-- المطلوبون
CREATE TABLE IF NOT EXISTS rp_wanted (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  level        INTEGER NOT NULL DEFAULT 1,
  reason       TEXT,
  added_by     TEXT NOT NULL,
  cleared_at   INTEGER,
  cleared_by   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rp_wanted_active ON rp_wanted (guild_id, user_id, cleared_at);
