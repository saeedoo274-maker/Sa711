-- تاريخ الأسماء: guild_id = '*' لاسم المستخدم العام (يتبع الحساب لا السيرفر)
CREATE TABLE IF NOT EXISTS member_name_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('username', 'globalname', 'nickname')),
  old_value   TEXT,
  new_value   TEXT,
  changed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_name_hist_user ON member_name_history (user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_name_hist_value ON member_name_history (new_value);

CREATE TABLE IF NOT EXISTS member_role_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role_id     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('add', 'remove')),
  actor_id    TEXT,
  changed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_role_hist ON member_role_history (guild_id, user_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS member_presence_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('join', 'leave')),
  username    TEXT,
  at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_presence ON member_presence_log (guild_id, user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_presence_guild ON member_presence_log (guild_id, action, at);

-- نشاط يومي مجمّع لكل عضو (صف لكل يوم لا لكل رسالة)
CREATE TABLE IF NOT EXISTS member_activity_daily (
  guild_id       TEXT NOT NULL,
  user_id        TEXT NOT NULL,
  day            TEXT NOT NULL,
  messages       INTEGER NOT NULL DEFAULT 0,
  voice_seconds  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_activity_day ON member_activity_daily (guild_id, day);

CREATE TABLE IF NOT EXISTS member_last_seen (
  guild_id         TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  last_message_at  INTEGER,
  last_channel_id  TEXT,
  last_voice_at    INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

-- @down
DROP TABLE IF EXISTS member_last_seen;
DROP TABLE IF EXISTS member_activity_daily;
DROP TABLE IF EXISTS member_presence_log;
DROP TABLE IF EXISTS member_role_history;
DROP TABLE IF EXISTS member_name_history;
