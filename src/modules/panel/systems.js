/**
 * قسم «الأنظمة» داخل لوحة التحكم المركزية (/لوحة).
 *
 * ليس نظام لوحات جديدًا: كل شاشة هنا تُعرض عبر `panelView` نفسه (Components v2)
 * وبأزرار `btn` نفسها وبنفس بادئة `panel:` — ويستدعيها `handle()` في interactions.js.
 * الهدف: كل نظام أُضيف كإضافة (src/plugins) صار له مكان تحكم كامل داخل اللوحة،
 * بدل أن يبقى إعداده موزّعًا على أوامر فرعية طويلة.
 *
 * التصميم مبني على وصف بيانات (SYSTEMS) لا على شاشة مكتوبة يدويًا لكل نظام:
 * - القنوات والرتب والمفاتيح والأرقام مسارات إعداد **ثابتة** في الوصف (قائمة بيضاء)،
 *   فلا يمكن لأي ضغطة كتابة مسار غير معرّف هنا.
 * - الأوامر القديمة تبقى كما هي (توافق)، واللوحة تكتب في نفس مفاتيح الإعداد التي تكتبها.
 * - المنطق الفعلي (نشر لوحة التحقق، النسخ الاحتياطي، الثيم...) يُستدعى من الخدمات الموجودة.
 */
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal } = require("../../core/interactions/interactionSafe");

const on = (v) => (v ? "🟢" : "⚪");
const MIN = 60_000;
const DAY = 86_400_000;

/** إضافات لا تُطفأ من اللوحة حتى لا يُقفل المسؤول على نفسه. */
const LOCKED_FEATURES = new Set(["panel", "settings"]);

