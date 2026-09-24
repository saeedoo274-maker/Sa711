-- ============================================================
--  أتمتة التفاعلات — توسعة جدول reaction_replies بأعمدة اختيارية.
--  القواعد الموجودة تبقى بسلوكها الحالي (تبديل الرتبة + رد).
-- ============================================================
ALTER TABLE reaction_replies ADD COLUMN message_id TEXT;
ALTER TABLE reaction_replies ADD COLUMN role_mode TEXT NOT NULL DEFAULT 'toggle';
ALTER TABLE reaction_replies ADD COLUMN remove_role_id TEXT;
ALTER TABLE reaction_replies ADD COLUMN required_roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE reaction_replies ADD COLUMN blocked_roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE reaction_replies ADD COLUMN min_account_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reaction_replies ADD COLUMN min_level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reaction_replies ADD COLUMN cooldown_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reaction_replies ADD COLUMN log_channel_id TEXT;
ALTER TABLE reaction_replies ADD COLUMN open_ticket INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reaction_replies ADD COLUMN target_channel_id TEXT;
ALTER TABLE reaction_replies ADD COLUMN channel_action TEXT;
ALTER TABLE reaction_replies ADD COLUMN button_label TEXT;
ALTER TABLE reaction_replies ADD COLUMN button_url TEXT;
ALTER TABLE reaction_replies ADD COLUMN remove_reaction INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_reactionreply_message ON reaction_replies (guild_id, message_id);

-- @down
DROP INDEX IF EXISTS idx_reactionreply_message;
ALTER TABLE reaction_replies DROP COLUMN remove_reaction;
ALTER TABLE reaction_replies DROP COLUMN button_url;
ALTER TABLE reaction_replies DROP COLUMN button_label;
ALTER TABLE reaction_replies DROP COLUMN channel_action;
ALTER TABLE reaction_replies DROP COLUMN target_channel_id;
ALTER TABLE reaction_replies DROP COLUMN open_ticket;
ALTER TABLE reaction_replies DROP COLUMN log_channel_id;
ALTER TABLE reaction_replies DROP COLUMN cooldown_ms;
ALTER TABLE reaction_replies DROP COLUMN min_level;
ALTER TABLE reaction_replies DROP COLUMN min_account_days;
ALTER TABLE reaction_replies DROP COLUMN blocked_roles;
ALTER TABLE reaction_replies DROP COLUMN required_roles;
ALTER TABLE reaction_replies DROP COLUMN remove_role_id;
ALTER TABLE reaction_replies DROP COLUMN role_mode;
ALTER TABLE reaction_replies DROP COLUMN message_id;
