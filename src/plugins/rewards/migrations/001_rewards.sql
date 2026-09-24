-- سجل كل مكافأة مُنحت (من أي مصدر): للتدقيق وكشف أي تكرار
CREATE TABLE IF NOT EXISTS reward_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL,        -- level | achievement | daily_login | weekly_activity | staff_weekly | event | admin
  source_ref  TEXT,
  money       INTEGER NOT NULL DEFAULT 0,
  xp          INTEGER NOT NULL DEFAULT 0,
  role_id     TEXT,
  item_key    TEXT,
  item_qty    INTEGER NOT NULL DEFAULT 0,
  badge       TEXT,
  actor_id    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reward_log_user ON reward_log (guild_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reward_log_source ON reward_log (guild_id, source, created_at DESC);

-- مطالبة واحدة لكل عضو في كل فترة (يوم/أسبوع) — المفتاح الأساسي يمنع التكرار ذرّيًا
CREATE TABLE IF NOT EXISTS reward_claims (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  claimed_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, kind, period_key)
);

-- كتالوج الشارات لكل سيرفر
CREATE TABLE IF NOT EXISTS badges (
  guild_id     TEXT NOT NULL,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  emoji        TEXT,
  description  TEXT,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, key)
);

-- الشارات التي يملكها الأعضاء
CREATE TABLE IF NOT EXISTS member_badges (
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  badge       TEXT NOT NULL,
  source      TEXT,
  awarded_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, badge)
);

-- @down
DROP TABLE IF EXISTS member_badges;
DROP TABLE IF EXISTS badges;
DROP TABLE IF EXISTS reward_claims;
DROP TABLE IF EXISTS reward_log;