// ============================================================
//  وصف الأنظمة
// ============================================================
// key: قصير لأنه جزء من customId (حد 100 حرف)
// group: "cfg" الإعدادات العامة | "sys" الأنظمة
// plugin: الإضافة المالكة — النظام يختفي من اللوحة إذا لم تُحمَّل
// feature: علم التشغيل (يظهر زر تشغيل/إيقاف)
// level: أقل مستوى للعرض والتعديل (يُعاد فحصه عند كل ضغطة)
const SYSTEMS = [
  // ---------------- الإعدادات العامة ----------------
  {
    key: "pub", group: "cfg", plugin: null, label: "نشر اللوحات", emoji: "📤", level: Level.ADMIN,
    note: "اختر اللوحة ثم القناة — تُنشر نفس اللوحات التي كانت تُرسل بالأوامر.",
    summary: (app, guild) => publishersFor(app, guild).map((p) => `${p.emoji} ${p.label}`),
    actions: [
      { id: "pick", select: true },
      { id: "ch", hidden: true }, { id: "key", hidden: true }, { id: "mod", hidden: true },
      { id: "srroles", hidden: true }, { id: "srstyle", hidden: true }
    ]
  },
  {
    key: "lang", group: "cfg", plugin: "settings", label: "لغة البوت", emoji: "🌐", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").languagePayload(app, guild).embeds,
    actions: [{ id: "set", select: true }]
  },
  {
    key: "feat", group: "cfg", plugin: "settings", label: "تشغيل الأنظمة (الإضافات)", emoji: "🧩", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").featuresPayload(app, guild).embeds,
    actions: [{ id: "flip", select: true }]
  },
  {
    key: "theme", group: "cfg", plugin: "settings", label: "الثيم والهوية", emoji: "🎨", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").themePayload(app, guild).embeds,
    actions: [
      { id: "edit", label: "تعديل الثيم", emoji: "✏️", modal: true },
      { id: "colors", label: "كل الألوان", emoji: "🌈", modal: true },
      { id: "reset", label: "إعادة الافتراضي", emoji: "♻️", confirm: "سيُعاد الثيم (الألوان والتذييل والشعار والبانر) للافتراضي." }
    ]
  },
  {
    key: "logs", group: "cfg", plugin: "settings", label: "السجلات (الموسّعة)", emoji: "📜", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").logsPayload(app, guild).embeds,
    actions: [
      { id: "cat", label: "قناة فئة", emoji: "📥" },
      { id: "ev", label: "أحداث السجل", emoji: "🧾" },
      { id: "allon", label: "تفعيل الكل", emoji: "🟢" },
      { id: "alloff", label: "إيقاف الكل", emoji: "⚪", confirm: "سيتوقف تسجيل كل الأحداث حتى تعيد تفعيلها." }
    ]
  },
  {
    key: "notif", group: "cfg", plugin: "settings", label: "قنوات الإشعارات", emoji: "🔔", level: Level.ADMIN,
    channels: [
      { path: "notifications.staffChannelId", label: "قناة الطاقم" },
      { path: "notifications.adminChannelId", label: "قناة الإدارة" }
    ]
  },
  {
    key: "wel", group: "cfg", plugin: "welcome", feature: "welcome", label: "الترحيب والوداع", emoji: "👋", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").welcomePayload(app, guild).embeds,
    channels: [
      { path: "welcome.channelId", label: "قناة الترحيب", types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
      { path: "welcome.rulesChannelId", label: "قناة القوانين", types: [ChannelType.GuildText, ChannelType.GuildAnnouncement] },
      { path: "welcome.goodbye.channelId", label: "قناة الوداع" }
    ],
    toggles: [
      { path: "welcome.embed.enabled", label: "إمبيد الترحيب" },
      { path: "welcome.image.enabled", label: "صورة الترحيب" },
      { path: "welcome.dm.enabled", label: "رسالة خاصة" },
      { path: "welcome.goodbye.embed.enabled", label: "إمبيد الوداع" },
      { path: "welcome.goodbye.image.enabled", label: "صورة الوداع" }
    ],
    actions: [
      { id: "welcome", label: "نص الترحيب", emoji: "✏️", modal: true },
      { id: "dm", label: "نص الخاص", emoji: "✉️", modal: true },
      { id: "image", label: "نص الصورة", emoji: "🖼️", modal: true },
      { id: "goodbye", label: "نص الوداع", emoji: "📝", modal: true },
      { id: "test", label: "معاينة الترحيب", emoji: "🧪" },
      { id: "gtest", label: "معاينة الوداع", emoji: "🧪" },
      { id: "btnadd", label: "زر رابط", emoji: "🔗", modal: true },
      { id: "btndel", label: "حذف زر", emoji: "🗑️" }
    ]
  },
  {
    key: "ver", group: "cfg", plugin: "verification", feature: "verification", label: "التحقق", emoji: "✅", level: Level.ADMIN,
    view: (app, guild) => require("../../plugins/settings/views").verifyPayload(app, guild).embeds,
    roles: [
      { path: "verification.roleId", label: "رتبة المتحقق", manageable: true },
      { path: "verification.unverifiedRoleId", label: "رتبة غير المتحقق", manageable: true }
    ],
    toggles: [{ path: "verification.dmOnVerify", label: "رسالة خاصة بعد التحقق" }],
    actions: [
      { id: "edit", label: "نص اللوحة", emoji: "✏️", modal: true },
      { id: "pub", label: "نشر اللوحة", emoji: "📤", channel: true }
    ]
  },
  {
    key: "apl", group: "cfg", plugin: "appeals", feature: "appeals", label: "الاستئنافات", emoji: "⚖️", level: Level.ADMIN,
    commands: ["/عضو appeal"],
    channels: [{ path: "appeals.channelId", label: "قناة المراجعة" }],
    choices: [{
      path: "appeals.types", label: "الأنواع المسموحة", multi: true,
      options: [{ value: "ban", label: "الحظر" }, { value: "timeout", label: "الإسكات" }, { value: "warn", label: "التحذير" }]
    }],
    numbers: [
      { path: "appeals.cooldownMs", label: "الانتظار بعد الرفض (أيام)", scale: DAY, min: 0, max: 365 },
      { path: "appeals.maxPerCase", label: "أقصى استئنافات لكل قضية", min: 1, max: 10 }
    ],
  },
  {
    key: "perm", group: "cfg", plugin: "permissions", feature: "permissions", label: "منشئ الصلاحيات", emoji: "🔑", level: Level.ADMIN,
    commands: ["/اعداد permissions"],
    summary: (app, guild) => {
      const rules = app.permissionRules?.list(guild.id) || [];
      const lines = rules.slice(0, 10).map((r) => `${r.effect === "deny" ? "⛔" : "✅"} \`${r.target}\` ← ${r.subject_type === "role" || r.subjectType === "role" ? `<@&${r.subject_id || r.subjectId}>` : `<#${r.subject_id || r.subjectId}>`}`);
      return [`**القواعد:** \`${rules.length}\``, ...lines];
    }
  },
  {
    key: "auto", group: "cfg", plugin: "automation", feature: "automation", label: "منشئ الأتمتة", emoji: "⚙️", level: Level.ADMIN,
    commands: ["/اعداد automation create", "/اعداد automation action", "/اعداد automation condition"],
    numbers: [{ path: "automation.runsPerMinute", label: "أقصى تشغيل في الدقيقة", min: 1, max: 600 }],
    summary: (app, guild) => {
      const list = app.automation?.list(guild.id) || [];
      return [`**سير العمل:** \`${list.length}\``, ...list.slice(0, 12).map((a) => `${on(a.enabled)} \`#${a.id}\` **${a.name}** — ${a.trigger?.type || "?"} • ${a.runs || 0} تشغيل`)];
    },
    actions: [{ id: "flip", select: true }]
  },
  {
    key: "intg", group: "cfg", plugin: "integrations", feature: "integrations", label: "التكاملات", emoji: "🔗", level: Level.ADMIN,
    commands: ["/ادارة integration add", "/ادارة integration test"],
    summary: (app, guild) => {
      const list = app.integrations?.list(guild.id) || [];
      return [`**الاشتراكات:** \`${list.length}\``, ...list.slice(0, 12).map((s) => `${on(s.enabled)} \`#${s.id}\` ${s.provider} — ${truncate(String(s.source), 60)}`)];
    },
    actions: [{ id: "flip", select: true }]
  },
  {
    key: "bak", group: "cfg", plugin: "guild-backup", feature: "backups", label: "النسخ الاحتياطي", emoji: "💾", level: Level.GUILD_OWNER,
    commands: ["/اعداد backup action:restore", "/اعداد backup action:compare", "/اعداد backup action:export"],
    numbers: [{ path: "guildBackup.keep", label: "عدد النسخ المحفوظة", min: 1, max: 25 }],
    summary: (app, guild) => {
      const list = app.guildBackups?.list(guild.id) || [];
      const schedule = app.guildConfig.value(guild.id, "guildBackup.schedule");
      return [
        `**الجدولة:** ${schedule === "daily" ? "يومي" : schedule === "weekly" ? "أسبوعي" : "متوقفة"}`,
        `**النسخ:** \`${list.length}\``,
        ...list.slice(0, 8).map((b) => `\`#${b.id}\` ${b.name || b.kind} — <t:${Math.floor(b.created_at / 1000)}:R>`)
      ];
    },
    actions: [
      { id: "now", label: "نسخة الآن", emoji: "📸" },
      { id: "sched", select: true }
    ]
  },
  {
    key: "ann", group: "cfg", plugin: "announcements", feature: "announcements", label: "الإعلانات", emoji: "📣", level: Level.ADMIN,
    commands: ["/ادارة announcement send", "/ادارة announcement schedule", "/ادارة announcement list"]
  },

  // ---------------- الأنظمة ----------------
  {
    key: "lvl", group: "sys", plugin: "levels", feature: "levels", label: "المستويات والخبرة", emoji: "📈", level: Level.ADMIN,
    commands: ["/مستوى admin reward-add", "/مستوى admin multiplier", "/مستوى rank"],
    channels: [{ path: "levels.levelUp.channelId", label: "قناة إعلان المستوى" }],
    choices: [{
      path: "levels.levelUp.mode", label: "إعلان المستوى الجديد",
      options: [{ value: "current", label: "في نفس القناة" }, { value: "channel", label: "في قناة محددة" }, { value: "dm", label: "في الخاص" }, { value: "off", label: "بلا إعلان" }],
      check: (app, guildId, value) => (value === "channel" && !app.guildConfig.value(guildId, "levels.levelUp.channelId") ? "حدّد «قناة إعلان المستوى» أولًا." : null)
    }],
    texts: [{ path: "levels.levelUp.message", label: "نص الإعلان ({USER} {LEVEL})", max: 500, paragraph: true }],
    lists: [
      { path: "levels.ignoredChannels", label: "قنوات بلا XP", kind: "channel", max: 25 },
      { path: "levels.ignoredRoles", label: "رتب بلا XP", kind: "role", max: 25 },
      { path: "levels.xpChannels", label: "حصر XP في قنوات", kind: "channel", max: 25 }
    ],
    toggles: [
      { path: "levels.voiceRequireOthers", label: "XP الصوت يتطلب آخرين" },
      { path: "levels.voiceIgnoreMuted", label: "تجاهل المكتومين" },
      { path: "levels.stackRewards", label: "تراكم رتب المكافآت" }
    ],
    numbers: [
      { path: "levels.messageXpMin", label: "أقل XP للرسالة", min: 0, max: 1000 },
      { path: "levels.messageXpMax", label: "أعلى XP للرسالة", min: 0, max: 1000 },
      { path: "levels.cooldownMs", label: "التبريد (ثواني)", scale: 1000, min: 0, max: 3600 },
      { path: "levels.voiceXpPerMinute", label: "XP لكل دقيقة صوت", min: 0, max: 500 },
      { path: "levels.dailyCap", label: "سقف يومي (0 = بلا)", min: 0, max: 10_000_000 }
    ],
    validate: (v) => (v["levels.messageXpMin"] > v["levels.messageXpMax"] ? "أقل XP يجب ألا يتجاوز أعلى XP." : null)
  },
  {
    key: "sug", group: "sys", plugin: "suggestions", feature: "suggestions", label: "الاقتراحات", emoji: "💡", level: Level.ADMIN,
    commands: ["/اقتراح decide", "/اقتراح stats"],
    lists: [
      { path: "suggestions.requiredRoleIds", label: "رتب مسموح لها الاقتراح", kind: "role", max: 25 },
      { path: "suggestions.voteRoleIds", label: "رتب مسموح لها التصويت", kind: "role", max: 25 },
      { path: "suggestions.allowedChannelIds", label: "قنوات الاقتراح", kind: "channel", max: 25 }
    ],
    channels: [
      { path: "suggestions.channelId", label: "قناة الاقتراحات" },
      { path: "suggestions.archiveChannelId", label: "قناة الأرشيف" }
    ],
    toggles: [
      { path: "suggestions.anonymousAllowed", label: "السماح بالمجهول" },
      { path: "suggestions.threads", label: "ثريد للنقاش" },
      { path: "suggestions.allowVoteChange", label: "تغيير التصويت" },
      { path: "suggestions.dmAuthor", label: "إشعار صاحب الاقتراح" }
    ],
    numbers: [
      { path: "suggestions.cooldownMs", label: "التبريد (دقائق)", scale: MIN, min: 0, max: 1440 },
      { path: "suggestions.minLength", label: "أقل طول للاقتراح", min: 1, max: 1000 }
    ]
  },
  {
    key: "tkt", group: "sys", plugin: "tickets-plus", feature: "tickets", label: "التذاكر المتقدمة", emoji: "🎫", level: Level.ADMIN,
    commands: ["/تذكرة stats", "/تذكرة escalate"],
    note: "إعدادات التذاكر الأساسية (القنوات والإغلاق التلقائي) في قسم **التذاكر** بالقائمة الرئيسية.",
    channels: [{ path: "tickets.escalation.channelId", label: "قناة التصعيد" }],
    roles: [{ path: "tickets.escalation.roleId", label: "رتبة التصعيد" }],
    toggles: [{ path: "tickets.escalation.autoOnBreach", label: "تصعيد تلقائي عند تجاوز SLA" }],
    numbers: [
      { path: "tickets.cooldownMs", label: "تبريد فتح التذاكر (دقائق)", scale: MIN, min: 0, max: 10080 },
      { path: "tickets.sla.low", label: "SLA منخفضة (دقائق)", min: 0, max: 100000 },
      { path: "tickets.sla.normal", label: "SLA عادية (دقائق)", min: 0, max: 100000 },
      { path: "tickets.sla.high", label: "SLA عالية (دقائق)", min: 0, max: 100000 },
      { path: "tickets.sla.urgent", label: "SLA عاجلة (دقائق)", min: 0, max: 100000 }
    ],
    actions: [
      { id: "settings", label: "الإعدادات الأساسية", emoji: "⚙️", goto: "panel:tickets" },
      { id: "publish", label: "إرسال لوحة تذاكر", emoji: "📤", goto: "panel:sysa:pub:ch:tkt" }
    ]
  },
  {
    key: "gw", group: "sys", plugin: "giveaways-plus", feature: "giveaways", label: "السحوبات", emoji: "🎁", level: Level.MODERATOR,
    commands: ["/سحب start", "/سحب list", "/سحب template", "/سحب bonus"],
    toggles: [{ path: "giveaways.dmWinnersDefault", label: "مراسلة الفائزين افتراضيًا" }],
    summary: (app, guild) => [`**السحوبات النشطة:** \`${app.giveaways?.listActive(guild.id).length ?? 0}\``]
  },
  {
    key: "star", group: "sys", plugin: "starboard-plus", feature: "starboard", label: "لوحات النجوم", emoji: "⭐", level: Level.ADMIN,
    commands: ["/لوحة_نجوم board", "/لوحة_نجوم ignore", "/لوحة_نجوم leaderboard"],
    channels: [{ path: "starboard.channelId", label: "قناة لوحة النجوم" }],
    toggles: [
      { path: "starboard.enabled", label: "لوحة النجوم الأساسية" },
      { path: "starboard.allowSelfStar", label: "السماح بتنجيم النفس" }
    ],
    numbers: [{ path: "starboard.threshold", label: "عدد النجوم المطلوب", min: 1, max: 50 }],
    texts: [{ path: "starboard.emoji", label: "الإيموجي", max: 32 }],
    summary: (app, guild) => {
      const boards = app.starboardPlus?.boards(guild.id) || [];
      return [`**اللوحات الإضافية:** \`${boards.length}\``, ...boards.slice(0, 8).map((b) => `${b.emoji || "⭐"} **${b.name}** → <#${b.channel_id || b.channelId}> • حد \`${b.threshold}\``)];
    }
  },
  {
    key: "ach", group: "sys", plugin: "achievements", feature: "achievements", label: "الإنجازات", emoji: "🏅", level: Level.ADMIN,
    commands: ["/ادارة achievement create", "/ادارة achievement toggle", "/عضو achievements"],
    channels: [{ path: "achievements.announceChannelId", label: "قناة الإعلان" }],
    toggles: [
      { path: "achievements.dm", label: "إشعار خاص" },
      { path: "achievements.builtins", label: "الإنجازات المدمجة" }
    ]
  },
  {
    key: "rwd", group: "sys", plugin: "rewards", feature: "rewards", label: "المكافآت", emoji: "🎖️", level: Level.ADMIN,
    commands: ["/ادارة reward", "/ادارة badge"],
    channels: [
      { path: "rewards.weeklyActivity.announceChannelId", label: "إعلان الأكثر نشاطًا" },
      { path: "rewards.staffWeekly.announceChannelId", label: "إعلان أفضل طاقم" }
    ],
    roles: [{ path: "rewards.weeklyActivity.roleId", label: "رتبة الأكثر نشاطًا" }],
    toggles: [
      { path: "rewards.dailyLogin.enabled", label: "مكافأة الدخول اليومي" },
      { path: "rewards.weeklyActivity.enabled", label: "مكافأة النشاط الأسبوعي" },
      { path: "rewards.staffWeekly.enabled", label: "مكافأة الطاقم الأسبوعية" }
    ],
    numbers: [
      { path: "rewards.dailyLogin.money", label: "مال الدخول اليومي", min: 0, max: 10_000_000 },
      { path: "rewards.dailyLogin.xp", label: "XP الدخول اليومي", min: 0, max: 100_000 },
      { path: "rewards.weeklyActivity.topN", label: "عدد الفائزين أسبوعيًا", min: 1, max: 10 },
      { path: "rewards.staffWeekly.topN", label: "عدد الطاقم الفائزين", min: 1, max: 10 }
    ]
  },
  {
    key: "eco", group: "sys", plugin: "economy-plus", feature: "economy", label: "الاقتصاد الموسّع", emoji: "💰", level: Level.ADMIN,
    commands: ["/اقتصاد", "/ادارة_بنك", "/اقتصاد admin item-add"],
    note: "الإعدادات الأساسية للبنك في قسم **الاقتصاد** بالقائمة الرئيسية.",
    toggles: [
      { path: "economy.work.enabled", label: "العمل" },
      { path: "economy.rob.enabled", label: "السرقة" },
      { path: "economy.investments.enabled", label: "الاستثمار" },
      { path: "economy.market.enabled", label: "السوق" },
      { path: "economy.auction.enabled", label: "المزادات" },
      { path: "economy.trade.enabled", label: "التداول" },
      { path: "economy.loans.enabled", label: "القروض" }
    ],
    numbers: [
      { path: "economy.daily.amount", label: "مكافأة اليومي", min: 0, max: 10_000_000 },
      { path: "economy.weekly.amount", label: "مكافأة الأسبوعي", min: 0, max: 10_000_000 },
      { path: "economy.monthly.amount", label: "مكافأة الشهري", min: 0, max: 100_000_000 },
      { path: "economy.work.min", label: "أقل أجر للعمل", min: 0, max: 10_000_000 },
      { path: "economy.work.max", label: "أعلى أجر للعمل", min: 0, max: 10_000_000 },
      { path: "economy.market.taxPercent", label: "ضريبة السوق %", min: 0, max: 50 },
      { path: "economy.loans.maxAmount", label: "أقصى قرض", min: 0, max: 100_000_000 },
      { path: "economy.loans.interestPercent", label: "فائدة القرض %", min: 0, max: 200 }
    ],
    validate: (v) => (v["economy.work.min"] > v["economy.work.max"] ? "أقل أجر يجب ألا يتجاوز أعلى أجر." : null)
  },
  {
    key: "game", group: "sys", plugin: "games", feature: "games", label: "الألعاب", emoji: "🎲", level: Level.ADMIN,
    commands: ["/لعبة"],
    numbers: [
      { path: "games.minBet", label: "أقل رهان", min: 1, max: 10_000_000 },
      { path: "games.maxBet", label: "أعلى رهان", min: 1, max: 100_000_000 }
    ],
    validate: (v) => (v["games.minBet"] > v["games.maxBet"] ? "أقل رهان يجب ألا يتجاوز أعلى رهان." : null)
  },
  {
    key: "afk", group: "sys", plugin: "afk", feature: "afk", label: "الغياب (AFK)", emoji: "💤", level: Level.MODERATOR,
    commands: ["/afk set", "/afk list"],
    toggles: [{ path: "afk.setNickname", label: "إضافة بادئة للاسم" }],
    texts: [{ path: "afk.nickPrefix", label: "البادئة", max: 12, transform: (v) => `${v.trim()} ` }],
    lists: [{ path: "afk.ignoredChannels", label: "قنوات متجاهلة", kind: "channel", max: 25 }],
    numbers: [
      { path: "afk.maxReasonLength", label: "أقصى طول للسبب", min: 10, max: 1000 },
      { path: "afk.mentionCooldownMs", label: "تبريد تنبيه المنشن (ثواني)", scale: 1000, min: 0, max: 3600 }
    ]
  },
  {
    key: "rem", group: "sys", plugin: "reminders", feature: "reminders", label: "التذكيرات", emoji: "⏰", level: Level.ADMIN,
    commands: ["/تذكير"],
    toggles: [{ path: "reminders.allowChannelTarget", label: "التذكير في قناة" }],
    numbers: [{ path: "reminders.maxPerUser", label: "أقصى تذكيرات للعضو", min: 1, max: 100 }]
  },
  {
    key: "hist", group: "sys", plugin: "history", feature: "history", label: "سجل الأعضاء", emoji: "🗂️", level: Level.ADMIN,
    commands: ["/عضو history", "/بحث"],
    toggles: [
      { path: "history.trackMessages", label: "تتبع الرسائل" },
      { path: "history.trackVoice", label: "تتبع الصوت" }
    ],
    numbers: [{ path: "history.retentionDays", label: "مدة الاحتفاظ (أيام)", min: 7, max: 3650 }]
  },
  {
    key: "inv", group: "sys", plugin: "invites", feature: "invites", label: "تتبع الدعوات", emoji: "📨", level: Level.ADMIN,
    commands: ["/عضو leaderboards"],
    numbers: [{ path: "invites.fakeAccountAgeDays", label: "عمر الحساب الوهمي (أيام)", min: 0, max: 365 }]
  },
  {
    key: "soc", group: "sys", plugin: "social-plus", feature: "social", label: "التواصل الاجتماعي", emoji: "🤝", level: Level.ADMIN,
    commands: ["/تغريدة"],
    numbers: [
      { path: "socialPlus.repDailyLimit", label: "حد السمعة اليومي", min: 0, max: 100 },
      { path: "socialPlus.maxFriends", label: "أقصى أصدقاء", min: 1, max: 5000 },
      { path: "socialPlus.maxCommentsPerDay", label: "أقصى تعليقات يوميًا", min: 0, max: 1000 }
    ]
  },
  {
    key: "stf", group: "sys", plugin: "staff-plus", feature: "staff", label: "إدارة الطاقم المتقدمة", emoji: "🧑‍💼", level: Level.ADMIN,
    commands: ["/سلم_اداري shift", "/سلم_اداري department"],
    note: "السلم الإداري والترقيات في قسم **السلم الإداري** بالقائمة الرئيسية.",
    numbers: [
      { path: "staffPlus.maxShiftHours", label: "أقصى مدة للمناوبة (ساعات)", min: 1, max: 48 },
      { path: "staffPlus.maxDepartments", label: "أقصى عدد للأقسام", min: 1, max: 50 }
    ]
  },
  {
    key: "ar", group: "sys", plugin: null, feature: "roles", label: "الرتب التلقائية", emoji: "🏷️", level: Level.ADMIN,
    lists: [
      { path: "autoRoles.memberRoleIds", label: "رتب الأعضاء الجدد", kind: "role", max: 10, grantable: true, enable: "autoRoles.enabled" },
      { path: "autoRoles.botRoleIds", label: "رتب البوتات", kind: "role", max: 10, grantable: true, enable: "autoRoles.enabled" }
    ],
    toggles: [{ path: "autoRoles.enabled", label: "إعطاء الرتب تلقائيًا" }],
    actions: [{ id: "selfroles", label: "لوحة رتب ذاتية", emoji: "🎭", goto: "panel:sysa:pub:ch:sr" }]
  },
  {
    key: "svc", group: "sys", plugin: null, feature: "services", label: "مركز الخدمات", emoji: "🛎️", level: Level.ADMIN,
    channels: [
      { path: "logs.ratings", label: "قناة التقييمات" },
      { path: "logs.suggestions", label: "قناة اقتراحات الخدمات" }
    ],
    actions: [{ id: "publish", label: "نشر لوحة الخدمات", emoji: "📤", goto: "panel:sysa:pub:ch:svc" }]
  },
  {
    key: "case", group: "sys", plugin: "cases-plus", feature: "moderation", label: "القضايا والبلاغات", emoji: "📂", level: Level.ADMIN,
    commands: ["/قضية", "/بحث"],
    numbers: [
      { path: "casework.reportSlaHours", label: "SLA البلاغات (ساعات)", min: 1, max: 720 },
      { path: "casework.maxNotesPerCase", label: "أقصى ملاحظات للقضية", min: 1, max: 500 }
    ]
  }
];


// ============================================================
//  نشر اللوحات — بديل أوامر النشر (/لوحة_تذاكر، /لوحة_الادارة، /خدمات، /رتب_ذاتية،
//  و«panel/لوحة» الفرعية في البنك والتقديمات والاختبار والهوية والعسكرية والمدينة)
// ============================================================
// feature: علم التشغيل • flag: مفتاح تشغيل النظام القديم (false = معطّل)
// payload: يبني الرسالة من الدالة الموجودة في النظام نفسه
const PUBLISHERS = [
  {
    id: "tkt", label: "لوحة فتح التذاكر", emoji: "🎫", feature: "tickets", modal: true,
    ready: (app, guild) => (app.guildConfig.value(guild.id, "tickets.enabled") ? null : "فعّل نظام التذاكر أولًا (الرئيسية ← تشغيل الأنظمة).")
  },
  { id: "sr", label: "لوحة رتب ذاتية", emoji: "🎭", feature: "roles", modal: true },
  {
    id: "ver", label: "لوحة التحقق", emoji: "✅", feature: "verification",
    publish: async (app, guild, channel) => {
      if (!app.verification.config(guild.id).roleId) return { ok: false, error: "حدّد رتبة المتحقق أولًا من شاشة التحقق." };
      await app.verification.publish(guild, channel);
      return { ok: true };
    }
  },
  {
    id: "adm", label: "لوحة الإدارة الدائمة (للطاقم)", emoji: "🛡️", feature: "staff",
    payload: (app, guild) => require("../staff/interactions").build(app, guild),
    // نحفظ موقعها لتُحدَّث تلقائيًا بعد أي ترقية أو تنزيل أو سحب
    after: (app, guild, channel, message) => app.guildConfig.setMany(guild.id, { "staff.panelChannelId": channel.id, "staff.panelMessageId": message.id })
  },
  {
    id: "svc", label: "مركز الخدمات", emoji: "🛎️", feature: "services",
    payload: (app) => ({
      embeds: [buildEmbed({ title: "🛎️ مركز الخدمات", description: "اختر خدمة من القائمة بالأسفل.", color: app.config.color("primary") })],
      components: [require("../services/interactions").servicesMenuRow()]
    })
  },
  {
    id: "bank", label: "اللوحة البنكية", emoji: "🏦", feature: "economy", flag: "economy.enabled",
    payload: (app) => require("../../core/utils/componentsV2").containerPayload({
      text:
        "## 🏦 النظام البنكي\n\n" +
        "مرحبًا بك في نظام البنك، يمكنك من خلاله إدارة حسابك البنكي والاستفادة من جميع الخدمات المتاحة.\n\n" +
        "👤 فتح حساب بنكي\n💵 معرفة الرصيد\n💲 تحويل المبالغ\n📋 متابعة العمليات البنكية\n📋 إدارة الحساب والخدمات",
      color: app.config.color("primary"),
      rows: require("../economy/interactions").bankPanelRows()
    })
  },
  {
    id: "apps", label: "لوحة التقديمات", emoji: "📝", feature: "applications",
    payload: (app, guild) => require("../applications/interactions").browsePanel(app, guild.id)
  },
  {
    id: "quiz", label: "لوحة اختبار التفعيل", emoji: "✍️", feature: "quiz",
    payload: (app) => ({
      embeds: [buildEmbed({ title: "اختبار التفعيل", description: "اضغط الزر في الأسفل للبدء باختبار التفعيل.", color: app.config.color("primary"), timestamp: false })],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("quiz:start").setLabel("بدء اختبار التفعيل").setEmoji("📝").setStyle(ButtonStyle.Primary)
      )]
    })
  },
  { id: "idn", label: "لوحة الهوية", emoji: "🪪", feature: "identity", flag: "identity.enabled", payload: (app, guild) => app.identityService.panelPayload(guild) },
  {
    id: "milops", label: "مركز العمليات العسكرية", emoji: "🎖️", feature: "military", flag: "military.enabled",
    payload: (app, guild) => app.militaryService.operationsPanelPayload(guild.id),
    // عدّاد المباشرين في اللوحة يُحدَّث تلقائيًا من موقعها المحفوظ
    after: (app, guild, channel, message) => app.guildConfig.setMany(guild.id, { "military.panelChannelId": channel.id, "military.panelMessageId": message.id })
  },
  { id: "milrep", label: "لوحة البلاغات العسكرية", emoji: "📢", feature: "military", flag: "military.enabled", payload: (app) => app.militaryService.reportsPanelPayload() },
  { id: "cityjobs", label: "اختيار الوظائف (المدينة)", emoji: "💼", feature: "rp", flag: "rp.enabled", payload: (app, guild) => app.rpService.jobsPanelPayload(guild) },
  { id: "citymkt", label: "السوق السوداء (المدينة)", emoji: "🕶️", feature: "rp", flag: "rp.enabled", payload: (app, guild) => app.rpService.blackMarketPayload(guild) },
  {
    id: "cityjob", label: "بدء عمل لوظيفة (المدينة)", emoji: "🧰", feature: "rp", flag: "rp.enabled",
    keys: (app, guild) => app.rp.listJobs(guild.id).map((j) => ({ value: j.key, label: j.label || j.key })),
    payloadFor: (app, guild, key) => {
      const job = app.rp.getJob(guild.id, key);
      return job ? app.rpService.jobStartPanelPayload(guild, job) : null;
    }
  },
  {
    id: "cityrob", label: "لوحة سرقة (المدينة)", emoji: "💰", feature: "rp", flag: "rp.enabled",
    keys: (app, guild) => app.rp.listRobberies(guild.id).map((r) => ({ value: r.key, label: r.label || r.key })),
    payloadFor: (app, guild, key) => {
      const rob = app.rp.getRobbery(guild.id, key);
      return rob ? app.rpService.robberyPanelPayload(guild, rob) : null;
    }
  }
];

