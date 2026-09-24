-- ============================================================
--  توسعة الأوامر المخصصة — أعمدة اختيارية بقيم افتراضية
--  تحافظ على سلوك الأوامر الموجودة كما هو تمامًا.
-- ============================================================
ALTER TABLE custom_commands ADD COLUMN responses TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_commands ADD COLUMN response_mode TEXT NOT NULL DEFAULT 'single';
ALTER TABLE custom_commands ADD COLUMN required_roles TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_commands ADD COLUMN allowed_channels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_commands ADD COLUMN dm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_commands ADD COLUMN reply INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_commands ADD COLUMN min_args INTEGER NOT NULL DEFAULT 0;
ALTER TABLE custom_commands ADD COLUMN usage TEXT;
ALTER TABLE custom_commands ADD COLUMN components TEXT NOT NULL DEFAULT '{}';
ALTER TABLE custom_commands ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE custom_commands ADD COLUMN webhook_name TEXT;
ALTER TABLE custom_commands ADD COLUMN webhook_avatar TEXT;
ALTER TABLE custom_commands ADD COLUMN api_url TEXT;
ALTER TABLE custom_commands ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE custom_commands ADD COLUMN updated_at INTEGER;

-- @down
ALTER TABLE custom_commands DROP COLUMN updated_at;
ALTER TABLE custom_commands DROP COLUMN enabled;
ALTER TABLE custom_commands DROP COLUMN api_url;
ALTER TABLE custom_commands DROP COLUMN webhook_avatar;
ALTER TABLE custom_commands DROP COLUMN webhook_name;
ALTER TABLE custom_commands DROP COLUMN attachments;
ALTER TABLE custom_commands DROP COLUMN components;
ALTER TABLE custom_commands DROP COLUMN usage;
ALTER TABLE custom_commands DROP COLUMN min_args;
ALTER TABLE custom_commands DROP COLUMN reply;
ALTER TABLE custom_commands DROP COLUMN dm;
ALTER TABLE custom_commands DROP COLUMN allowed_channels;
ALTER TABLE custom_commands DROP COLUMN required_roles;
ALTER TABLE custom_commands DROP COLUMN response_mode;
ALTER TABLE custom_commands DROP COLUMN responses;
