-- ============================================================
--  زخرفة التقديمات والمنشن
-- ============================================================

-- من يُمنشن عند وصول طلب جديد (رتب أو أعضاء أو everyone/here)
ALTER TABLE application_types ADD COLUMN mention_ids TEXT NOT NULL DEFAULT '[]';

-- مظهر إمبيد الطلب: لون، صور، فوتر، قالب العنوان، إيموجي الحقول
ALTER TABLE application_types ADD COLUMN style TEXT NOT NULL DEFAULT '{}';