function publishersFor(app, guild) {
  return PUBLISHERS.filter((p) =>
    (!p.feature || !app.features || app.features.isEnabled(guild.id, p.feature)) &&
    (!p.flag || app.guildConfig.value(guild.id, p.flag) !== false));
}

/** مسودات الرتب الذاتية بين خطوات الاختيار — محدودة الحجم والعمر. */
const SR_DRAFTS = new Map();
const SR_TTL = 15 * MIN;
function srDraft(guildId, userId, patch = null) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  if (SR_DRAFTS.size > 500) {
    for (const [k, v] of SR_DRAFTS) if (now - v.at > SR_TTL) SR_DRAFTS.delete(k);
    if (SR_DRAFTS.size > 500) SR_DRAFTS.delete(SR_DRAFTS.keys().next().value);
  }
  let draft = SR_DRAFTS.get(key);
  if (draft && now - draft.at > SR_TTL) draft = null;
  if (patch) {
    draft = { roles: [], style: "menu", ...(draft || {}), ...patch, at: now };
    SR_DRAFTS.set(key, draft);
  }
  return draft || null;
}

const BY_KEY = new Map(SYSTEMS.map((s) => [s.key, s]));

function available(app, sys) {
  const p = app.plugins?.get(sys.plugin);
  return !p || p.status === "loaded";
}

