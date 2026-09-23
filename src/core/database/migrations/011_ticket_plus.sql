-- ============================================================
--  تحسينات التذاكر: الترقيم، التقييم، تتبّع النشاط، الإغلاق التلقائي
-- ============================================================

ALTER TABLE tickets ADD COLUMN number INTEGER;
ALTER TABLE tickets ADD COLUMN last_activity_at INTEGER;
ALTER TABLE tickets ADD COLUMN warned_at INTEGER;
ALTER TABLE tickets ADD COLUMN claimed_first_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_tickets_activity ON tickets (status, last_activity_at);

CREATE TABLE IF NOT EXISTS ticket_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ticket_ratings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  ticket_id     INTEGER,
  ticket_number INTEGER,
  user_id       TEXT NOT NULL,
  staff_id      TEXT,
  stars         INTEGER NOT NULL,
  note          TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, ticket_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ratings_staff ON ticket_ratings (guild_id, staff_id);
