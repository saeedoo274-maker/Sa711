-- ============================================================
--  سجل السيرفرات وحماية البوت من الإساءة
-- ============================================================

CREATE TABLE IF NOT EXISTS guild_registry (
  guild_id          TEXT PRIMARY KEY,
  name              TEXT,
  owner_id          TEXT,
  member_count      INTEGER NOT NULL DEFAULT 0,
  icon_url          TEXT,
  joined_at         INTEGER NOT NULL,
  left_at           INTEGER,
  status            TEXT NOT NULL DEFAULT 'active',
  blacklist_reason  TEXT,
  blacklisted_by    TEXT,
  blacklisted_at    INTEGER,
  commands_used     INTEGER NOT NULL DEFAULT 0,
  last_used_at      INTEGER,
  notes             TEXT
);
CREATE INDEX IF NOT EXISTS idx_registry_status ON guild_registry (status, member_count DESC);

-- سجل أحداث الإساءة: إغراق أوامر، محاولات تجاوز صلاحيات، إلخ
CREATE TABLE IF NOT EXISTS abuse_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT,
  kind        TEXT NOT NULL,
  detail      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_abuse_guild ON abuse_events (guild_id, created_at DESC);

-- حالة الإغلاق الطارئ: تحفظ وضع كل قناة قبل القفل لاستعادته بدقة
CREATE TABLE IF NOT EXISTS lockdowns (
  guild_id     TEXT PRIMARY KEY,
  started_by   TEXT NOT NULL,
  started_at   INTEGER NOT NULL,
  reason       TEXT,
  channels     TEXT NOT NULL DEFAULT '[]'
);