// ============================================================
//  أدوات العرض
// ============================================================
function navRow(ui, sys = null) {
  const row = new ActionRowBuilder();
  if (sys) row.addComponents(ui.btn("panel:sys", "رجوع", "⬅️"));
  row.addComponents(ui.btn("panel:home", "الرئيسية", "🏠"));
  if (sys) row.addComponents(ui.btn(`panel:sysv:${sys.key}`, "تحديث", "🔄"));
  else row.addComponents(ui.btn("panel:sys", "تحديث", "🔄"));
  row.addComponents(ui.btn("panel:close", "إغلاق", "✖️"));
  return row;
}

/** صف رجوع إلى شاشة النظام — لشاشات الاختيار الفرعية. */
function subNav(ui, sys) {
  return new ActionRowBuilder().addComponents(
    ui.btn(`panel:sysv:${sys.key}`, "رجوع", "⬅️"),
    ui.btn("panel:home", "الرئيسية", "🏠"),
    ui.btn("panel:close", "إغلاق", "✖️")
  );
}

function fmtNumber(app, guildId, n) {
  const raw = app.guildConfig.value(guildId, n.path);
  if (raw === undefined || raw === null) return "—";
  return String(n.scale ? Math.round(Number(raw) / n.scale) : raw);
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

const NUM_PAGE = 5;

function systemScreen(app, member, sys, ui, notice = null) {
  const guild = member.guild;
  const g = guild.id;
  const lines = [];
  if (notice) lines.push(notice);

  const feature = sys.feature ? app.features.forGuild(g).find((f) => f.name === sys.feature) : null;
  if (feature) {
    lines.push(`**الحالة:** ${feature.globallyEnabled ? (feature.enabled ? "🟢 مفعّل" : "⚪ متوقف") : "⛔ معطّل من المطور"}`);
  }
  const manifest = app.plugins?.get(sys.plugin)?.manifest;
  if (manifest?.description && !sys.view) lines.push(`-# ${manifest.description}`);
  if (sys.note) lines.push(`ℹ️ ${sys.note}`);

  if (!sys.view) {
    for (const c of sys.channels || []) {
      const id = app.guildConfig.value(g, c.path);
      lines.push(`📥 **${c.label}:** ${id ? `<#${id}>` : "—"}`);
    }
    for (const r of sys.roles || []) {
      const id = app.guildConfig.value(g, r.path);
      lines.push(`🎭 **${r.label}:** ${id ? `<@&${id}>` : "—"}`);
    }
    for (const t of sys.toggles || []) lines.push(`${on(app.guildConfig.value(g, t.path))} ${t.label}`);
    for (const n of sys.numbers || []) lines.push(`🔢 **${n.label}:** \`${fmtNumber(app, g, n)}\``);
  }
  for (const l of sys.lists || []) {
    const ids = app.guildConfig.value(g, l.path) || [];
    const mention = (id) => (l.kind === "role" ? `<@&${id}>` : `<#${id}>`);
    lines.push(`📋 **${l.label}:** ${ids.length ? ids.slice(0, 15).map(mention).join(" ") : "—"}`);
  }
  for (const c of sys.choices || []) {
    const current = [].concat(app.guildConfig.value(g, c.path) ?? []);
    lines.push(`🔘 **${c.label}:** ${c.options.filter((o) => current.includes(o.value)).map((o) => o.label).join("، ") || "—"}`);
  }
  for (const t of sys.texts || []) {
    lines.push(`✏️ **${t.label}:** ${truncate(String(app.guildConfig.value(g, t.path) ?? "—"), 200)}`);
  }
  if (sys.summary) lines.push(...sys.summary(app, guild));
  if (sys.commands?.length) lines.push(`-# أوامر سريعة: ${sys.commands.map((c) => `\`${c}\``).join(" • ")}`);

  const embeds = [];
  if (sys.view) embeds.push(...sys.view(app, guild));
  embeds.push(buildEmbed({
    title: sys.view ? undefined : `${sys.emoji} ${sys.label}`,
    description: truncate(lines.join("\n"), 3500) || "‎",
    color: app.config.color(feature && !feature.enabled ? "neutral" : "primary")
  }));

  // الأزرار
  const buttons = [];
  if (feature && feature.globallyEnabled && !LOCKED_FEATURES.has(sys.feature)) {
    buttons.push(ui.btn(`panel:syst:${sys.key}`, feature.enabled ? "إيقاف النظام" : "تشغيل النظام", feature.enabled ? "⏸️" : "▶️",
      feature.enabled ? ButtonStyle.Danger : ButtonStyle.Success));
  }
  (sys.channels || []).forEach((c, i) => buttons.push(ui.btn(`panel:sysc:${sys.key}:${i}`, c.label, "📥")));
  (sys.roles || []).forEach((r, i) => buttons.push(ui.btn(`panel:sysr:${sys.key}:${i}`, r.label, "🎭")));
  (sys.lists || []).forEach((l, i) => buttons.push(ui.btn(`panel:sysl:${sys.key}:${i}`, truncate(l.label, 80), "📋")));
  if (sys.texts?.length) buttons.push(ui.btn(`panel:sysx:${sys.key}`, "تعديل النصوص", "✏️"));
  const pages = Math.ceil((sys.numbers || []).length / NUM_PAGE);
  for (let p = 0; p < pages; p++) buttons.push(ui.btn(`panel:sysn:${sys.key}:${p}`, pages > 1 ? `الأرقام ${p + 1}` : "تعديل الأرقام", "🔢"));
  for (const a of sys.actions || []) {
    if (a.select || a.hidden) continue;
    // goto: زر ينقل لشاشة موجودة في اللوحة بدل تكرارها هنا
    buttons.push(ui.btn(a.goto || `panel:sysa:${sys.key}:${a.id}`, a.label, a.emoji, a.confirm ? ButtonStyle.Danger : ButtonStyle.Secondary));
  }

  const rows = [];
  const select = selectFor(app, member, sys);
  if (select) rows.push(new ActionRowBuilder().addComponents(select));
  if (sys.toggles?.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`panel:sysb:${sys.key}`)
        .setPlaceholder("اختر خيارًا لعكس حالته")
        .addOptions(sys.toggles.map((t, i) => ({
          label: t.label.slice(0, 100), value: String(i), emoji: app.guildConfig.value(g, t.path) ? "🟢" : "⚪"
        })))
    ));
  }
  (sys.choices || []).forEach((c, i) => {
    const current = [].concat(app.guildConfig.value(g, c.path) ?? []);
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`panel:sysch:${sys.key}:${i}`)
        .setPlaceholder(truncate(c.label, 100))
        .setMinValues(1)
        .setMaxValues(c.multi ? c.options.length : 1)
        .addOptions(c.options.map((o) => ({ label: o.label, value: o.value, default: current.includes(o.value) })))
    ));
  });
  for (const group of chunk(buttons, 5)) {
    if (rows.length >= 4) break;
    rows.push(new ActionRowBuilder().addComponents(...group));
  }
  rows.push(navRow(ui, sys));
  return ui.panelView({ embeds, components: rows });
}

/** القوائم الخاصة بأنظمة معينة (لغة، أعلام، أتمتة...). */
function selectFor(app, member, sys) {
  const g = member.guild.id;
  const act = (sys.actions || []).find((a) => a.select);
  if (!act) return null;
  const id = `panel:sysa:${sys.key}:${act.id}`;

  if (sys.key === "lang") {
    const I18n = require("../../core/i18n/I18n");
    const current = app.i18n.localeFor(g);
    return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder("اختر لغة البوت")
      .addOptions(Object.entries(I18n.SUPPORTED).map(([code, l]) => ({ label: `${l.native} (${code})`, value: code, default: code === current })));
  }
  if (sys.key === "feat") return null; // لها عدة قوائم — تُبنى في featureRows
  if (sys.key === "auto" || sys.key === "intg") {
    const list = sys.key === "auto" ? app.automation?.list(g) || [] : app.integrations?.list(g) || [];
    if (!list.length) return null;
    return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder("اختر عنصرًا لتشغيله/إيقافه")
      .addOptions(list.slice(0, 25).map((x) => ({
        label: truncate(`#${x.id} ${x.name || `${x.provider} — ${x.source}`}`, 100), value: String(x.id), emoji: x.enabled ? "🟢" : "⚪"
      })));
  }
  if (sys.key === "pub") {
    const list = publishersFor(app, member.guild);
    if (!list.length) return null;
    return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder("اختر اللوحة التي تريد نشرها")
      .addOptions(list.slice(0, 25).map((p) => ({ label: p.label, value: p.id, emoji: p.emoji })));
  }
  if (sys.key === "bak") {
    return new StringSelectMenuBuilder().setCustomId(id).setPlaceholder("جدولة النسخ التلقائي")
      .addOptions([
        { label: "إيقاف الجدولة", value: "off" },
        { label: "يومي", value: "daily" },
        { label: "أسبوعي", value: "weekly" }
      ]);
  }
  return null;
}

