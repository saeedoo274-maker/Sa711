# قاعدة البيانات والهجرات

SQLite (better-sqlite3، أو `node:sqlite` كبديل تلقائي) في `DATABASE_PATH` (افتراضي `./data/bot.db`) بوضع WAL.

## أداة سطر الأوامر

```bash
npm run migrate                 # تطبيق الهجرات المعلّقة (الأساسية + الإضافات)
npm run migrate -- status       # حالة كل هجرة (✓ مطبّقة، … معلّقة، ↺ قابلة للتراجع) — رمز خروج 2 إن وُجد معلّق
npm run migrate -- down [name]  # تراجع عن آخر هجرة أو هجرة محددة (فقط إن كان لها قسم @down)
npm run migrate -- integrity    # PRAGMA integrity_check + فحص المفاتيح الأجنبية
npm run migrate -- stats        # عدد الصفوف لكل جدول وحجم الملف
npm run migrate -- backup [dir] # نسخة متسقة (backup API أو VACUUM INTO)
```

البوت يطبّق الهجرات تلقائيًا عند التشغيل؛ الأداة للفحص والتشغيل اليدوي والتراجع.
من داخل ديسكورد: `/مطور migrations` (الحالة، السلامة، التراجع بتأكيد) و`/مطور backup`.

## الهجرات الجديدة في الإصدار 37

| الهجرة | المحتوى |
|---|---|
| `027_platform.sql` | `system_state` `maintenance_log` `scheduled_jobs` `queue_jobs` `notification_prefs` `user_settings` |
| `028_custom_commands_plus.sql` | أعمدة الأوامر المخصصة: ردود متعددة، شروط، مكونات، مرفقات، Webhook، API |
| `029_reaction_automation.sql` | أعمدة أتمتة التفاعلات |
| `030_application_forms.sql` | نافذة الفتح/الإغلاق وحدود النماذج |
| `031_web.sql` | `web_sessions` `api_keys` |
| `plugin/*/…` | 24 هجرة للإضافات (انظر `src/plugins/*/migrations`) |

كلها **متوافقة للخلف**: جداول جديدة أو أعمدة بقيم افتراضية تحافظ على سلوك البيانات القديمة، ولكل منها قسم `-- @down` مختبر ذهابًا وإيابًا في `tests/core/migrations.test.js`. الهجرات الأقدم (001–026) بلا قسم تراجع وترفض التراجع بوضوح بدل حذف بيانات بشكل غير مضمون.

## جداول الإضافات

`achievements` `achievement_unlocks` `member_metrics` `afk_status` `afk_mentions` `announcements` `appeals` `automations` `casework_notes` `case_links` `econ_*` `shop_items` `shop_purchases` `member_cosmetics` `game_sessions` `game_stats` `giveaway_templates` `guild_backups` `member_name_history` `member_role_history` `member_presence_log` `member_activity_daily` `member_last_seen` `integration_subs` `invite_joins` `level_members` `level_rewards` `level_multipliers` `level_blacklist` `level_xp_log` `permission_rules` `reminders` `reward_log` `reward_claims` `badges` `member_badges` `social_reputation` `social_follows` `social_friends` `social_blocks` `social_comments` `social_privacy` `staff_departments` `staff_department_members` `staff_shifts` `staff_rank_history` `staff_evaluations` `starboard_boards` `starboard_board_entries` `starboard_votes` `suggestions` `suggestion_votes` `suggestion_counters` `suggestion_history` `ticket_assignees` `ticket_events` `verification_log`.

أعمدة أُضيفت لجداول قديمة: `tickets` (priority، tags، locked، SLA، التصعيد، أول رد، الإغلاق المؤجل)، `giveaways` (الشروط، الجدولة، الوصف، رتب الفرص)، `admin_reports` (الأولوية، المكلَّف، SLA، التصعيد)، `custom_commands`، `reaction_replies`، `application_types`.

## المراقبة

- كل المعاملات تُقاس (العدد، الفشل، الأبطأ) وتظهر في `/مطور test` (Test Center).
- المجدول والطابور محفوظان في القاعدة: يستأنفان بعد إعادة التشغيل، والمهام العالقة تعود للانتظار.

## مدير التنظيف (سياسات الاحتفاظ)

يعمل يوميًا 03:30 UTC ويحذف على دفعات صغيرة. `/مطور cleanup` للمعاينة والتنفيذ وتعديل المدد (0 = تعطيل).

| المهمة | الافتراضي |
|---|---|
| سجل الأخطاء | 90 يومًا |
| مهام المجدول/الطابور المنتهية | 30 يومًا |
| سجل الصيانة | 180 يومًا |
| أحداث حارس الإغراق | 90 يومًا |
| جلسات الألعاب المنتهية | 60 يومًا |
| سجل الدخول/الخروج | 365 يومًا |
| مسودات الإعلانات الملغاة | 30 يومًا |
| دعوات من غادروا | 365 يومًا |
| جلسات اللوحة المنتهية | يوم |
| الخط الزمني للتذاكر المغلقة، المعاملات المالية | معطّل |
| بيانات سيرفرات غادرها البوت | معطّل (اختياري) |

## النسخ الاحتياطي

- **ملف القاعدة**: كل `BACKUP_INTERVAL_HOURS` (افتراضي 6) مع الاحتفاظ بآخر `BACKUP_KEEP` (10)؛ `BACKUP_ENABLED=false` للتعطيل.
- **نسخ السيرفر** (`/اعداد backup`): الرتب والقنوات وصلاحياتها وإعدادات البوت، مع مقارنة وتصدير/استيراد وجدولة يومية/أسبوعية، واستعادة **غير هدّامة** عبر الطابور تُنشئ الناقص فقط ولا تمنح صلاحيات لا يملكها البوت، وتعيد ربط المعرّفات داخل الإعدادات.
