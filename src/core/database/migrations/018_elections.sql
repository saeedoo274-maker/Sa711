-- ============================================================
--  التصويت والانتخابات بمرشحين
--  مختلف عن الاستطلاعات العامة (polls): كل خيار هنا مرشح له ملف
--  (اسم، برنامج انتخابي، صورة)، ويحتاج تسجيلًا وموافقة إدارية قبل ظهوره.
-- ============================================================

CREATE TABLE IF NOT EXISTS elections (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id            TEXT NOT NULL,
  title               TEXT NOT NULL,
  description         TEXT,
  registration_open   INTEGER NOT NULL DEFAULT 1,
  voting_open         INTEGER NOT NULL DEFAULT 0,
  multiple_votes      INTEGER NOT NULL DEFAULT 0,
  channel_id          TEXT,
  message_id          TEXT,
  status              TEXT NOT NULL DEFAULT 'registration',
  created_by          TEXT NOT NULL,
  created_at          INTEGER NOT NULL,
  closed_at           INTEGER
);
CREATE INDEX IF NOT EXISTS idx_elections_guild ON elections (guild_id, status);

CREATE TABLE IF NOT EXISTS candidates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  election_id    INTEGER NOT NULL,
  user_id        TEXT NOT NULL,
  platform       TEXT NOT NULL,
  image_url      TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  reviewer_id    TEXT,
  reviewed_at    INTEGER,
  note           TEXT,
  created_at     INTEGER NOT NULL,
  UNIQUE (election_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates (election_id, status);

CREATE TABLE IF NOT EXISTS election_votes (
  election_id    INTEGER NOT NULL,
  candidate_id   INTEGER NOT NULL,
  voter_id       TEXT NOT NULL,
  voted_at       INTEGER NOT NULL,
  PRIMARY KEY (election_id, voter_id, candidate_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_candidate ON election_votes (candidate_id);