/** شاشة الأعلام: 58+ علمًا تحتاج أكثر من قائمة (25 خيارًا لكل قائمة). */
function featuresScreen(app, member, sys, ui, notice = null) {
  const g = member.guild.id;
  const flags = app.features.forGuild(g)
    .filter((f) => f.globallyEnabled && !LOCKED_FEATURES.has(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const embeds = [...sys.view(app, member.guild)];
  if (notice) embeds.push(buildEmbed({ description: notice, color: app.config.color("success") }));
  const rows = chunk(flags, 25).slice(0, 4).map((list, i) => new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`panel:sysa:feat:flip:${i}`)
      .setPlaceholder(`تشغيل/إيقاف (${i + 1})`)
      .addOptions(list.map((f) => ({ label: truncate(`${f.name} — ${f.label}`, 100), value: f.name, emoji: f.enabled ? "🟢" : "⚪" })))
  ));
  rows.push(navRow(ui, sys));
  return ui.panelView({ embeds, components: rows.slice(0, 5) });
}

function render(app, member, sys, ui, notice = null) {
  return sys.key === "feat" ? featuresScreen(app, member, sys, ui, notice) : systemScreen(app, member, sys, ui, notice);
}

// ============================================================
//  المركز
// ============================================================
function hub(app, member, ui) {
  const level = app.permissions.resolveLevel(member);
  const visible = SYSTEMS.filter((s) => available(app, s) && level >= s.level);
  const g = member.guild.id;
  const status = (s) => {
    if (!s.feature) return "⚙️";
    return app.features.isEnabled(g, s.feature) ? "🟢" : "⚪";
  };
  const section = (group) => visible.filter((s) => s.group === group);

  const embed = buildEmbed({
    title: "🧩 الأنظمة والإعدادات",
    description:
      "كل نظام له شاشة تحكم كاملة هنا: تشغيل/إيقاف، القنوات، الرتب، الخيارات، والأرقام.\n" +
      "الأوامر القديمة ما زالت تعمل، لكنك لا تحتاجها للإعداد.",
    color: app.config.color("primary"),
    fields: [
      { name: "⚙️ الإعدادات العامة", value: section("cfg").map((s) => `${status(s)} ${s.emoji} ${s.label}`).join("\n") || "—", inline: true },
      { name: "🧩 الأنظمة", value: section("sys").map((s) => `${status(s)} ${s.emoji} ${s.label}`).join("\n") || "—", inline: true }
    ]
  });

  const rows = [];
  for (const [group, placeholder] of [["cfg", "⚙️ الإعدادات العامة"], ["sys", "🧩 الأنظمة"]]) {
    const list = section(group);
    if (!list.length) continue;
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`panel:sysopen:${group}`)
        .setPlaceholder(placeholder)
        .addOptions(list.slice(0, 25).map((s) => ({ label: s.label.slice(0, 100), value: s.key, emoji: s.emoji })))
    ));
  }
  rows.push(navRow(ui));
  return ui.panelView({ embeds: [embed], components: rows });
}

// ============================================================
//  المعالجات
// ============================================================
function deny(interaction, app) {
  return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
}

function fail(interaction, app, text) {
  return safeReply(interaction, { content: `${app.config.emoji("error")} ${text}`, flags: 64 });
}

