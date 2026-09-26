# الإعداد ومتغيرات البيئة

## متغيرات البيئة

| المتغير | إلزامي | الوصف |
|---|---|---|
| `BOT_TOKEN` | ✅ | توكن البوت |
| `CLIENT_ID` | ✅ | معرّف التطبيق (نشر الأوامر + OAuth2) |
| `CLIENT_SECRET` | للوحة | سر OAuth2 |
| `DEVELOPER_IDS` | | معرّفات المطورين مفصولة بفاصلة |
| `DEV_GUILD_ID` | | نشر أوامر السلاش فورًا في سيرفر تطوير |
| `DATABASE_PATH` | | مسار SQLite (افتراضي `./data/bot.db`) |
| `PORT` / `DASHBOARD_PORT` | | منفذ خادم HTTP (الصحة، Webhooks، اللوحة، API) |
| `PUBLIC_URL` | | الرابط العام (روابط GitHub webhooks) |
| `DASHBOARD_URL` | للوحة | الرابط العام للوحة (redirect OAuth2) |
| `SESSION_SECRET` | للوحة | 32+ حرفًا عشوائيًا لتوقيع الجلسات |
| `TRUST_PROXY` | | `true` خلف وكيل عكسي |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | | لتفعيل مزوّد Twitch في التكاملات |
| `BACKUP_ENABLED` / `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | | النسخ الدوري لملف القاعدة |
| `ABUSE_USER_PER_MIN` / `ABUSE_GUILD_PER_MIN` / `ABUSE_COOLDOWN_MS` / `ABUSE_STRIKES` / `ABUSE_AUTO_LEAVE` | | حارس إغراق الأوامر (موجود مسبقًا) |
| `NODE_ENV` / `LOG_LEVEL` | | البيئة ومستوى السجل |

⚠️ لا توضع أي قيمة سرية داخل الكود أو المستودع. `npm run check` يفحص الكود بحثًا عن أسرار مسرّبة.

## إعدادات السيرفر

محفوظة لكل سيرفر في قاعدة البيانات، وتُدمج مع الافتراضيات (`config/guild-defaults.json` + افتراضيات الإضافات من `plugin.json`). طرق التعديل:

- **معالج الإعداد**: `/اعداد setup` — خطوات مع معاينة قبل الحفظ.
- **اللوحة**: `/لوحة ← الأنظمة والإعدادات` (اللغة، الأنظمة، الثيم، السجلات، الإشعارات، الترحيب، التحقق، الاستئنافات، وإعدادات كل نظام).
- **الأوامر**: `/اعداد setup|permissions|automation|backup|api`.
- **اللوحة** و**REST API**.

### مفاتيح الإضافات الرئيسية

| المفتاح | أمثلة |
|---|---|
| `tickets` | `cooldownMs`، `sla.{low,normal,high,urgent}` (دقائق)، `escalation.{channelId,roleId,autoOnBreach}`، `maxTags` |
| `giveaways` | `maxTemplates`، `maxBonusRoles`، `dmWinnersDefault` |
| `starboard` | `ignoredRoles`، `maxBoards` (+ الإعدادات الأصلية) |
| `announcements` | `maxScheduled`، `maxTemplates`، `dmDelayMs`، `draftTtlMs` |
| `casework` | `reportSlaHours`، `maxNotesPerCase` |
| `appeals` | `channelId`، `types`، `cooldownMs`، `maxPerCase`، `minReasonLength` |
| `staffPlus` | `maxShiftHours`، `maxDepartments` |
| `socialPlus` | `repDailyLimit`، `repCooldownMs`، `maxFriends`، `maxCommentsPerDay` |
| `automation` | `maxAutomations`، `maxSteps`، `runsPerMinute` |
| `integrations` | `maxSubscriptions`، `minIntervalMinutes` |
| `guildBackup` | `keep`، `schedule`، `maxBytes`، `restoreDelayMs` |
| `invites` | `fakeAccountAgeDays` |
| `features.<name>` | تشغيل/إيقاف نظام لهذا السيرفر |

## المتغيرات في النصوص

69 متغيرًا غير حساس لحالة الأحرف في كل النصوص (الترحيب، الأوامر المخصصة، الإعلانات، الأتمتة، الإمبيدات…). متغيرات الإحصاءات (`{XP}` `{LEVEL}` `{RANK}` `{BALANCE}` `{BANK}` `{REPUTATION}` `{MESSAGES}` `{INVITES}` `{WARNINGS}` `{ACHIEVEMENTS}`) تُحسب فقط إن استُخدمت. القائمة الكاملة مع معاينة حية: `/امر_مخصص variables`.
