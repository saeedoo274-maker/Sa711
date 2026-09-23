-- ============================================================
--  نظام بناء الإمبيدات والأوامر المخصصة
--  يسمح بإنشاء إمبيدات وأزرار وقوائم وأوامر بالكامل من داخل ديسكورد
-- ============================================================

CREATE TABLE IF NOT EXISTS embeds (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  content     TEXT,
  data        TEXT NOT NULL DEFAULT '{}',
  components  TEXT NOT NULL DEFAULT '[]',
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_embeds_guild ON embeds (guild_id);

-- الرسائل المنشورة من كل إمبيد، حتى يمكن تحديثها لاحقًا بعد التعديل
CREATE TABLE IF NOT EXISTS embed_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  embed_id    TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_embed_messages ON embed_messages (embed_id);

CREATE TABLE IF NOT EXISTS custom_commands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id        TEXT NOT NULL,
  name            TEXT NOT NULL,
  prefix          TEXT,
  embed_id        TEXT,
  content         TEXT,
  ephemeral       INTEGER NOT NULL DEFAULT 0,
  delete_trigger  INTEGER NOT NULL DEFAULT 0,
  min_level       INTEGER NOT NULL DEFAULT 0,
  allow_mentions  INTEGER NOT NULL DEFAULT 0,
  uses            INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT,
  created_at      INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_custom_commands_guild ON custom_commands (guild_id);