function pickScreen(app, sys, ui, title, component) {
  return ui.panelView({
    embeds: [buildEmbed({ title, color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(component), subNav(ui, sys)]
  });
}

function botCanSend(guild, channel) {
  const me = guild.members?.me;
  if (!me || !channel?.permissionsFor) return true;
  return channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages) !== false;
}

async function handle(interaction, app, ui) {
  const [, action, key, arg, extra] = interaction.customId.split(":");
  const member = interaction.member;
  const guild = interaction.guild;
  const level = app.permissions.resolveLevel(member);

  if (action === "close") {
    return safeUpdate(interaction, ui.panelView({
      embeds: [buildEmbed({ description: "✖️ أُغلقت اللوحة. افتحها من جديد بـ `/لوحة`.", color: app.config.color("neutral") })],
      components: []
    }));
  }
  if (action === "sys") return safeUpdate(interaction, hub(app, member, ui));

  const sysKey = action === "sysopen" ? interaction.values?.[0] : key;
  const sys = BY_KEY.get(sysKey);
  if (!sys || !available(app, sys)) {
    return fail(interaction, app, "هذا النظام غير متاح حاليًا.");
  }
  // الصلاحية تُفحص عند كل ضغطة — لا نعتمد على أن الزر ظهر للعضو
  if (level < sys.level) return deny(interaction, app);
  const g = guild.id;
  const show = (notice) => safeUpdate(interaction, render(app, member, sys, ui, notice));
  const ok = (text) => `${app.config.emoji("success")} ${text}`;

  switch (action) {
    case "sysopen":
    case "sysv":
      return show();

    case "syst": {
      if (!sys.feature || LOCKED_FEATURES.has(sys.feature)) return show();
      if (!app.features.globallyEnabled(sys.feature)) return fail(interaction, app, "هذا النظام معطّل من المطور.");
      const now = app.features.setForGuild(g, sys.feature, !app.features.isEnabled(g, sys.feature));
      return show(ok(now ? "تم تشغيل النظام." : "تم إيقاف النظام."));
    }

    case "sysb": {
      const t = sys.toggles?.[Number(interaction.values?.[0])];
      if (!t) return show();
      const next = !app.guildConfig.value(g, t.path);
      app.guildConfig.set(g, t.path, next);
      return show(ok(`${t.label}: ${next ? "مفعّل" : "متوقف"}`));
    }

    case "sysc": {
      const c = sys.channels?.[Number(arg)];
      if (!c) return show();
      const select = new ChannelSelectMenuBuilder().setCustomId(`panel:syscs:${sys.key}:${arg}`).setPlaceholder("اختر القناة")
        .setChannelTypes(...(c.types || [ChannelType.GuildText]));
      return safeUpdate(interaction, ui.panelView({
        embeds: [buildEmbed({ title: `📥 ${c.label}`, color: app.config.color("primary") })],
        components: [
          new ActionRowBuilder().addComponents(select),
          new ActionRowBuilder().addComponents(ui.btn(`panel:syscx:${sys.key}:${arg}`, "إزالة القناة", "🗑️", ButtonStyle.Danger)),
          subNav(ui, sys)
        ]
      }));
    }
    case "syscs": {
      const c = sys.channels?.[Number(arg)];
      const id = interaction.values?.[0];
      if (!c || !id) return show();
      const channel = guild.channels.cache.get(id);
      if (channel && !botCanSend(guild, channel)) return fail(interaction, app, `لا أملك صلاحية الإرسال في <#${id}>.`);
      app.guildConfig.set(g, c.path, id);
      return show(ok(`${c.label}: <#${id}>`));
    }
    case "syscx": {
      const c = sys.channels?.[Number(arg)];
      if (!c) return show();
      app.guildConfig.set(g, c.path, null);
      return show(ok(`أُزيلت ${c.label}.`));
    }

    case "sysr": {
      const r = sys.roles?.[Number(arg)];
      if (!r) return show();
      return safeUpdate(interaction, ui.panelView({
        embeds: [buildEmbed({ title: `🎭 ${r.label}`, color: app.config.color("primary") })],
        components: [
          new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`panel:sysrs:${sys.key}:${arg}`).setPlaceholder("اختر الرتبة")),
          new ActionRowBuilder().addComponents(ui.btn(`panel:sysrx:${sys.key}:${arg}`, "إزالة الرتبة", "🗑️", ButtonStyle.Danger)),
          subNav(ui, sys)
        ]
      }));
    }
    case "sysrs": {
      const r = sys.roles?.[Number(arg)];
      const id = interaction.values?.[0];
      if (!r || !id) return show();
      const role = guild.roles.cache.get(id);
      if (r.manageable && role) {
        const me = guild.members?.me;
        if (role.managed || (me && role.position >= me.roles.highest.position)) {
          return fail(interaction, app, "لا أستطيع إدارة هذه الرتبة (رتبة بوت أو أعلى من رتبتي).");
        }
      }
      app.guildConfig.set(g, r.path, id);
      return show(ok(`${r.label}: <@&${id}>`));
    }
    case "sysrx": {
      const r = sys.roles?.[Number(arg)];
      if (!r) return show();
      app.guildConfig.set(g, r.path, null);
      return show(ok(`أُزيلت ${r.label}.`));
    }

    case "sysl": {
      const l = sys.lists?.[Number(arg)];
      if (!l) return show();
      const current = (app.guildConfig.value(g, l.path) || []).slice(0, l.max);
      const select = l.kind === "role"
        ? new RoleSelectMenuBuilder().setDefaultRoles(...current)
        : new ChannelSelectMenuBuilder().setChannelTypes(...(l.types || [ChannelType.GuildText])).setDefaultChannels(...current);
      select.setCustomId(`panel:sysls:${sys.key}:${arg}`).setPlaceholder(truncate(l.label, 100)).setMinValues(0).setMaxValues(l.max);
      return safeUpdate(interaction, ui.panelView({
        embeds: [buildEmbed({
          title: `📋 ${l.label}`,
          description: "المحدد حاليًا يظهر مختارًا — عدّل الاختيار ثم أغلق القائمة ليُحفظ.",
          color: app.config.color("primary")
        })],
        components: [
          new ActionRowBuilder().addComponents(select),
          new ActionRowBuilder().addComponents(ui.btn(`panel:syslx:${sys.key}:${arg}`, "تفريغ القائمة", "🗑️", ButtonStyle.Danger)),
          subNav(ui, sys)
        ]
      }));
    }
    case "sysls": {
      const l = sys.lists?.[Number(arg)];
      if (!l) return show();
      const ids = [...new Set(interaction.values || [])].slice(0, l.max);
      if (l.grantable) {
        const { validateGrantableRole } = require("../roles/selfRoles");
        for (const id of ids) {
          const problem = validateGrantableRole(app, guild, member, guild.roles.cache.get(id));
          if (problem) return fail(interaction, app, problem);
        }
      }
      const updates = { [l.path]: ids };
      if (l.enable && ids.length) updates[l.enable] = true;
      app.guildConfig.setMany(g, updates);
      return show(ok(`${l.label}: \`${ids.length}\``));
    }
    case "syslx": {
      const l = sys.lists?.[Number(arg)];
      if (!l) return show();
      app.guildConfig.set(g, l.path, []);
      return show(ok(`فُرّغت: ${l.label}`));
    }

    case "sysch": {
      const c = sys.choices?.[Number(arg)];
      const values = (interaction.values || []).filter((v) => c?.options.some((o) => o.value === v));
      if (!c || !values.length) return show();
      const problem = c.check?.(app, g, c.multi ? values : values[0]);
      if (problem) return fail(interaction, app, problem);
      app.guildConfig.set(g, c.path, c.multi ? values : values[0]);
      return show(ok(`${c.label}: ${c.options.filter((o) => values.includes(o.value)).map((o) => o.label).join("، ")}`));
    }

    case "sysx": {
      const list = (sys.texts || []).slice(0, 5);
      if (!list.length) return show();
      const modal = new ModalBuilder().setCustomId(`panel:sysxs:${sys.key}`).setTitle(truncate(sys.label, 45));
      list.forEach((t, i) => {
        const input = new TextInputBuilder().setCustomId(`t${i}`).setLabel(truncate(t.label, 45))
          .setStyle(t.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(false).setMaxLength(t.max);
        const current = app.guildConfig.value(g, t.path);
        if (current) input.setValue(String(current).slice(0, t.max));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      });
      return safeModal(interaction, modal);
    }
    case "sysxs": {
      const updates = {};
      (sys.texts || []).slice(0, 5).forEach((t, i) => {
        const raw = String(interaction.fields.getTextInputValue(`t${i}`) || "").trim();
        // الحقل الفارغ يعني «بلا تغيير» حتى لا تُمسح القيم الافتراضية بالخطأ
        if (!raw) return;
        updates[t.path] = t.transform ? t.transform(raw) : raw.slice(0, t.max);
      });
      if (Object.keys(updates).length) app.guildConfig.setMany(g, updates);
      return show(ok(Object.keys(updates).length ? "حُفظت النصوص." : "لا تغييرات."));
    }

    case "sysn": {
      const page = Number(arg) || 0;
      const list = (sys.numbers || []).slice(page * NUM_PAGE, page * NUM_PAGE + NUM_PAGE);
      if (!list.length) return show();
      const modal = new ModalBuilder().setCustomId(`panel:sysns:${sys.key}:${page}`).setTitle(truncate(sys.label, 45));
      list.forEach((n, i) => {
        const input = new TextInputBuilder().setCustomId(`n${i}`).setLabel(truncate(n.label, 45))
          .setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(12).setPlaceholder(`${n.min} – ${n.max}`);
        const current = fmtNumber(app, g, n);
        if (current !== "—") input.setValue(current);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
      });
      return safeModal(interaction, modal);
    }
    case "sysns": {
      const page = Number(arg) || 0;
      const list = (sys.numbers || []).slice(page * NUM_PAGE, page * NUM_PAGE + NUM_PAGE);
      const updates = {};
      const errors = [];
      list.forEach((n, i) => {
        const raw = String(interaction.fields.getTextInputValue(`n${i}`) || "").trim();
        if (!raw) return;
        const v = Number(raw.replace(/[,،\s]/g, ""));
        if (!Number.isInteger(v) || v < n.min || v > n.max) {
          errors.push(`**${n.label}**: رقم صحيح بين ${n.min} و ${n.max}`);
          return;
        }
        updates[n.path] = n.scale ? v * n.scale : v;
      });
      if (errors.length) return fail(interaction, app, `قيم غير صالحة — لم يُحفظ شيء:\n${errors.join("\n")}`);
      if (sys.validate) {
        const merged = {};
        for (const n of sys.numbers) merged[n.path] = n.path in updates ? updates[n.path] : Number(app.guildConfig.value(g, n.path));
        const problem = sys.validate(merged);
        if (problem) return fail(interaction, app, `${problem} لم يُحفظ شيء.`);
      }
      if (Object.keys(updates).length) app.guildConfig.setMany(g, updates);
      return show(ok(Object.keys(updates).length ? "حُفظت القيم." : "لا تغييرات."));
    }

    case "sysa":
      return runAction(interaction, app, ui, sys, arg, extra, { show, ok });

    default:
      return null;
  }
}

