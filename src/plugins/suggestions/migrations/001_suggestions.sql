CREATE TABLE IF NOT EXISTS suggestions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id     TEXT NOT NULL,
  number       INTEGER NOT NULL,
  author_id    TEXT NOT NULL,
  content      TEXT NOT NULL,
  anonymous    INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending | review | accepted | rejected
  channel_id   TEXT,
  message_id   TEXT,
  thread_id    TEXT,
  upvotes      INTEGER NOT NULL DEFAULT 0,
  downvotes    INTEGER NOT NULL DEFAULT 0,
  staff_id     TEXT,
  response     TEXT,
  archived     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  decided_at   INTEGER,
  UNIQUE (guild_id, number)
);
CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions (guild_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_author ON suggestions (guild_id, author_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_suggestions_message ON suggestions (message_id);

-- صوت واحد لكل عضو في كل اقتراح: المفتاح الأساسي يمنع التكرار ذرّيًا
CREATE TABLE IF NOT EXISTS suggestion_votes (
  suggestion_id  INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  user_id        TEXT NOT NULL,
  vote           INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  voted_at       INTEGER NOT NULL,
  PRIMARY KEY (suggestion_id, user_id)
);

CREATE TABLE IF NOT EXISTS suggestion_counters (
  guild_id     TEXT PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0
);

-- سجل تغييرات الحالة (من غيّر ماذا ومتى)
CREATE TABLE IF NOT EXISTS suggestion_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  suggestion_id  INTEGER NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
  status         TEXT NOT NULL,
  staff_id       TEXT,
  reason         TEXT,
  created_at     INTEGER NOT NULL
);

-- @down
DROP TABLE IF EXISTS suggestion_history;
DROP TABLE IF EXISTS suggestion_counters;
DROP TABLE IF EXISTS suggestion_votes;
DROP TABLE IF EXISTS suggestions;
