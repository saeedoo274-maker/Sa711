-- ============================================================
--  لوحة التحكم و REST API
-- ============================================================

-- جلسات لوحة التحكم: يُخزَّن تجزئة المعرّف فقط (لا المعرّف نفسه)
CREATE TABLE IF NOT EXISTS web_sessions (
  id_hash     TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  username    TEXT,
  avatar      TEXT,
  guilds      TEXT NOT NULL DEFAULT '[]',   -- السيرفرات التي يديرها (من OAuth2)
  csrf        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  last_seen   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_exp ON web_sessions (expires_at);

-- مفاتيح API لكل سيرفر: تجزئة المفتاح فقط + بادئة للعرض
CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  prefix        TEXT NOT NULL,
  scopes        TEXT NOT NULL DEFAULT '["read"]',
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_api_keys_guild ON api_keys (guild_id, revoked);

-- @down
DROP INDEX IF EXISTS idx_api_keys_guild;
DROP TABLE IF EXISTS api_keys;
DROP INDEX IF EXISTS idx_web_sessions_exp;
DROP TABLE IF EXISTS web_sessions;
