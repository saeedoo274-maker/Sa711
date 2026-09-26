# بنية الإضافات (Plugins)

كل نظام جديد في الإصدار 37 إضافة مستقلة داخل `src/plugins/<name>/`. الأنظمة القديمة في `src/modules/` بقيت كما هي، والإضافات **توسّعها** عبر خطافات صغيرة بدل استبدالها.

## هيكل الإضافة

```
src/plugins/<name>/
├── plugin.json          البيان (إلزامي)
├── index.js             register / start / stop / events / health
├── commands/*.js        أوامر (نفس صيغة أوامر الوحدات)
├── interactions.js      معالج أزرار/قوائم/نوافذ ببادئة customId واحدة
├── interactions/*.js    معالجات إضافية (بادئة مستقلة لكل ملف)
├── migrations/*.sql     هجرات (تُسجَّل باسم plugin/<name>/<file>)
└── locales/{ar,en,fr,tr,es}.json
```

### plugin.json

| الحقل | الوصف |
|---|---|
| `name` | اسم فريد `[a-z][a-z0-9-]` ويطابق اسم المجلد |
| `version` | يُحفظ في `system_state`؛ تغيّره يستدعي `upgrade(app, from, to)` إن وُجد |
| `label` / `description` | للعرض في `/مطور plugins` و`/اعداد features` |
| `feature` | اسم علم الميزة (يمكن أن تتشاركه إضافة ووحدة قديمة) |
| `defaultEnabled` | الحالة الافتراضية لكل سيرفر |
| `dependencies` | إضافات يجب تحميلها قبلها |
| `configKey` + `config` | افتراضيات تُدمج في إعدادات السيرفر (تُقرأ عبر `guildConfig.value`) |
| `permissions.manage` | المستوى المقترح للإدارة (للتوثيق واللوحة) |

### دورة الحياة

1. **discover** (قبل قاعدة البيانات): قراءة البيانات فقط — الهجرات، الترجمات، الافتراضيات.
2. **migrate**: تطبيق `migrations/*.sql` مرة واحدة لكل ملف داخل معاملة.
3. **register(app)**: إنشاء المستودعات والخدمات وتعريف مهام المجدول/الطابور والاشتراك في الناقل.
4. **start(app)** عند `ready`: أعمال تحتاج اتصالًا (تحميل كاش، جدولة متكررة).
5. **events**: `{ discordEvent: (app, ...args) => … }` — تُمرَّر بعد المعالج الأساسي، وفقط إن كانت الميزة مفعّلة في ذلك السيرفر، وفشلها معزول.
6. **health(app)** → `{ ok, details }` يظهر في مركز الاختبار.
7. **stop(app)** عند الإيقاف.

فشل إضافة واحدة لا يوقف البوت: أوامرها تبقى مسجّلة لكنها ترد "النظام غير متاح".

## الهجرات

- كل ملف SQL يُطبَّق مرة واحدة ويُسجَّل في `_migrations`.
- قسم `-- @down` يجعل الهجرة قابلة للتراجع (`npm run migrate -- down <name>` أو `/مطور migrations`).
- كل هجرة جديدة في هذا الإصدار لها قسم تراجع، ومختبرة ذهابًا وإيابًا (`tests/core/migrations.test.js`).
- الأعمدة الجديدة على جداول قديمة تُضاف بقيم افتراضية تحافظ على السلوك القديم.

## الترجمة

`ctx.t(key)` و`app.i18n.forGuild(guildId)(key)` يستخدمان لغة السيرفر (`/اعداد language`). أي مفتاح ناقص في لغة يعود للعربية. `npm run check` يرفض أي مفتاح مستخدم في الكود وغير موجود.

## أعلام الميزات

- لكل سيرفر: `/اعداد features` أو اللوحة أو `PUT /api/v1/guilds/:id/features/:name`.
- عامة (المطور): `/مطور flags` — إيقاف عام يعطّل الميزة في كل السيرفرات.

## الإضافات الحالية

| الإضافة | الميزة | الوصف |
|---|---|---|
| achievements | achievements | إنجازات مدمجة ومخصصة وشارات |
| admin | admin | `/ادارة`: التحليلات، المكافآت، الإنجازات، الإعلانات، التكاملات |
| afk | afk | حالة الغياب |
| analytics | analytics | تحليلات السيرفر والطاقم مع رسوم |
| announcements | announcements | إعلانات بمعاينة وجدولة وتكرار وخاص عبر الطابور |
| appeals | appeals | استئناف الحظر/الإسكات/التحذير |
| automation | automation | منشئ الأتمتة |
| cases-plus | moderation | ملاحظات القضايا وأدلتها وخطها الزمني + دورة حياة البلاغات |
| economy-plus | economy | المتجر، المخزون، الوظائف، الاستثمار، السوق، المزادات، التداول |
| games | games | إطار الألعاب المصغرة (10 ألعاب) |
| giveaways-plus | giveaways | شروط، فرص إضافية متعددة، جدولة، قوالب، سجل |
| guild-backup | backups | نسخ هيكل السيرفر والإعدادات واستعادة غير هدّامة |
| history | history | سجل الأعضاء والنشاط |
| integrations | integrations | RSS/YouTube/GitHub/Steam/Twitch/Minecraft/FiveM/Roblox/API/Webhook |
| invites | invites | تتبع الدعوات (معطّل افتراضيًا) |
| leaderboards | leaderboards | 14 نوع لوحة متصدرين |
| levels | levels | المستويات والخبرة (معطّل افتراضيًا) |
| member | member | `/عضو`: السجل، البحث، الإنجازات، الشارات، المتصدرون، الدعوات، الاستئناف |
| permissions | permissions | منشئ الصلاحيات |
| reminders | reminders | التذكيرات |
| rewards | rewards | محرك المكافآت المشترك |
| search | search | البحث الشامل `/بحث` |
| settings | settings | `/اعداد` + معالج الإعداد |
| social-plus | social | السمعة، المتابعة، الأصدقاء، الحظر/الكتم، التعليقات، الخصوصية |
| staff-plus | staff | الأقسام، المناوبات، التقييمات، KPI |
| starboard-plus | starboard | لوحات نجوم متعددة بأصوات فريدة |
| suggestions | suggestions | الاقتراحات |
| tickets-plus | tickets | نقل، أولوية، SLA، وسوم، تكليف، قفل، إغلاق مؤجل، تصعيد |
| verification | verification | تحقق وظيفي بزر (ليس نظام حماية) |
| welcome | welcome | الترحيب والوداع بالبطاقات |
