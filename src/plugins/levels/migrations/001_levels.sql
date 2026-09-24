-- ============================================================
--  نظام المستويات: صف واحد لكل عضو في كل سيرفر، مع عدّادات يومية وأسبوعية
--  تُصفّر ذرّيًا عند تغيّر اليوم/الأسبوع داخل نفس المعاملة.
-- ============================================================
CREATE TABLE IF NOT EXISTS level_members (
  guild_id          TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  xp                INTEGER NOT NULL DEFAULT 0,
  level             INTEGER NOT NULL DEFAULT 0,
  messages          INTEGER NOT NULL DEFAULT 0,
  voice_seconds     INTEGER NOT NULL DEFAULT 0,
  last_xp_at        INTEGER NOT NULL DEFAULT 0,
  last_content_hash TEXT,
  day_key           TEXT,
  daily_xp          INTEGER NOT NULL DEFAULT 0,
  week_key          TEXT,
  weekly_xp         INTEGER NOT NULL DEFAULT 0,
  updated_at        INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_level_members_xp ON level_members (guild_id, xp DESC);
CREATE INDEX IF NOT EXISTS idx_level_members_week ON level_members (guild_id, week_key, weekly_xp DESC);
CREATE INDEX IF NOT EXISTS idx_level_members_day ON level_members (guild_id, day_key, daily_xp DESC);

-- مكافآت المستويات: رتبة و/أو مال عند الوصول لمستوى
CREATE TABLE IF NOT EXISTS level_rewards (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  level       INTEGER NOT NULL,
  role_id     TEXT,
  money       INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_level_rewards ON level_rewards (guild_id, level);

-- مضاعفات XP لرتب أو قنوات
CREATE TABLE IF NOT EXISTS level_multipliers (
  guild_id     TEXT NOT NULL,
  target_type  TEXT NOT NULL CHECK (target_type IN ('role', 'channel')),
  target_id    TEXT NOT NULL,
  multiplier   REAL NOT NULL,
  PRIMARY KEY (guild_id, target_type, target_id)
);

-- أعضاء ممنوعون من كسب XP
CREATE TABLE IF NOT EXISTS level_blacklist (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  reason      TEXT,
  actor_id    TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- سجل تعديلات XP اليدوية والتحويلات والمكافآت (لا يُسجَّل XP الرسائل العادي لتفادي التضخم)
CREATE TABLE IF NOT EXISTS level_xp_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  delta       INTEGER NOT NULL,
  reason      TEXT,
  actor_id    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_level_xp_log ON level_xp_log (guild_id, user_id, created_at DESC);

-- @down
DROP TABLE IF EXISTS level_xp_log;
DROP TABLE IF EXISTS level_blacklist;
DROP TABLE IF EXISTS level_multipliers;
DROP TABLE IF EXISTS level_rewards;
DROP TABLE IF EXISTS level_members;