// ============================================================
//  الإجراءات الخاصة — كلها تستدعي الخدمات الموجودة
// ============================================================
async function runAction(interaction, app, ui, sys, actionId, step, { show, ok }) {
  const guild = interaction.guild;
  const member = interaction.member;
  const g = guild.id;
  const act = (sys.actions || []).find((a) => a.id === actionId);
  if (!act) return show();

  // تأكيد قبل الإجراءات المؤثرة
  if (act.confirm && step !== "yes") {
    return safeUpdate(interaction, ui.panelView({
      embeds: [buildEmbed({ title: `⚠️ ${act.label}`, description: `${act.confirm}\nهل أنت متأكد؟`, color: app.config.color("warning") })],
      components: [
        new ActionRowBuilder().addComponents(ui.btn(`panel:sysa:${sys.key}:${act.id}:yes`, "تأكيد", "✔️", ButtonStyle.Danger)),
        subNav(ui, sys)
      ]
    }));
  }

  const views = () => require("../../plugins/settings/views");
  const ctx = () => ({ app, guild, interaction, member, t: (k, v) => app.i18n.forGuild(g)(k, v) });

  switch (`${sys.key}:${act.id}`) {
    case "lang:set": {
      const lang = interaction.values?.[0];
      const I18n = require("../../core/i18n/I18n");
      if (lang && I18n.SUPPORTED[lang]) app.guildConfig.set(g, "language", lang);
      return show(ok(`اللغة: ${I18n.SUPPORTED[lang]?.native || "—"}`));
    }

    case "feat:flip": {
      const changed = [];
      for (const name of interaction.values || []) {
        if (LOCKED_FEATURES.has(name) || !app.features.isKnown(name) || !app.features.globallyEnabled(name)) continue;
        const now = app.features.setForGuild(g, name, !app.features.isEnabled(g, name));
        changed.push(`${on(now)} \`${name}\``);
      }
      return show(changed.length ? ok(changed.join(" • ")) : null);
    }

    case "theme:edit": {
      if (!interaction.isModalSubmit?.()) {
        const theme = app.theme.get(g);
        const field = (id, label, value, max) => {
          const i = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(max);
          if (value) i.setValue(String(value).slice(0, max));
          return new ActionRowBuilder().addComponents(i);
        };
        return safeModal(interaction, new ModalBuilder().setCustomId("panel:sysa:theme:edit").setTitle("تعديل الثيم").addComponents(
          field("primary", "اللون الأساسي #RRGGBB", theme.colors?.primary, 7),
          field("footer", "نص التذييل", theme.footer, 200),
          field("logo", "رابط الشعار https://", theme.logoUrl, 500),
          field("banner", "رابط البانر https://", theme.bannerUrl, 500)
        ));
      }
      const val = (id) => String(interaction.fields.getTextInputValue(id) || "").trim();
      const patch = { footer: val("footer") || null, logoUrl: val("logo") || null, bannerUrl: val("banner") || null };
      if (val("primary")) patch.colors = { primary: val("primary") };
      const res = app.theme.update(g, patch);
      if (!res.ok) return fail(interaction, app, res.errors.join("\n"));
      return show(ok("حُفظ الثيم."));
    }
    case "theme:reset":
      app.theme.reset(g);
      return show(ok("أُعيد الثيم للافتراضي."));

    case "logs:cat": {
      const LogService = require("../../core/logger/LogService");
      const categories = [...new Set(Object.values(LogService.EVENTS).map((e) => e.category))];
      if (!step) {
        return safeUpdate(interaction, pickScreen(app, sys, ui, "📥 اختر فئة السجل",
          new StringSelectMenuBuilder().setCustomId("panel:sysa:logs:cat:pick").setPlaceholder("الفئة")
            .addOptions(categories.slice(0, 25).map((c) => ({ label: c, value: c })))));
      }
      if (step === "pick") {
        const category = interaction.values?.[0];
        if (!categories.includes(category)) return show();
        return safeUpdate(interaction, pickScreen(app, sys, ui, `📥 قناة سجلات: ${category}`,
          new ChannelSelectMenuBuilder().setCustomId(`panel:sysa:logs:cat:${category}`).setPlaceholder("اختر القناة").setChannelTypes(ChannelType.GuildText)));
      }
      if (!categories.includes(step)) return show();
      const id = interaction.values?.[0];
      const channel = guild.channels.cache.get(id);
      if (channel && !botCanSend(guild, channel)) return fail(interaction, app, `لا أملك صلاحية الإرسال في <#${id}>.`);
      if (id) app.guildConfig.set(g, `logs.${step}`, id);
      return show(ok(`قناة ${step}: <#${id}>`));
    }
    case "logs:allon":
    case "logs:alloff": {
      const LogService = require("../../core/logger/LogService");
      const enabled = act.id === "allon";
      for (const key of Object.keys(LogService.EVENTS)) app.logs.setEnabled(g, key, enabled);
      return show(ok(enabled ? "فُعّلت كل السجلات." : "أُوقفت كل السجلات."));
    }

    case "wel:welcome":
    case "wel:dm":
    case "wel:image":
    case "wel:goodbye":
      // نفس نماذج الترحيب القديمة — والحفظ يتم في معالج cfg:wel الموجود
      return views().openWelcomeModal(ctx(), act.id);
    case "wel:test": {
      const payload = await app.welcome.buildPayload(member, "welcome");
      return safeReply(interaction, { ...payload, content: `🧪 معاينة\n${payload.content || ""}`.slice(0, 2000), allowedMentions: { parse: [] }, flags: 64 });
    }

    case "ver:edit":
      return views().openVerifyModal(ctx());
    case "ver:pub": {
      if (!step) {
        return safeUpdate(interaction, pickScreen(app, sys, ui, "📤 أين تُنشر لوحة التحقق؟",
          new ChannelSelectMenuBuilder().setCustomId("panel:sysa:ver:pub:go").setPlaceholder("اختر القناة").setChannelTypes(ChannelType.GuildText)));
      }
      if (!app.verification.config(g).roleId) return fail(interaction, app, "حدّد رتبة المتحقق أولًا.");
      const channel = guild.channels.cache.get(interaction.values?.[0]);
      if (!channel) return fail(interaction, app, "القناة غير موجودة.");
      if (!botCanSend(guild, channel)) return fail(interaction, app, `لا أملك صلاحية الإرسال في <#${channel.id}>.`);
      await app.verification.publish(guild, channel);
      return show(ok(`نُشرت لوحة التحقق في <#${channel.id}>.`));
    }


    case "theme:colors": {
      const ThemeService = require("../../core/theme/ThemeService");
      if (!interaction.isModalSubmit?.()) {
        const theme = app.theme.get(g);
        const value = ThemeService.COLOR_KEYS.map((k) => `${k} ${theme.colors?.[k] || "-"}`).join("\n");
        return safeModal(interaction, new ModalBuilder().setCustomId("panel:sysa:theme:colors").setTitle("ألوان الثيم").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("colors").setLabel("سطر لكل لون: الاسم #RRGGBB (أو - للافتراضي)")
            .setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(400).setValue(value.slice(0, 400)))
        ));
      }
      const colors = {};
      for (const line of String(interaction.fields.getTextInputValue("colors") || "").split("\n")) {
        const m = line.trim().match(/^(\w+)\s*[:=]?\s*(#?[0-9a-fA-F]{6}|-)$/);
        if (!line.trim()) continue;
        if (!m) return fail(interaction, app, `سطر غير مفهوم: \`${truncate(line, 50)}\``);
        colors[m[1]] = m[2] === "-" ? null : m[2];
      }
      const res = app.theme.update(g, { colors });
      if (!res.ok) return fail(interaction, app, res.errors.join("\n"));
      return show(ok("حُفظت الألوان."));
    }

    case "logs:ev": {
      const LogService = require("../../core/logger/LogService");
      let notice = null;
      if (interaction.values?.length) {
        const changed = [];
        for (const key of interaction.values) {
          if (!LogService.EVENTS[key]) continue;
          const next = !app.logs.isEnabled(g, key);
          app.logs.setEnabled(g, key, next);
          changed.push(`${on(next)} \`${key}\``);
        }
        notice = changed.length ? ok(changed.join(" • ")) : null;
      }
      const events = app.logs.overview(g);
      const rows = chunk(events, 25).slice(0, 3).map((list, i) => new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`panel:sysa:logs:ev:${i}`).setPlaceholder(`اختر أحداثًا لعكس حالتها (${i + 1})`)
          .setMinValues(1).setMaxValues(list.length)
          .addOptions(list.map((e) => ({ label: truncate(`${e.key} — ${e.category}`, 100), value: e.key, emoji: e.enabled ? "🟢" : "⚪" })))
      ));
      rows.push(subNav(ui, sys));
      return safeUpdate(interaction, ui.panelView({
        embeds: [buildEmbed({
          title: "🧾 أحداث السجل",
          description: [notice, `المفعّل: \`${events.filter((e) => e.enabled).length}/${events.length}\``, "-# كل حدث يُرسل إلى قناة فئته."].filter(Boolean).join("\n"),
          color: app.config.color("primary")
        })],
        components: rows
      }));
    }

    case "wel:gtest": {
      const payload = await app.welcome.buildPayload(member, "goodbye");
      return safeReply(interaction, { ...payload, content: `🧪 معاينة الوداع\n${payload.content || ""}`.slice(0, 2000), allowedMentions: { parse: [] }, flags: 64 });
    }
    case "wel:btnadd": {
      if (!interaction.isModalSubmit?.()) {
        const field = (id, label, max) => new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(max));
        return safeModal(interaction, new ModalBuilder().setCustomId("panel:sysa:wel:btnadd").setTitle("زر رابط في الترحيب")
          .addComponents(field("label", "نص الزر", 80), field("url", "الرابط https://", 500)));
      }
      const label = String(interaction.fields.getTextInputValue("label") || "").trim();
      const url = String(interaction.fields.getTextInputValue("url") || "").trim();
      if (!require("../../plugins/welcome/WelcomeService").validButton(label, url)) return fail(interaction, app, "نص الزر مطلوب والرابط يجب أن يبدأ بـ https://");
      const buttons = (app.welcome.config(g).buttons || []).filter((b) => b.label !== label);
      if (buttons.length >= 4) return fail(interaction, app, "الحد الأقصى 4 أزرار.");
      buttons.push({ label, url });
      app.guildConfig.set(g, "welcome.buttons", buttons);
      return show(ok(`أُضيف الزر: ${label}`));
    }
    case "wel:btndel": {
      const buttons = app.welcome.config(g).buttons || [];
      if (interaction.values?.length) {
        const keep = buttons.filter((b) => !interaction.values.includes(b.label));
        app.guildConfig.set(g, "welcome.buttons", keep);
        return show(ok(`حُذف ${buttons.length - keep.length} زر.`));
      }
      if (!buttons.length) return show("ℹ️ لا توجد أزرار روابط.");
      return safeUpdate(interaction, pickScreen(app, sys, ui, "🗑️ حذف أزرار الروابط",
        new StringSelectMenuBuilder().setCustomId("panel:sysa:wel:btndel:go").setPlaceholder("اختر الأزرار").setMinValues(1).setMaxValues(buttons.length)
          .addOptions(buttons.map((b) => ({ label: truncate(b.label, 100), value: b.label, description: truncate(b.url, 100) })))));
    }

    case "pub:pick":
    case "pub:ch":
    case "pub:key":
    case "pub:mod":
    case "pub:srroles":
    case "pub:srstyle":
      return publishFlow(interaction, app, ui, sys, act.id, step, { show, ok });

    case "auto:flip": {
      const id = Number(interaction.values?.[0]);
      if (!app.automation.get(g, id)) return show();
      const now = app.automation.toggle(g, id);
      return show(ok(`سير العمل #${id}: ${now ? "مفعّل" : "متوقف"}`));
    }
    case "intg:flip": {
      const id = Number(interaction.values?.[0]);
      if (!app.integrations.get(g, id)) return show();
      app.integrations.toggle(g, id);
      return show(ok(`التكامل #${id}: ${app.integrations.get(g, id)?.enabled ? "مفعّل" : "متوقف"}`));
    }

    case "bak:now": {
      const res = app.guildBackups.create(guild, { kind: "manual", userId: member.id });
      if (res && res.ok === false) return fail(interaction, app, res.reason || "تعذّر إنشاء النسخة.");
      return show(ok("أُنشئت نسخة احتياطية."));
    }
    case "bak:sched": {
      const value = interaction.values?.[0];
      if (!["off", "daily", "weekly"].includes(value)) return show();
      app.guildBackups.setSchedule(g, value === "off" ? null : value);
      return show(ok("حُفظت الجدولة."));
    }

    default:
      return show();
  }
}


