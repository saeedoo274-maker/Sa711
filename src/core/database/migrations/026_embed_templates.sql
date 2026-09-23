-- ============================================================
--  قوالب الإمبيد واختصارات الأوامر المخصصة
-- ============================================================

-- قالب: نسخة محفوظة بالاسم تُحمَّل على أي إمبيد جديد
CREATE TABLE IF NOT EXISTS embed_templates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  content     TEXT,
  data        TEXT NOT NULL DEFAULT '{}',
  components  TEXT NOT NULL DEFAULT '[]',
  uses        INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_embed_templates ON embed_templates (guild_id);

-- اختصارات الأوامر المخصصة: اسم بديل يشير لنفس الأمر
CREATE TABLE IF NOT EXISTS custom_command_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  command_id  INTEGER NOT NULL,
  alias       TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  UNIQUE (guild_id, alias)
);
CREATE INDEX IF NOT EXISTS idx_cc_aliases ON custom_command_aliases (guild_id, command_id);

-- مهلة التبريد للأوامر المخصصة (ALTER آمن: يُتجاهل لو العمود موجود)
ALTER TABLE custom_commands ADD COLUMN cooldown_ms INTEGER NOT NULL DEFAULT 0;
