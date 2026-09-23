-- ============================================================
--  جداول الأنظمة: التذاكر، السحوبات، الاستطلاعات، الرتب الذاتية
-- ============================================================

CREATE TABLE IF NOT EXISTS ticket_panels (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT,
  message_id  TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_panels_guild ON ticket_panels (guild_id);

CREATE TABLE IF NOT EXISTS giveaways (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id            TEXT NOT NULL,
  channel_id          TEXT NOT NULL,
  message_id          TEXT,
  prize               TEXT NOT NULL,
  winners_count       INTEGER NOT NULL DEFAULT 1,
  host_id             TEXT NOT NULL,
  required_role_id    TEXT,
  bonus_role_id       TEXT,
  bonus_entries       INTEGER NOT NULL DEFAULT 1,
  min_account_age_ms  INTEGER,
  ends_at             INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_giveaways_status ON giveaways (status, ends_at);

CREATE TABLE IF NOT EXISTS giveaway_entries (
  giveaway_id  INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  entries      INTEGER NOT NULL DEFAULT 1,
  joined_at    INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS giveaway_winners (
  giveaway_id  INTEGER NOT NULL,
  user_id      TEXT NOT NULL,
  drawn_at     INTEGER NOT NULL,
  PRIMARY KEY (giveaway_id, user_id, drawn_at)
);

CREATE TABLE IF NOT EXISTS polls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  message_id  TEXT,
  question    TEXT NOT NULL,
  options     TEXT NOT NULL,
  multiple    INTEGER NOT NULL DEFAULT 0,
  anonymous   INTEGER NOT NULL DEFAULT 1,
  author_id   TEXT NOT NULL,
  ends_at     INTEGER,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls (status, ends_at);

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id       INTEGER NOT NULL,
  user_id       TEXT NOT NULL,
  option_index  INTEGER NOT NULL,
  voted_at      INTEGER NOT NULL,
  PRIMARY KEY (poll_id, user_id, option_index)
);

CREATE TABLE IF NOT EXISTS self_role_panels (
  id          TEXT PRIMARY KEY,
  guild_id    TEXT NOT NULL,
  channel_id  TEXT,
  message_id  TEXT,
  config      TEXT NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_self_role_panels_guild ON self_role_panels (guild_id);
