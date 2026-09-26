-- target: system:<feature> | <command> | <command>:<subcommand>
-- subject_type: role | channel      effect: allow | deny
CREATE TABLE IF NOT EXISTS permission_rules (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id      TEXT NOT NULL,
  target        TEXT NOT NULL,
  subject_type  TEXT NOT NULL,
  subject_id    TEXT NOT NULL,
  effect        TEXT NOT NULL,
  created_by    TEXT,
  created_at    INTEGER NOT NULL,
  UNIQUE (guild_id, target, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS idx_permission_rules_guild ON permission_rules (guild_id);

-- @down
DROP INDEX IF EXISTS idx_permission_rules_guild;
DROP TABLE IF EXISTS permission_rules;
