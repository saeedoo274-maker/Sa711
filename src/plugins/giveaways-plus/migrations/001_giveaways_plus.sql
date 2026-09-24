-- أعمدة اختيارية على جدول السحوبات الموجود — السحوبات القديمة تبقى كما هي (قيم NULL/افتراضية)
ALTER TABLE giveaways ADD COLUMN min_level INTEGER;
ALTER TABLE giveaways ADD COLUMN min_messages INTEGER;
ALTER TABLE giveaways ADD COLUMN activity_days INTEGER;
ALTER TABLE giveaways ADD COLUMN min_invites INTEGER;
ALTER TABLE giveaways ADD COLUMN bonus_roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE giveaways ADD COLUMN starts_at INTEGER;
ALTER TABLE giveaways ADD COLUMN duration_ms INTEGER;
ALTER TABLE giveaways ADD COLUMN description TEXT;
ALTER TABLE giveaways ADD COLUMN ended_at INTEGER;
ALTER TABLE giveaways ADD COLUMN dm_winners INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_giveaways_guild_status ON giveaways (guild_id, status, id);
CREATE INDEX IF NOT EXISTS idx_giveaway_winners_user ON giveaway_winners (user_id, giveaway_id);

-- قوالب السحوبات: إعدادات جاهزة تُعاد بأمر واحد
CREATE TABLE IF NOT EXISTS giveaway_templates (
  guild_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  data        TEXT NOT NULL,
  created_by  TEXT,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

-- @down
DROP TABLE IF EXISTS giveaway_templates;
DROP INDEX IF EXISTS idx_giveaway_winners_user;
DROP INDEX IF EXISTS idx_giveaways_guild_status;
ALTER TABLE giveaways DROP COLUMN dm_winners;
ALTER TABLE giveaways DROP COLUMN ended_at;
ALTER TABLE giveaways DROP COLUMN description;
ALTER TABLE giveaways DROP COLUMN duration_ms;
ALTER TABLE giveaways DROP COLUMN starts_at;
ALTER TABLE giveaways DROP COLUMN bonus_roles;
ALTER TABLE giveaways DROP COLUMN min_invites;
ALTER TABLE giveaways DROP COLUMN activity_days;
ALTER TABLE giveaways DROP COLUMN min_messages;
ALTER TABLE giveaways DROP COLUMN min_level;
