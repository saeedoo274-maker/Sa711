-- عدّادات المقاييس لكل عضو (تُحدَّث دفعات كل 30 ثانية)
CREATE TABLE IF NOT EXISTS member_metrics (
  guild_id  TEXT NOT NULL,
  user_id   TEXT NOT NULL,
  metric    TEXT NOT NULL,
  value     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, metric)
);

-- إنجازات مخصصة من الإدارة، أو تجاوزات للمدمجة (تعطيل/تعديل مكافأة)
CREATE TABLE IF NOT EXISTS achievements (
  guild_id     TEXT NOT NULL,
  key          TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT,
  emoji        TEXT,
  category     TEXT NOT NULL,
  metric       TEXT NOT NULL,
  target       INTEGER NOT NULL,
  hidden       INTEGER NOT NULL DEFAULT 0,
  reward       TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (guild_id, key)
);

-- الإنجاز يُفتح مرة واحدة فقط (المفتاح الأساسي)
CREATE TABLE IF NOT EXISTS achievement_unlocks (
  guild_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  unlocked_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_ach_unlocks_guild ON achievement_unlocks (guild_id, unlocked_at DESC);

-- @down
DROP TABLE IF EXISTS achievement_unlocks;
DROP TABLE IF EXISTS achievements;
DROP TABLE IF EXISTS member_metrics;
