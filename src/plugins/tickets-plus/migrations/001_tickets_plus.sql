-- أعمدة جديدة على جدول التذاكر الموجود — كلها بقيم افتراضية آمنة للتذاكر القديمة
ALTER TABLE tickets ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
ALTER TABLE tickets ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tickets ADD COLUMN locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN sla_due_at INTEGER;
ALTER TABLE tickets ADD COLUMN sla_breached INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN escalated_at INTEGER;
ALTER TABLE tickets ADD COLUMN escalated_by TEXT;
ALTER TABLE tickets ADD COLUMN first_response_at INTEGER;
ALTER TABLE tickets ADD COLUMN first_responder TEXT;
ALTER TABLE tickets ADD COLUMN close_scheduled_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_tickets_priority ON tickets (guild_id, status, priority);

-- موظفون إضافيون مكلّفون بالتذكرة (غير المستلم)
CREATE TABLE IF NOT EXISTS ticket_assignees (
  ticket_id    INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  assigned_by  TEXT,
  assigned_at  INTEGER NOT NULL,
  PRIMARY KEY (ticket_id, user_id)
);

-- الخط الزمني لكل تذكرة (من غيّر ماذا ومتى)
CREATE TABLE IF NOT EXISTS ticket_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id   INTEGER NOT NULL,
  guild_id    TEXT NOT NULL,
  action      TEXT NOT NULL,
  actor_id    TEXT,
  data        TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_events ON ticket_events (ticket_id, id);

-- @down
DROP TABLE IF EXISTS ticket_events;
DROP TABLE IF EXISTS ticket_assignees;
DROP INDEX IF EXISTS idx_tickets_priority;
ALTER TABLE tickets DROP COLUMN close_scheduled_at;
ALTER TABLE tickets DROP COLUMN first_responder;
ALTER TABLE tickets DROP COLUMN first_response_at;
ALTER TABLE tickets DROP COLUMN escalated_by;
ALTER TABLE tickets DROP COLUMN escalated_at;
ALTER TABLE tickets DROP COLUMN sla_breached;
ALTER TABLE tickets DROP COLUMN sla_due_at;
ALTER TABLE tickets DROP COLUMN locked;
ALTER TABLE tickets DROP COLUMN tags;
ALTER TABLE tickets DROP COLUMN priority;