// ============================================================
//  خطوات النشر: اللوحة ← (الرتب/المفتاح) ← القناة ← (النافذة) ← النشر
// ============================================================
async function publishFlow(interaction, app, ui, sys, stage, step, { show, ok }) {
  const guild = interaction.guild;
  const member = interaction.member;
  const available = publishersFor(app, guild);
  const find = (id) => available.find((p) => p.id === id) || null;

  const channelScreen = (pub) => safeUpdate(interaction, pickScreen(app, sys, ui, `📤 أين تُنشر ${pub.label}؟`,
    new ChannelSelectMenuBuilder().setCustomId(`panel:sysa:pub:ch:${pub.id}`).setPlaceholder("اختر القناة").setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

  const rolesScreen = () => safeUpdate(interaction, pickScreen(app, sys, ui, "🎭 اختر رتب اللوحة (حتى 10)",
    new RoleSelectMenuBuilder().setCustomId("panel:sysa:pub:srroles").setPlaceholder("الرتب").setMinValues(1).setMaxValues(10)));

  const styleScreen = (draft, notice = null) => safeUpdate(interaction, ui.panelView({
    embeds: [buildEmbed({
      title: "🎭 لوحة رتب ذاتية",
      description: [notice, `**الرتب:** ${draft.roles.map((r) => `<@&${r.id}>`).join(" ")}`, `**الشكل:** ${draft.style === "buttons" ? "أزرار" : "قائمة اختيار"}`, "اختر الشكل ثم القناة."].filter(Boolean).join("\n"),
      color: app.config.color("primary")
    })],
    components: [
      new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("panel:sysa:pub:srstyle").setPlaceholder("الشكل")
        .addOptions([{ label: "قائمة اختيار", value: "menu", default: draft.style !== "buttons" }, { label: "أزرار", value: "buttons", default: draft.style === "buttons" }])),
      new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("panel:sysa:pub:ch:sr").setPlaceholder("اختر القناة")
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
      subNav(ui, sys)
    ]
  }));

  const send = async (pub, channel, payload) => {
    const message = await channel.send(payload).catch(() => null);
    if (!message) return fail(interaction, app, "تعذّر نشر اللوحة.");
    if (pub.after) pub.after(app, guild, channel, message);
    return show(ok(`نُشرت ${pub.label} في <#${channel.id}>.`));
  };

  const resolveChannel = (id) => {
    const channel = guild.channels.cache.get(id);
    if (!channel) return { error: "القناة غير موجودة." };
    if (!botCanSend(guild, channel)) return { error: `لا أملك صلاحية الإرسال في <#${channel.id}>.` };
    return { channel };
  };

  switch (stage) {
    case "pick": {
      const pub = find(interaction.values?.[0]);
      if (!pub) return show();
      if (pub.id === "sr") return rolesScreen();
      return channelScreen(pub);
    }

    case "srroles": {
      const { validateGrantableRole } = require("../roles/selfRoles");
      const roles = [];
      for (const id of interaction.values || []) {
        const role = guild.roles.cache.get(id);
        const problem = validateGrantableRole(app, guild, member, role);
        if (problem) return fail(interaction, app, problem);
        roles.push({ id: role.id, name: role.name });
      }
      if (!roles.length) return rolesScreen();
      return styleScreen(srDraft(guild.id, member.id, { roles }));
    }
    case "srstyle": {
      const draft = srDraft(guild.id, member.id);
      if (!draft) return rolesScreen();
      const style = interaction.values?.[0] === "buttons" ? "buttons" : "menu";
      return styleScreen(srDraft(guild.id, member.id, { style }));
    }

    case "ch": {
      const pub = find(step);
      if (!pub) return fail(interaction, app, "هذه اللوحة غير متاحة (النظام متوقف؟).");
      const notReady = pub.ready?.(app, guild);
      if (notReady) return fail(interaction, app, notReady);
      if (!interaction.values?.length) {
        if (pub.id === "sr") {
          const draft = srDraft(guild.id, member.id);
          return draft ? styleScreen(draft) : rolesScreen();
        }
        return channelScreen(pub);
      }
      const { channel, error } = resolveChannel(interaction.values[0]);
      if (error) return fail(interaction, app, error);

      if (pub.keys) {
        const keys = pub.keys(app, guild);
        if (!keys.length) return fail(interaction, app, "لا توجد عناصر مفعّلة لهذه اللوحة بعد.");
        return safeUpdate(interaction, pickScreen(app, sys, ui, `📤 ${pub.label}`,
          new StringSelectMenuBuilder().setCustomId(`panel:sysa:pub:key:${pub.id}.${channel.id}`).setPlaceholder("اختر العنصر")
            .addOptions(keys.slice(0, 25).map((k) => ({ label: truncate(k.label, 100), value: k.value })))));
      }
      if (pub.id === "tkt") {
        const field = (id, label, { paragraph = false, max = 100, placeholder = null } = {}) => {
          const input = new TextInputBuilder().setCustomId(id).setLabel(label).setRequired(false).setMaxLength(max)
            .setStyle(paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short);
          if (placeholder) input.setPlaceholder(placeholder);
          return new ActionRowBuilder().addComponents(input);
        };
        return safeModal(interaction, new ModalBuilder().setCustomId(`panel:sysa:pub:mod:tkt.${channel.id}`).setTitle("لوحة فتح التذاكر").addComponents(
          field("title", "العنوان", { max: 256, placeholder: "🎫 نظام التذاكر" }),
          field("description", "الوصف", { paragraph: true, max: 4000 }),
          field("button", "نص الزر | الإيموجي", { max: 100, placeholder: "فتح تذكرة | 🎫" }),
          field("color", "اللون #RRGGBB", { max: 7 }),
          field("images", "البانر | الصورة المصغّرة (https://)", { max: 1000 })
        ));
      }
      if (pub.id === "sr") {
        const draft = srDraft(guild.id, member.id);
        if (!draft) return rolesScreen();
        return safeModal(interaction, new ModalBuilder().setCustomId(`panel:sysa:pub:mod:sr.${channel.id}`).setTitle("لوحة رتب ذاتية").addComponents(
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("title").setLabel("العنوان").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(256).setPlaceholder("🎭 الرتب الذاتية")),
          new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("max").setLabel("أقصى عدد رتب للعضو").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(2).setPlaceholder(String(draft.roles.length)))
        ));
      }
      if (pub.publish) {
        const res = await pub.publish(app, guild, channel);
        if (!res.ok) return fail(interaction, app, res.error);
        return show(ok(`نُشرت ${pub.label} في <#${channel.id}>.`));
      }
      return send(pub, channel, pub.payload(app, guild));
    }

    case "key": {
      const [pubId, channelId] = String(step || "").split(".");
      const pub = find(pubId);
      if (!pub?.payloadFor) return show();
      const { channel, error } = resolveChannel(channelId);
      if (error) return fail(interaction, app, error);
      const payload = pub.payloadFor(app, guild, interaction.values?.[0]);
      if (!payload) return fail(interaction, app, "العنصر غير موجود.");
      return send(pub, channel, payload);
    }

    case "mod": {
      const [pubId, channelId] = String(step || "").split(".");
      const pub = find(pubId);
      if (!pub || !interaction.isModalSubmit?.()) return show();
      const { channel, error } = resolveChannel(channelId);
      if (error) return fail(interaction, app, error);
      const val = (id) => String(interaction.fields.getTextInputValue(id) || "").trim();

      if (pub.id === "tkt") {
        const [label, emoji] = val("button").split("|").map((x) => x.trim());
        const [banner, thumbnail] = val("images").split("|").map((x) => x.trim());
        const res = await require("../tickets/publish").publishTicketPanel(app, guild, channel, {
          title: val("title"), description: val("description"), buttonLabel: label, buttonEmoji: emoji === undefined ? undefined : emoji,
          color: val("color") || null, banner: banner || null, thumbnail: thumbnail || null
        });
        if (!res.ok) return fail(interaction, app, res.error);
        return show(ok(`نُشرت ${pub.label} في <#${channel.id}> (المعرّف \`${res.id}\`).`));
      }
      if (pub.id === "sr") {
        const draft = srDraft(guild.id, member.id);
        if (!draft) return fail(interaction, app, "انتهت المسودة — اختر الرتب من جديد.");
        const max = val("max") ? Number(val("max")) : draft.roles.length;
        if (!Number.isInteger(max) || max < 1) return fail(interaction, app, "أقصى عدد يجب أن يكون رقمًا صحيحًا ≥ 1.");
        const res = await require("../roles/selfRoles").publishSelfRoles(app, guild, channel, { title: val("title"), style: draft.style, max, roles: draft.roles });
        if (!res.ok) return fail(interaction, app, res.error);
        SR_DRAFTS.delete(`${guild.id}:${member.id}`);
        return show(ok(`نُشرت ${pub.label} في <#${channel.id}>.`));
      }
      return show();
    }

    default:
      return show();
  }
}

/** مستوى الدخول لكل إجراء — لجدول `needed` في interactions.js. */
const ACTIONS = [
  "sys", "sysopen", "sysv", "syst", "sysb", "sysc", "syscs", "syscx", "sysr", "sysrs", "sysrx",
  "sysl", "sysls", "syslx", "sysch", "sysx", "sysxs", "sysn", "sysns", "sysa", "close"
];

module.exports = { SYSTEMS, PUBLISHERS, ACTIONS, handle, hub };
