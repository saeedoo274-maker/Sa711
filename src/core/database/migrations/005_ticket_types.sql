-- ============================================================
--  أنواع التذاكر: كل نوع له كاتيغوري ورتبة دعم ونموذج أسئلة خاص
--  يسمح ببناء قوائم خدمات متعددة تفتح كل واحدة تذكرة مختلفة
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_types (
  id                TEXT PRIMARY KEY,
  guild_id          TEXT NOT NULL,
  name              TEXT NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  emoji             TEXT,
  category_id       TEXT,
  staff_role_id     TEXT,
  welcome_embed_id  TEXT,
  name_template     TEXT,
  questions         TEXT NOT NULL DEFAULT '[]',
  max_open          INTEGER NOT NULL DEFAULT 1,
  created_at        INTEGER NOT NULL,
  UNIQUE (guild_id, name)
);
CREATE INDEX IF NOT EXISTS idx_ticket_types_guild ON ticket_types (guild_id);

-- ربط التذكرة بنوعها وحفظ إجابات النموذج
ALTER TABLE tickets ADD COLUMN type_id TEXT;
ALTER TABLE tickets ADD COLUMN answers TEXT;
