const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  RoleSelectMenuBuilder, ChannelSelectMenuBuilder, UserSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ChannelType, PermissionFlagsBits
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, extractId, parseDuration, formatDuration, truncate, timestamp } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");
const systems = require("./systems");

const LOG_TYPES = [
  { key: "moderation", label: "الإجراءات الإدارية" },
  { key: "messages", label: "الرسائل" },
  { key: "roles", label: "الرتب" },
  { key: "channels", label: "القنوات" },
  { key: "members", label: "الأعضاء" },
  { key: "voice", label: "الصوت" },
  { key: "tickets", label: "التذاكر" },
  { key: "security", label: "الحماية" },
  { key: "economy", label: "الحركات المالية" },
  { key: "violations", label: "المخالفات" },
  { key: "flights", label: "الطيران" },
  { key: "evidence", label: "الدلائل" },
  { key: "applications", label: "التقديمات" },
  { key: "quiz", label: "نتائج التفعيل" },
  { key: "leave", label: "الإجازات" },
  { key: "resign", label: "الاستقالات" },
  { key: "reports", label: "البلاغات" },
  { key: "errors", label: "الأخطاء" }
];

const SETTING_ROLES = [
  { key: "staff.baseRoleId", label: "رتبة الطاقم الأساسية" }
];

const TOGGLES = [
  { key: "moderation.enabled", label: "نظام الإدارة" },
  { key: "tickets.enabled", label: "نظام التذاكر" },
  { key: "security.enabled", label: "نظام الحماية" },
  { key: "autoRoles.enabled", label: "الرتب التلقائية" },
  { key: "economy.enabled", label: "نظام البنك" },
  { key: "violations.enabled", label: "نظام المخالفات" },
  { key: "flights.enabled", label: "نظام الطيران" },
  { key: "quiz.enabled", label: "اختبار التفعيل" },
  { key: "leave.enabled", label: "نظام الإجازات" },
  { key: "resign.enabled", label: "نظام الاستقالات" },
  { key: "reports.enabled", label: "البلاغات على الإداريين" },
  { key: "moderation.dmOnPunish", label: "إشعار العضو عند العقوبة" },
  { key: "commands.noPrefix.enabled", label: "الأوامر بدون بريفكس" }
];

function btn(id, label, emoji, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function backRow(app) {
  return new ActionRowBuilder().addComponents(
    btn("panel:home", "القائمة الرئيسية", app.config.emoji("back")),
    btn("panel:close", "إغلاق", "✖️")
  );
}

/**
 * يحوّل شكل `{ embeds, components }` التقليدي إلى حاوية Components v2 واحدة،
 * فتظهر الأزرار **داخل** الحاوية الملوّنة بدل انفصالها تحتها.
 *
 * كل شاشات اللوحة تمر من هنا. السبب: ديسكورد لا يسمح بإزالة علم v2 بعد ضبطه
 * على رسالة، واللوحة تتنقّل عبر عشرات الشاشات على **نفس الرسالة** —
 * فإما كل الشاشات v2 أو كلها تقليدية. لا خلط.
 */
function panelView({ embeds = [], components = [] }) {
  const parts = [];
  let color;

  for (const embed of embeds) {
    const d = embed.data || embed;
    if (color === undefined && typeof d.color === "number") color = d.color;

    const chunk = [];
    if (d.author?.name) chunk.push(`-# ${d.author.name}`);
    if (d.title) chunk.push(`## ${d.title}`);
    if (d.description) chunk.push(d.description);

    for (const field of d.fields || []) {
      chunk.push(`**${field.name}**\n${field.value}`);
    }
    if (d.footer?.text) chunk.push(`-# ${d.footer.text}`);

    const text = chunk.join("\n\n").trim();
    if (text) parts.push(text);
  }

  const body = parts.join("\n\n") || "‎";
  const images = [];
  for (const embed of embeds) {
    const d = embed.data || embed;
    if (d.image?.url) images.push(d.image.url);
    else if (typeof d.image === "string") images.push(d.image);
    // الحاوية الحديثة لا تعرف "صورة مصغّرة"، فنعرضها ضمن الصور
    // وإلا اختفى شعار السيرفر كليًا من كل شاشات اللوحة.
    else if (d.thumbnail?.url) images.push(d.thumbnail.url);
    else if (typeof d.thumbnail === "string") images.push(d.thumbnail);
  }

  return containerPayload({
    text: truncate(body, 3900),
    color,
    images,
    rows: components,
    divide: false
  });
}

/**
 * اللوحة الرئيسية — نقطة الدخول الموحّدة لكل أنظمة البوت الإدارية.
 * بدل أوامر Slash منفصلة لكل نظام، كل الإدارة تمر من هنا.
 * الأزرار تُبنى حسب مستوى المستخدم، والصلاحية تُفحص من جديد عند كل ضغطة في `handle()`.
 */
function home(app, member) {
  const level = app.permissions.resolveLevel(member);
  const e = (n) => app.config.emoji(n);

  const rows = [];

  // الصف 1: الإدارة اليومية
  const row1 = new ActionRowBuilder();
  if (level >= Level.MODERATOR) row1.addComponents(btn("panel:moderation", "الإدارة", e("shield")));
  if (level >= Level.STAFF) row1.addComponents(btn("panel:tickets", "التذاكر", e("ticket")));
  if (level >= Level.STAFF) row1.addComponents(btn("panel:staff", "السلم الإداري", e("staff")));
  if (level >= Level.ADMIN) row1.addComponents(btn("panel:lifecycle", "الإجازات والبلاغات", "🌴"));
  if (level >= Level.STAFF) row1.addComponents(btn("panel:reports", "التقارير", "📊"));
  if (row1.components.length) rows.push(row1);

  // الصف 2: المحتوى والتفاعل
  const row2 = new ActionRowBuilder();
  if (level >= Level.ADMIN) row2.addComponents(btn("panel:builder", "بناء الإمبيدات", "🎨"));
  if (level >= Level.ADMIN) row2.addComponents(btn("panel:engage", "التفاعل والمحتوى", "🎉"));
  if (level >= Level.STAFF) row2.addComponents(btn("panel:economy", "الاقتصاد", "🏦"));
  if (level >= Level.ADMIN) row2.addComponents(btn("panel:evidence", "الدلائل", "📁"));
  if (level >= Level.STAFF) row2.addComponents(btn("panel:civil", "الأنظمة المدنية", "🏙️"));
  if (row2.components.length) rows.push(row2);

  // الصف 3: الإعدادات العامة
  const row3 = new ActionRowBuilder();
  if (level >= Level.ADMIN) {
    row3.addComponents(
      btn("panel:logs", app.i18n.t("panel.sections.logs"), e("logs")),
      btn("panel:settings", app.i18n.t("panel.sections.settings"), e("settings")),
      btn("panel:toggles", "تشغيل الأنظمة", "🔀"),
      btn("panel:security", "الحماية", "🔐")
    );
  }
  if (row3.components.length) rows.push(row3);

  // الصف 4: أدوات المطور والمراقبة
  const row4 = new ActionRowBuilder();
  if (level >= Level.STAFF) row4.addComponents(btn("panel:stats", "الإحصائيات", e("stats")));
  if (level >= Level.DEVELOPER) {
    row4.addComponents(
      btn("panel:dev", app.i18n.t("panel.sections.developer"), e("developer"), ButtonStyle.Danger),
      btn("panel:oversight", "مراقبة السيرفرات", "🛡️", ButtonStyle.Danger),
      btn("panel:checkup", "الفحص الشامل", "🔍")
    );
  }
  if (row4.components.length) rows.push(row4);

  const row5 = new ActionRowBuilder().addComponents(btn("panel:help", app.i18n.t("panel.sections.help"), e("help"), ButtonStyle.Primary));
  // الأنظمة والإعدادات الموسّعة (الترحيب، التحقق، المستويات، الاقتراحات، الثيم، السجلات...)
  if (level >= Level.MODERATOR) row5.addComponents(btn("panel:sys", "الأنظمة والإعدادات", "🧩", ButtonStyle.Primary));
  rows.push(row5);

  // كل شاشات اللوحة تمر عبر panelView فتُعرض بنمط Components v2 موحّد:
  // الأزرار داخل الحاوية الملوّنة، والتنقّل لا ينكسر لأن النمط واحد في كل الشاشات.
  const embed = buildEmbed({
    title: `${e("settings")} لوحة التحكم المركزية`,
    description:
      "كل أنظمة البوت من هنا — بدل أوامر منفصلة لكل إعداد.\n" +
      "اختر قسمًا بالأسفل للدخول إلى إعداداته وأزراره.",
    color: app.config.color("primary"),
    fields: [{ name: app.i18n.t("panel.yourLevel"), value: app.i18n.t(`levels.${level}`), inline: true }]
  });

  return panelView({ embeds: [embed], components: rows.slice(0, 5) });
}

module.exports = {
  prefix: "panel",
  home,

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const action = parts[1];
    const arg = parts[2];

    const level = app.permissions.resolveLevel(interaction.member);
    const needed = {
      home: Level.EVERYONE, help: Level.EVERYONE,
      moderation: Level.MODERATOR, modaction: Level.MODERATOR, modsubmit: Level.MODERATOR,
      stats: Level.STAFF,
      staff: Level.STAFF, logs: Level.ADMIN, logpick: Level.ADMIN, logset: Level.ADMIN,
      staffadd: Level.ADMIN, staffaddset: Level.ADMIN, staffdel: Level.ADMIN, staffdelset: Level.ADMIN,
      staffbase: Level.ADMIN, staffbaseset: Level.ADMIN, staffpoints: Level.STAFF,
      staffme: Level.STAFF, staffpromote: Level.ADMIN, staffdemote: Level.ADMIN,
      staffdismiss: Level.ADMIN, staffact: Level.ADMIN,
      settings: Level.ADMIN, prefix: Level.ADMIN, prefixsubmit: Level.ADMIN, builder: Level.ADMIN,
      economy: Level.STAFF,
      roleset: Level.ADMIN, rolepick: Level.ADMIN, toggles: Level.ADMIN, toggle: Level.ADMIN,
      dev: Level.DEVELOPER,

      // أنظمة المدينة (RP): السجن والشخصيات والممتلكات والرتب
      civil: Level.STAFF, quests: Level.STAFF, questtoggle: Level.ADMIN,
      idn: Level.ADMIN, idnreview: Level.ADMIN, idnreviewset: Level.ADMIN,
      idnrole: Level.ADMIN, idnroleset: Level.ADMIN, idnvalidity: Level.ADMIN, idnvaliditysave: Level.ADMIN,
      idntemplate: Level.ADMIN, idntemplatesave: Level.ADMIN, idntoggle: Level.ADMIN, idnpending: Level.ADMIN,
      gov: Level.ADMIN, govcouncil: Level.ADMIN, govcouncilset: Level.ADMIN,
      govcirculars: Level.ADMIN, govcircularsset: Level.ADMIN, govretirements: Level.ADMIN, govretirementsset: Level.ADMIN,
      govcouncilrole: Level.ADMIN, govcouncilroleset: Level.ADMIN, govretiredrole: Level.ADMIN, govretiredroleset: Level.ADMIN,
      govtoggle: Level.ADMIN,
      rp: Level.STAFF, rpjail: Level.STAFF, rpunjail: Level.STAFF, rpunjailset: Level.STAFF,
      rpamnesty: Level.ADMIN, rpamnestygo: Level.ADMIN,
      rpjailrole: Level.ADMIN, rpjailroleset: Level.ADMIN,
      rpjailrooms: Level.ADMIN, rpjailroomsset: Level.ADMIN, rpjailsetup: Level.ADMIN,
      rpcuffs: Level.STAFF, rpuncuffall: Level.STAFF,
      rpranks: Level.ADMIN, rptoggle: Level.ADMIN, rpimages: Level.ADMIN, rpimagessave: Level.ADMIN,

      // الأقسام المضافة لتوحيد التحكم داخل اللوحة
      tickets: Level.STAFF, ticketsetting: Level.ADMIN, ticketpick: Level.ADMIN, ticketset: Level.ADMIN,
      lifecycle: Level.ADMIN, lifecycletoggle: Level.ADMIN, lifecyclepick: Level.ADMIN, lifecycleset: Level.ADMIN,
      reports: Level.STAFF, reporttoggle: Level.ADMIN, reportpick: Level.ADMIN, reportset: Level.ADMIN,
      engage: Level.ADMIN, engagetoggle: Level.ADMIN, engagepick: Level.ADMIN, engageset: Level.ADMIN,
      evidence: Level.ADMIN, evidencepick: Level.ADMIN, evidenceset: Level.ADMIN,
      security: Level.ADMIN, securitytoggle: Level.ADMIN, securitypick: Level.ADMIN, securityset: Level.ADMIN,
      oversight: Level.DEVELOPER, oversightpick: Level.DEVELOPER, oversightset: Level.DEVELOPER,
      oversightaction: Level.DEVELOPER,
      checkup: Level.STAFF,

      // محرّر الإمبيد من داخل اللوحة
      ebopen: Level.ADMIN, ebvars: Level.ADMIN, ebtpls: Level.ADMIN,

      // الأنظمة والإعدادات (systems.js) — وكل نظام يفحص مستواه الخاص أيضًا
      ...Object.fromEntries(systems.ACTIONS.map((a) => [a, a === "close" ? Level.EVERYONE : Level.MODERATOR]))
    }[action];

    if (needed !== undefined && level < needed) {
      return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
    }

    switch (action) {
      case "home": return safeUpdate(interaction, home(app, interaction.member));
      case "moderation": return moderationPanel(interaction, app);
      case "modaction": return moderationModal(interaction, app);
      case "modsubmit": return moderationSubmit(interaction, app, arg);
      case "logs": return logsPanel(interaction, app);
      case "logpick": return logPick(interaction, app);
      case "logset": return logSet(interaction, app, arg);
      case "settings": return settingsPanel(interaction, app);
      case "prefix": return prefixModal(interaction, app);
      case "prefixsubmit": return prefixSubmit(interaction, app);
      case "rolepick": return rolePick(interaction, app);
      case "roleset": return roleSet(interaction, app, arg);
      case "toggles": return togglesPanel(interaction, app);
      case "toggle": return toggleSet(interaction, app);
      case "staff": return staffPanel(interaction, app);
      case "staffadd": return staffAddPick(interaction, app);
      case "staffaddset": return staffAddSet(interaction, app);
      case "staffdel": return staffDelPick(interaction, app);
      case "staffdelset": return staffDelSet(interaction, app);
      case "staffbase": return staffBasePick(interaction, app);
      case "staffpoints": return staffPointsPanel(interaction, app);
      case "staffme": return staffMePanel(interaction, app);
      case "staffpromote": return staffActionPick(interaction, app, "up");
      case "staffdemote": return staffActionPick(interaction, app, "down");
      case "staffdismiss": return staffActionPick(interaction, app, "dismiss");
      case "staffact": return staffActionRun(interaction, app, arg);
      case "staffbaseset": return staffBaseSet(interaction, app);
      case "builder": return builderPanel(interaction, app);
      case "economy": return economyPanel(interaction, app);
      case "stats": return statsPanel(interaction, app);
      case "help": return helpPanel(interaction, app);
      case "dev": return devPanel(interaction, app);

      // التذاكر
      case "tickets": return ticketsPanel(interaction, app);
      case "ticketsetting": return ticketSettingModal(interaction, app, arg);
      case "ticketsettingsave": return ticketSettingSave(interaction, app, arg);
      case "ticketpick": return ticketChannelPick(interaction, app, arg);
      case "ticketset": return ticketChannelSet(interaction, app, arg);

      // الإجازات والاستقالات والبلاغات
      case "lifecycle": return lifecyclePanel(interaction, app);
      case "lifecycletoggle": return lifecycleToggle(interaction, app, arg);
      case "lifecyclepick": return lifecycleChannelPick(interaction, app, arg);
      case "lifecycleset": return lifecycleChannelSet(interaction, app, arg);

      // التقارير الدورية
      case "reports": return reportsPanel(interaction, app);
      case "reporttoggle": return reportsToggle(interaction, app);
      case "reportpick": return reportsChannelPick(interaction, app);
      case "reportset": return reportsChannelSet(interaction, app);

      // التفاعل والمحتوى: الردود التلقائية، رد التفاعلات، لوحة النجوم، المميّز، السحوبات، الاستطلاعات، الإذاعة
      case "engage": return engagePanel(interaction, app);
      case "engagetoggle": return engageToggle(interaction, app, arg);
      case "engagepick": return engageChannelPick(interaction, app, arg);
      case "engageset": return engageChannelSet(interaction, app, arg);

      // الدلائل (قناة النشر)
      case "evidence": return evidencePanel(interaction, app);
      case "evidencepick": return evidenceChannelPick(interaction, app);
      case "evidenceset": return evidenceChannelSet(interaction, app);

      // الحماية
      case "security": return securityPanel(interaction, app);
      case "securitytoggle": return securityToggle(interaction, app);
      case "securitypick": return securityRulePick(interaction, app);
      case "securityset": return securityRuleSet(interaction, app, arg);

      // مراقبة السيرفرات (للمطور)
      case "oversight": return oversightPanel(interaction, app);
      case "oversightpick": return oversightGuildPick(interaction, app);
      case "oversightset": return oversightGuildAction(interaction, app, arg);
      case "oversightaction": return oversightExecute(interaction, app, arg);

      // الفحص الشامل
      case "checkup": return checkupPanel(interaction, app);

      // أنظمة المدينة

      case "civil": return civilHub(interaction, app);
      case "quests": return questsPanel(interaction, app);
      case "questtoggle": return questsToggle(interaction, app);

      case "idn": return idnPanel(interaction, app);
      case "idnreview": return idnReviewPick(interaction, app);
      case "idnreviewset": return idnReviewSet(interaction, app);
      case "idnrole": return idnRolePick(interaction, app);
      case "idnroleset": return idnRoleSet(interaction, app);
      case "idnvalidity": return idnValidityModal(interaction, app);
      case "idnvaliditysave": return idnValiditySave(interaction, app);
      case "idntemplate": return idnTemplateModal(interaction, app);
      case "idntemplatesave": return idnTemplateSave(interaction, app);
      case "idntoggle": return idnToggle(interaction, app);
      case "idnpending": return idnPending(interaction, app);

      case "gov": return govPanel(interaction, app);
      case "govcouncil": return govChannelPick(interaction, app, "council");
      case "govcouncilset": return govChannelSet(interaction, app, "council");
      case "govcirculars": return govChannelPick(interaction, app, "circulars");
      case "govcircularsset": return govChannelSet(interaction, app, "circulars");
      case "govretirements": return govChannelPick(interaction, app, "retirements");
      case "govretirementsset": return govChannelSet(interaction, app, "retirements");
      case "govcouncilrole": return govRolePick(interaction, app, "council");
      case "govcouncilroleset": return govRoleSet(interaction, app, "council");
      case "govretiredrole": return govRolePick(interaction, app, "retired");
      case "govretiredroleset": return govRoleSet(interaction, app, "retired");
      case "govtoggle": return govToggle(interaction, app);

      case "rp": return rpPanel(interaction, app);
      case "rpjail": return rpJailPanel(interaction, app);
      case "rpunjail": return rpUnjailPick(interaction, app);
      case "rpunjailset": return rpUnjailSet(interaction, app);
      case "rpamnesty": return rpAmnestyConfirm(interaction, app);
      case "rpamnestygo": return rpAmnestyGo(interaction, app);
      case "rpjailrole": return rpJailRolePick(interaction, app);
      case "rpjailroleset": return rpJailRoleSet(interaction, app);
      case "rpjailrooms": return rpJailRoomsPick(interaction, app);
      case "rpjailroomsset": return rpJailRoomsSet(interaction, app);
      case "rpjailsetup": return rpJailSetup(interaction, app);
      case "rpcuffs": return rpCuffsPanel(interaction, app);
      case "rpuncuffall": return rpUncuffAll(interaction, app);
      case "rpranks": return rpRanksPanel(interaction, app);
      case "rptoggle": return rpToggle(interaction, app, arg);
      case "rpimages": return rpImagesModal(interaction, app);
      case "rpimagessave": return rpImagesSave(interaction, app);

      // محرّر الإمبيد: فتح إمبيد، المتغيرات، القوالب
      case "ebopen": return builderOpen(interaction, app);
      case "ebvars": return builderVariables(interaction, app);
      case "ebtpls": return builderTemplates(interaction, app);

      default:
        if (systems.ACTIONS.includes(action)) return systems.handle(interaction, app, { panelView, btn });
        return null;
    }
  }
};

// ---------------- الإدارة ----------------
const MOD_ACTIONS = [
  { value: "ban", label: "حظر", needsDuration: false },
  { value: "kick", label: "طرد", needsDuration: false },
  { value: "timeout", label: "إسكات", needsDuration: true },
  { value: "untimeout", label: "فك إسكات", needsDuration: false },
  { value: "warn", label: "تحذير", needsDuration: false },
  { value: "unban", label: "فك حظر", needsDuration: false }
];

async function moderationPanel(interaction, app) {
  const embed = buildEmbed({
    title: `${app.config.emoji("shield")} ${app.i18n.t("panel.moderation.title")}`,
    description: app.i18n.t("panel.moderation.description"),
    color: app.config.color("danger")
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:modaction")
    .setPlaceholder("اختر الإجراء الإداري")
    .addOptions(MOD_ACTIONS.map((a) => ({ label: a.label, value: a.value })));
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), backRow(app)] }));
}

async function moderationModal(interaction, app) {
  const action = interaction.values?.[0];
  const meta = MOD_ACTIONS.find((a) => a.value === action);

  // قائمة تالفة أو إجراء غير معروف: نرد برسالة بدل الانهيار على meta.label
  if (!meta) {
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} إجراء إداري غير معروف. أعد فتح القسم وحاول مجددًا.`,
      flags: 64
    });
  }

  const modal = new ModalBuilder().setCustomId(`panel:modsubmit:${action}`).setTitle(meta.label);
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("user").setLabel("آيدي العضو أو منشن").setStyle(TextInputStyle.Short).setRequired(true)
    )
  );
  if (meta.needsDuration) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("duration").setLabel("المدة مثل 10m أو 2h").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
  }
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("reason").setLabel("السبب").setStyle(TextInputStyle.Paragraph).setRequired(false)
    )
  );
  return safeModal(interaction, modal);
}

async function moderationSubmit(interaction, app, action) {
  await interaction.deferReply({ flags: 64 });

  const userId = extractId(interaction.fields.getTextInputValue("user"));
  if (!userId) return safeUpdate(interaction, { content: `${app.config.emoji("error")} آيدي غير صالح.` });

  const reason = interaction.fields.getTextInputValue("reason") || null;
  let durationMs = null;
  try {
    const raw = interaction.fields.getTextInputValue("duration");
    durationMs = parseDuration(raw);
    if (raw && !durationMs) return safeUpdate(interaction, { content: app.i18n.t("errors.invalidDuration", { emoji: app.config.emoji("error") }) });
  } catch { /* حقل المدة غير موجود لهذا الإجراء */ }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const user = member?.user || (await app.client.users.fetch(userId).catch(() => null));
  if (!user) return safeUpdate(interaction, { content: app.i18n.t("errors.userNotFound", { emoji: app.config.emoji("error") }) });

  const result = await app.moderation.punish({
    type: action,
    guild: interaction.guild,
    executor: interaction.member,
    target: member,
    targetUser: user,
    reason,
    durationMs
  });

  if (!result.ok) {
    return safeUpdate(interaction, {
      content: app.i18n.t(`errors.${result.reason}`, { emoji: app.config.emoji("error"), details: result.details || "" })
    });
  }

  const label = MOD_ACTIONS.find((a) => a.value === action)?.label || action;
  return safeUpdate(interaction, {
    content: `${app.config.emoji("success")} تم تنفيذ **${label}** على <@${user.id}> — القضية \`#${result.case.case_number}\`` +
      (durationMs ? ` — المدة: ${formatDuration(durationMs)}` : "")
  });
}

// ---------------- السجلات ----------------
async function logsPanel(interaction, app) {
  const cfg = app.guildConfig.get(interaction.guild.id);
  const lines = LOG_TYPES.map((t) => `**${t.label}:** ${cfg.logs[t.key] ? `<#${cfg.logs[t.key]}>` : "غير محددة"}`);
  const embed = buildEmbed({
    title: `${app.config.emoji("logs")} ${app.i18n.t("panel.logs.title")}`,
    description: `${app.i18n.t("panel.logs.description")}\n\n${lines.join("\n")}`,
    color: app.config.color("primary")
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:logpick")
    .setPlaceholder("اختر نوع السجل")
    .addOptions(LOG_TYPES.map((t) => ({ label: t.label, value: t.key })));
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), backRow(app)] }));
}

async function logPick(interaction, app) {
  const key = interaction.values[0];
  const label = LOG_TYPES.find((t) => t.key === key)?.label || key;
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`panel:logset:${key}`)
    .setPlaceholder(`اختر قناة: ${label}`)
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: `📜 ${label}`, description: "اختر القناة من القائمة.", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function logSet(interaction, app, key) {
  const channelId = interaction.values[0];
  const channel = interaction.guild.channels.cache.get(channelId);

  // التحقق أن البوت يستطيع فعلًا الإرسال في القناة قبل حفظها
  const me = interaction.guild.members.me;
  if (channel && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>. عدّل صلاحيات القناة ثم أعد المحاولة.`,
        color: app.config.color("danger")
      })],
      components: [backRow(app)]
    }));
  }

  app.guildConfig.set(interaction.guild.id, `logs.${key}`, channelId);
  const label = LOG_TYPES.find((t) => t.key === key)?.label || key;
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ description: `${app.config.emoji("success")} تم ربط سجل **${label}** بالقناة <#${channelId}>`, color: app.config.color("success") })],
    components: [backRow(app)]
  }));
}

// ---------------- الإعدادات ----------------
async function settingsPanel(interaction, app) {
  const cfg = app.guildConfig.get(interaction.guild.id);
  const embed = buildEmbed({
    title: `${app.config.emoji("settings")} ${app.i18n.t("panel.settings.title")}`,
    description: app.i18n.t("panel.settings.description"),
    color: app.config.color("primary"),
    fields: [
      { name: "البريفكس", value: `\`${cfg.prefix}\``, inline: true },
      { name: "رتبة الطاقم", value: cfg.staff.baseRoleId ? `<@&${cfg.staff.baseRoleId}>` : "غير محددة", inline: true },
      { name: "كاتيغوري التذاكر", value: cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : "غير محددة", inline: true }
    ]
  });
  const row = new ActionRowBuilder().addComponents(
    btn("panel:prefix", "تغيير البريفكس", "⌨️"),
    btn("panel:rolepick", "تحديد الرتب", "🎖️"),
    btn("panel:toggles", "تشغيل الأنظمة", "🔀")
  );
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [row, backRow(app)] }));
}

async function prefixModal(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "prefix");
  const modal = new ModalBuilder().setCustomId("panel:prefixsubmit").setTitle("تغيير البريفكس");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("prefix").setLabel("البريفكس الجديد").setStyle(TextInputStyle.Short)
        .setValue(current).setRequired(true).setMaxLength(5)
    )
  );
  return safeModal(interaction, modal);
}

async function prefixSubmit(interaction, app) {
  const prefix = interaction.fields.getTextInputValue("prefix").trim();
  if (!prefix || /\s/.test(prefix)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} البريفكس لا يمكن أن يكون فارغًا أو يحتوي مسافات.`, flags: 64 });
  }
  app.guildConfig.set(interaction.guild.id, "prefix", prefix);
  return safeReply(interaction, { content: `${app.config.emoji("success")} البريفكس الجديد: \`${prefix}\``, flags: 64 });
}

async function rolePick(interaction, app) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId("panel:roleset:staff.baseRoleId")
    .setPlaceholder("اختر رتبة الطاقم الأساسية");
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🎖️ رتبة الطاقم الأساسية",
      description: "كل من يحمل هذه الرتبة يُعتبر ضمن فريق الإدارة، ويُتابَع نشاطه ويصل إلى التذاكر تلقائيًا.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function roleSet(interaction, app, key) {
  const roleId = interaction.values[0];
  app.guildConfig.set(interaction.guild.id, key, roleId);
  const label = SETTING_ROLES.find((r) => r.key === key)?.label || key;
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ description: `${app.config.emoji("success")} تم ربط **${label}** بالرتبة <@&${roleId}>`, color: app.config.color("success") })],
    components: [backRow(app)]
  }));
}

// ---------------- تشغيل الأنظمة ----------------
async function togglesPanel(interaction, app) {
  const cfg = app.guildConfig.get(interaction.guild.id);
  const state = (key) => (key.split(".").reduce((a, k) => (a == null ? undefined : a[k]), cfg) ? "🟢" : "⚪");
  const embed = buildEmbed({
    title: "🔀 تشغيل وإيقاف الأنظمة",
    description: TOGGLES.map((t) => `${state(t.key)} **${t.label}**`).join("\n"),
    color: app.config.color("primary")
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:toggle")
    .setPlaceholder("اختر نظامًا لعكس حالته")
    .addOptions(TOGGLES.map((t) => ({ label: t.label, value: t.key })));
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [new ActionRowBuilder().addComponents(menu), backRow(app)] }));
}

async function toggleSet(interaction, app) {
  const key = interaction.values[0];
  const current = app.guildConfig.value(interaction.guild.id, key);
  app.guildConfig.set(interaction.guild.id, key, !current);
  return togglesPanel(interaction, app);
}

// ---------------- السلم الإداري ----------------
/**
 * لوحة الطاقم: شعار السيرفر + بطاقة العضو (نيك نيم ورتبته ونقاطه)
 * + السلم كاملًا + أزرار الإجراءات العليا (ترقية/تنزيل/سحب) للأدمن.
 */
async function staffPanel(interaction, app) {
  const guild = interaction.guild;
  const member = interaction.member;
  const ranks = app.staff.list(guild.id);
  const cfg = app.guildConfig.get(guild.id);
  const level = app.permissions.resolveLevel(member);

  // بطاقة العضو نفسه: نيك نيم ورتبته ونقاطه
  const myRank = app.staffService.currentRank(member);
  const weights = app.guildConfig.value(guild.id, "staff.points") || {};
  const myPoints = app.activity.points(guild.id, member.id, 30, weights);
  const nick = member.nickname || member.displayName || member.user?.username || "—";

  const ladder = ranks.length
    ? ranks
        .map((r) => {
          const mine = myRank && r.role_id === myRank.role_id;
          return `${mine ? "➤" : "\u3000"} \`${r.position}.\` **${r.name}** — <@&${r.role_id}>`;
        })
        .join("\n")
    : "لم يُضبط السلم الإداري بعد.\nاضغط **إضافة رتبة** بالأسفل وابدأ من الأدنى إلى الأعلى.";

  const embed = buildEmbed({
    title: `${app.config.emoji("staff")} ${app.i18n.t("panel.staff.title")}`,
    description: ladder,
    color: app.config.color("primary"),
    // شعار السيرفر
    thumbnail: guild.iconURL?.() || undefined,
    author: { name: guild.name, icon_url: guild.iconURL?.() || undefined },
    fields: [
      { name: "👤 الاسم", value: truncate(nick, 60), inline: true },
      { name: "🎖️ رتبتك", value: myRank ? `**${myRank.name}**` : "لست ضمن الطاقم", inline: true },
      { name: "⭐ نقاطك (30 يوم)", value: `**${myPoints.total}**`, inline: true },
      {
        name: "تفاصيل نقاطك",
        value:
          `رسائل \`${myPoints.breakdown.messages}\` • استلام \`${myPoints.breakdown.claims}\` • ` +
          `إغلاق \`${myPoints.breakdown.closes}\` • صوت \`${myPoints.breakdown.voice}\` • ` +
          `تقييم \`${myPoints.breakdown.ratings}\`` +
          (myPoints.raw.ratingCount ? `\n-# متوسط تقييمك: ${myPoints.raw.averageStars} من 5 (${myPoints.raw.ratingCount} تقييم)` : "")
      },
      { name: "رتبة الطاقم الأساسية", value: cfg.staff.baseRoleId ? `<@&${cfg.staff.baseRoleId}>` : "غير محددة", inline: true },
      { name: "عدد الرتب", value: `\`${ranks.length}\``, inline: true }
    ]
  });

  const rows = [
    new ActionRowBuilder().addComponents(
      btn("panel:staffpoints", "توب النقاط", "⭐", ButtonStyle.Primary),
      btn("panel:staffme", "ملفي بالتفصيل", "👤")
    )
  ];

  // الإجراءات العليا للأدمن فقط
  if (level >= Level.ADMIN) {
    rows.push(
      new ActionRowBuilder().addComponents(
        btn("panel:staffpromote", "ترقية", "⬆️", ButtonStyle.Success),
        btn("panel:staffdemote", "تنزيل", "⬇️", ButtonStyle.Secondary),
        btn("panel:staffdismiss", "سحب من الطاقم", "🚫", ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:staffadd", "إضافة رتبة", "➕", ButtonStyle.Success),
        btn("panel:staffdel", "حذف رتبة", "🗑️", ButtonStyle.Danger),
        btn("panel:staffbase", "رتبة الطاقم الأساسية", "🎖️")
      )
    );
  }
  rows.push(backRow(app));

  return safeUpdate(interaction, panelView({ embeds: [embed], components: rows }));
}

/** إضافة رتبة للسلم الإداري بلا أي أمر Slash. */
async function staffAddPick(interaction, app) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId("panel:staffaddset")
    .setPlaceholder("اختر الرتبة التي تريد إضافتها للسلم");

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "➕ إضافة رتبة للسلم الإداري",
      description: "الرتبة تُضاف في أعلى السلم الحالي. رتّبها من الأدنى إلى الأعلى.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function staffAddSet(interaction, app) {
  const roleId = interaction.values[0];
  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId);

  if (!role) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} الرتبة لم تعد موجودة.`, color: app.config.color("danger") })],
      components: [backRow(app)]
    }));
  }

  if (app.staff.getByRole(guild.id, roleId)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("warning")} <@&${roleId}> موجودة في السلم بالفعل.`, color: app.config.color("warning") })],
      components: [backRow(app)]
    }));
  }

  app.staff.add(guild.id, roleId, role.name);
  return staffPanel(interaction, app);
}

async function staffDelPick(interaction, app) {
  const ranks = app.staff.list(interaction.guild.id);
  if (!ranks.length) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} السلم فارغ أصلًا.`, flags: 64 });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:staffdelset")
    .setPlaceholder("اختر الرتبة التي تريد حذفها")
    .addOptions(
      ranks.slice(0, 25).map((r) => ({
        label: truncate(r.name, 80),
        description: `المركز ${r.position} • مستوى ${r.level}`,
        value: r.role_id
      }))
    );

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "🗑️ حذف رتبة من السلم", color: app.config.color("danger") })],
    components: [new ActionRowBuilder().addComponents(menu), backRow(app)]
  }));
}

async function staffDelSet(interaction, app) {
  app.staff.remove(interaction.guild.id, interaction.values[0]);
  return staffPanel(interaction, app);
}

async function staffBasePick(interaction, app) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId("panel:staffbaseset")
    .setPlaceholder("اختر رتبة الطاقم الأساسية");

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🎖️ رتبة الطاقم الأساسية",
      description: "من يحملها يُعتبر من الطاقم، وتُبنى عليها صلاحيات كثيرة في البوت.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function staffBaseSet(interaction, app) {
  app.guildConfig.set(interaction.guild.id, "staff.baseRoleId", interaction.values[0]);
  return staffPanel(interaction, app);
}

// ---------------- الإحصائيات ----------------
async function statsPanel(interaction, app) {
  const guild = interaction.guild;
  const tickets = app.tickets.stats(guild.id);
  const cases = app.cases.recent(guild.id, 1);
  const activeGiveaways = app.giveaways.listActive(guild.id).length;

  const embed = buildEmbed({
    title: `${app.config.emoji("stats")} إحصائيات ${guild.name}`,
    color: app.config.color("primary"),
    thumbnail: guild.iconURL() || undefined,
    fields: [
      { name: "الأعضاء", value: `\`${guild.memberCount}\``, inline: true },
      { name: "القنوات", value: `\`${guild.channels.cache.size}\``, inline: true },
      { name: "الرتب", value: `\`${guild.roles.cache.size}\``, inline: true },
      { name: "آخر رقم قضية", value: `\`${cases[0]?.case_number || 0}\``, inline: true },
      { name: "تذاكر مفتوحة", value: `\`${tickets.open}\``, inline: true },
      { name: "تذاكر مغلقة", value: `\`${tickets.closed}\``, inline: true },
      { name: "سحوبات نشطة", value: `\`${activeGiveaways}\``, inline: true },
      { name: "رتب السلم الإداري", value: `\`${app.staff.list(guild.id).length}\``, inline: true }
    ]
  });
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [backRow(app)] }));
}

// ---------------- المطور ----------------
async function devPanel(interaction, app) {
  const memory = process.memoryUsage();
  const stats = app.database.stats();
  const embed = buildEmbed({
    title: `${app.config.emoji("developer")} ${app.i18n.t("developer.statusTitle")}`,
    color: app.config.color("danger"),
    fields: [
      { name: "وقت التشغيل", value: formatDuration(process.uptime() * 1000), inline: true },
      { name: "الذاكرة", value: `\`${Math.round(memory.heapUsed / 1024 / 1024)} MB\``, inline: true },
      { name: "زمن الاستجابة", value: `\`${Math.round(app.client.ws?.ping ?? 0)} ms\``, inline: true },
      { name: "السيرفرات", value: `\`${app.client.guilds.cache.size}\``, inline: true },
      { name: "الأوامر", value: `\`${app.registry.commands.size}\``, inline: true },
      { name: "وضع الصيانة", value: app.maintenance ? "🔴 مفعّل" : "🟢 معطّل", inline: true },
      { name: "قاعدة البيانات", value: `\`${Math.round(stats.sizeBytes / 1024)} KB\` • \`${Object.keys(stats.tables).length}\` جدول` },
      { name: "الأخطاء", value: `الإجمالي: \`${app.errorRepo.count()}\` • آخر 24 ساعة: \`${app.errorRepo.countSince(Date.now() - 86400000)}\`` }
    ]
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(btn("dev:reload", "إعادة تحميل الأوامر", "🔄"), btn("dev:maintenance", "عكس وضع الصيانة", "🛠️", ButtonStyle.Danger)),
      backRow(app)
    ]
  }));
}

// ---------------- بناء الإمبيدات ----------------
async function builderPanel(interaction, app) {
  const embeds = app.embeds.list(interaction.guild.id);
  const commands = app.customCommands.list(interaction.guild.id);
  const types = app.ticketTypes.list(interaction.guild.id);
  const appTypes = app.applications.listTypes(interaction.guild.id);
  const guildPrefix = app.guildConfig.value(interaction.guild.id, "prefix");

  const embed = buildEmbed({
    title: "🎨 بناء الإمبيدات والأوامر",
    description:
      "أنشئ إمبيدات وأزرار وقوائم وأوامر خاصة بك، كلها من داخل ديسكورد بدون كود.\n\n" +
      "**الأوامر:**\n" +
      "`/embed create` — إمبيد جديد ويفتح المحرّر\n" +
      "`/embed edit` — تعديل إمبيد موجود\n" +
      "`/embed sync` — تطبيق تعديلاتك على الرسائل المنشورة\n" +
      "`/command create` — ربط أمر ببريفكس خاص بإمبيد\n" +
      "`/ticket-type create` — نوع تذكرة بكاتيغوري ونموذج أسئلة خاص\n" +
      "`/application create` — نوع تقديم بأزرار قبول ورفض\n" +
      "`/quiz add` — أسئلة اختبار التفعيل",
    color: app.config.color("primary"),
    fields: [
      {
        name: `الإمبيدات (${embeds.length})`,
        value: embeds.length ? embeds.slice(0, 15).map((e) => `\`${e.name}\``).join(" • ") : "—"
      },
      {
        name: `الأوامر المخصصة (${commands.length})`,
        value: commands.length
          ? commands.slice(0, 15).map((c) => `\`${c.prefix || guildPrefix}${c.name}\``).join(" • ")
          : "—"
      },
      {
        name: `أنواع التقديم (${appTypes.length})`,
        value: appTypes.length
          ? appTypes.slice(0, 15).map((t) => `\`apply:${t.name}\``).join(" • ")
          : "أنشئها بـ `/application create`"
      },
      {
        name: `أنواع التذاكر (${types.length})`,
        value: types.length
          ? types.slice(0, 15).map((t) => `\`ticket:${t.name}\``).join(" • ")
          : "أنشئها بـ `/ticket-type create` ثم اربطها بأزرار لوحاتك"
      }
    ]
  });
  const rows = [];
  if (embeds.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("panel:ebopen")
        .setPlaceholder("افتح إمبيدًا في المحرّر")
        .addOptions(embeds.slice(0, 25).map((x) => ({ label: truncate(x.name, 100), value: String(x.id) })))
    ));
  }
  rows.push(new ActionRowBuilder().addComponents(
    btn("panel:ebvars", "المتغيرات", "🔣"),
    btn("panel:ebtpls", "القوالب", "📂")
  ));
  rows.push(backRow(app));
  return safeUpdate(interaction, panelView({ embeds: [embed], components: rows }));
}

/**
 * يفتح محرّر الإمبيد الموجود (eb:) في رسالة مخفية جديدة.
 * المحرّر يعمل بالإمبيد التقليدي، ورسالة اللوحة تحمل علم v2 لا يُزال —
 * فلا نحوّل رسالة اللوحة إليه، بل نفتحه بجانبها.
 */
async function builderOpen(interaction, app) {
  const record = app.embeds.get(String(interaction.values?.[0] || ""));
  if (!record || record.guild_id !== interaction.guild.id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الإمبيد لم يعد موجودًا.`, flags: 64 });
  }
  const { editorView } = require("../builder/interactions");
  return safeReply(interaction, { ...editorView(app, record), flags: 64 });
}

async function builderVariables(interaction, app) {
  const variables = require("../../core/utils/variables");
  const embed = buildEmbed({
    title: "🔣 المتغيرات المتاحة",
    description: "تعمل في الإمبيدات والردود والأوامر المخصصة والترحيب والإعلانات.",
    color: app.config.color("primary"),
    fields: Object.entries(variables.VARIABLE_GROUPS).map(([group, names]) => ({
      name: group,
      value: truncate(names.map((n) => `\`{${n}}\``).join(" • "), 1024)
    }))
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn("panel:builder", "رجوع", "⬅️"), btn("panel:home", "الرئيسية", "🏠"), btn("panel:close", "إغلاق", "✖️"))]
  }));
}

async function builderTemplates(interaction, app) {
  const templates = app.embeds.listTemplates(interaction.guild.id);
  const embed = buildEmbed({
    title: `📂 قوالب الإمبيد (${templates.length})`,
    description: templates.length
      ? templates.slice(0, 30).map((t) => `• \`${t.name}\``).join("\n")
      : "ما فيه قوالب بعد. احفظ أي إمبيد كقالب من زر **💾 حفظ كقالب** داخل المحرّر.",
    color: app.config.color("primary"),
    footer: "لتطبيق قالب: افتح الإمبيد في المحرّر ← 📂 القوالب"
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn("panel:builder", "رجوع", "⬅️"), btn("panel:home", "الرئيسية", "🏠"), btn("panel:close", "إغلاق", "✖️"))]
  }));
}

// ---------------- الاقتصاد ----------------
async function economyPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const money = app.economy.totalMoney(guildId);
  const violations = app.violations.stats(guildId);
  const openFlights = app.flights.listOpen(guildId);
  const fmt = (n) => app.economyService.format(guildId, n);

  const state = (on) => (on ? "🟢 مفعّل" : "⚪ معطّل");

  const embed = buildEmbed({
    title: "🏦 الاقتصاد",
    description:
      "البنك هو الأساس، والمخالفات والطيران يخصمون منه مباشرة.\n" +
      "فعّل الأنظمة من **تشغيل الأنظمة**، واربط قنوات السجلات من **السجلات**.",
    color: app.config.color("primary"),
    fields: [
      { name: "البنك", value: state(cfg.economy?.enabled), inline: true },
      { name: "المخالفات", value: state(cfg.violations?.enabled), inline: true },
      { name: "الطيران", value: state(cfg.flights?.enabled), inline: true },
      { name: "الحسابات", value: `\`${money.accounts}\``, inline: true },
      { name: "إجمالي السيولة", value: fmt(money.total), inline: true },
      { name: "العملة", value: `${cfg.economy?.currency || "—"} ${cfg.economy?.symbol || ""}`, inline: true },
      { name: "مخالفات غير مسددة", value: `\`${violations.unpaid}\``, inline: true },
      { name: "المستحق على الأعضاء", value: fmt(violations.outstanding), inline: true },
      { name: "رحلات مفتوحة", value: `\`${openFlights.length}\``, inline: true },
      {
        name: "الأوامر",
        value: "`/bank` • `/bank-admin` • `/violation` • `/flight`\nلبناء لوحات بأزرار تشغّل هذي الأنظمة: راجع `ECONOMY.md`"
      }
    ]
  });
  return safeUpdate(interaction, panelView({ embeds: [embed], components: [backRow(app)] }));
}

// ============================================================
//  التذاكر
// ============================================================
async function ticketsPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const stats = app.tickets.stats(guildId);
  const ratings = app.tickets.guildRatingStats(guildId);
  const types = app.ticketTypes.list(guildId);

  const embed = buildEmbed({
    title: `${app.config.emoji("ticket")} التذاكر`,
    color: app.config.color("primary"),
    fields: [
      { name: "النظام", value: cfg.tickets.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "مفتوحة", value: `\`${stats.open}\``, inline: true },
      { name: "مغلقة", value: `\`${stats.closed}\``, inline: true },
      { name: "الكاتيغوري", value: cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : "غير محددة", inline: true },
      { name: "الأرشيف", value: cfg.tickets.transcriptChannelId ? `<#${cfg.tickets.transcriptChannelId}>` : "غير محددة", inline: true },
      { name: "التقييم", value: cfg.tickets.ratingEnabled ? `🟢 ${cfg.tickets.ratingChannelId ? `<#${cfg.tickets.ratingChannelId}>` : "بلا قناة"}` : "⚪ معطّل", inline: true },
      { name: "حد الاستلام", value: cfg.tickets.maxClaimsPerStaff ? `\`${cfg.tickets.maxClaimsPerStaff}\`` : "بلا حد", inline: true },
      {
        name: "الإغلاق التلقائي",
        value: cfg.tickets.autoCloseIdleHours
          ? `بعد ${formatDuration(cfg.tickets.autoCloseIdleHours * 3600000)} خمول`
          : "⚪ معطّل",
        inline: true
      },
      { name: "متوسط التقييم", value: ratings.count ? `⭐ \`${ratings.average.toFixed(2)}\` من \`${ratings.count}\`` : "لا يوجد", inline: true },
      { name: `أنواع التذاكر (${types.length})`, value: types.length ? types.slice(0, 10).map((t) => `\`${t.name}\``).join(" • ") : "استخدم `/نوع_تذكرة create`" }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:ticketpick:category", "الكاتيغوري", "📁"),
        btn("panel:ticketpick:archive", "قناة الأرشيف", "🗄️"),
        btn("panel:ticketpick:rating", "قناة التقييم", "⭐")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:ticketsetting:autoclose", "الإغلاق التلقائي", "⏳"),
        btn("panel:ticketsetting:limits", "حد الاستلام", "🚦"),
        btn(`panel:toggle:tickets.ratingEnabled`, cfg.tickets.ratingEnabled ? "إيقاف التقييم" : "تفعيل التقييم", "🔀")
      ),
      backRow(app)
    ]
  }));
}

async function ticketSettingModal(interaction, app, kind) {
  const cfg = app.guildConfig.value(interaction.guild.id, "tickets") || {};
  const modal = new ModalBuilder().setCustomId(`panel:ticketsettingsave:${kind}`).setTitle(kind === "autoclose" ? "الإغلاق التلقائي" : "حد الاستلام");

  if (kind === "autoclose") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("idle").setLabel("ساعات الخمول قبل التنبيه (0 = تعطيل)")
          .setStyle(TextInputStyle.Short).setValue(String(cfg.autoCloseIdleHours || 0)).setRequired(true).setMaxLength(4)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("grace").setLabel("ساعات المهلة بعد التنبيه")
          .setStyle(TextInputStyle.Short).setValue(String(cfg.autoCloseGraceHours || 12)).setRequired(true).setMaxLength(4)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("action").setLabel("الإجراء: lock أو delete")
          .setStyle(TextInputStyle.Short).setValue(cfg.autoCloseAction || "lock").setRequired(true).setMaxLength(10)
      )
    );
  } else {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("max").setLabel("أقصى تذاكر مستلمة لكل موظف (0 = بلا حد)")
          .setStyle(TextInputStyle.Short).setValue(String(cfg.maxClaimsPerStaff || 0)).setRequired(true).setMaxLength(3)
      )
    );
  }
  return safeModal(interaction, modal);
}

async function ticketSettingSave(interaction, app, kind) {
  const guildId = interaction.guild.id;
  if (kind === "autoclose") {
    const idle = parseInt(interaction.fields.getTextInputValue("idle"), 10) || 0;
    const grace = parseInt(interaction.fields.getTextInputValue("grace"), 10) || 12;
    const action = interaction.fields.getTextInputValue("action").trim() === "delete" ? "delete" : "lock";
    app.guildConfig.setMany(guildId, {
      "tickets.autoCloseIdleHours": idle, "tickets.autoCloseGraceHours": grace, "tickets.autoCloseAction": action
    });
  } else {
    const max = parseInt(interaction.fields.getTextInputValue("max"), 10) || 0;
    app.guildConfig.set(guildId, "tickets.maxClaimsPerStaff", max);
  }
  return safeUpdate(interaction, await ticketsPanelData(interaction, app));
}

async function ticketsPanelData(interaction, app) {
  // يعيد بناء نفس عرض ticketsPanel بلا استدعاء update داخلي مزدوج
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const stats = app.tickets.stats(guildId);
  const ratings = app.tickets.guildRatingStats(guildId);
  const types = app.ticketTypes.list(guildId);
  const embed = buildEmbed({
    title: `${app.config.emoji("ticket")} التذاكر`,
    color: app.config.color("primary"),
    fields: [
      { name: "النظام", value: cfg.tickets.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "مفتوحة", value: `\`${stats.open}\``, inline: true },
      { name: "مغلقة", value: `\`${stats.closed}\``, inline: true },
      { name: "الكاتيغوري", value: cfg.tickets.categoryId ? `<#${cfg.tickets.categoryId}>` : "غير محددة", inline: true },
      { name: "الأرشيف", value: cfg.tickets.transcriptChannelId ? `<#${cfg.tickets.transcriptChannelId}>` : "غير محددة", inline: true },
      { name: "التقييم", value: cfg.tickets.ratingEnabled ? `🟢 ${cfg.tickets.ratingChannelId ? `<#${cfg.tickets.ratingChannelId}>` : "بلا قناة"}` : "⚪ معطّل", inline: true },
      { name: "حد الاستلام", value: cfg.tickets.maxClaimsPerStaff ? `\`${cfg.tickets.maxClaimsPerStaff}\`` : "بلا حد", inline: true },
      { name: "الإغلاق التلقائي", value: cfg.tickets.autoCloseIdleHours ? `بعد ${formatDuration(cfg.tickets.autoCloseIdleHours * 3600000)} خمول` : "⚪ معطّل", inline: true },
      { name: "متوسط التقييم", value: ratings.count ? `⭐ \`${ratings.average.toFixed(2)}\` من \`${ratings.count}\`` : "لا يوجد", inline: true },
      { name: `أنواع التذاكر (${types.length})`, value: types.length ? types.slice(0, 10).map((t) => `\`${t.name}\``).join(" • ") : "استخدم `/نوع_تذكرة create`" }
    ]
  });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:ticketpick:category", "الكاتيغوري", "📁"),
        btn("panel:ticketpick:archive", "قناة الأرشيف", "🗄️"),
        btn("panel:ticketpick:rating", "قناة التقييم", "⭐")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:ticketsetting:autoclose", "الإغلاق التلقائي", "⏳"),
        btn("panel:ticketsetting:limits", "حد الاستلام", "🚦"),
        btn(`panel:toggle:tickets.ratingEnabled`, cfg.tickets.ratingEnabled ? "إيقاف التقييم" : "تفعيل التقييم", "🔀")
      ),
      backRow(app)
    ]
  };
}

const TICKET_CHANNEL_KEYS = {
  category: { key: "tickets.categoryId", label: "كاتيغوري التذاكر", type: ChannelType.GuildCategory },
  archive: { key: "tickets.transcriptChannelId", label: "قناة الأرشيف", type: ChannelType.GuildText },
  rating: { key: "tickets.ratingChannelId", label: "قناة التقييم", type: ChannelType.GuildText }
};

async function ticketChannelPick(interaction, app, kind) {
  const meta = TICKET_CHANNEL_KEYS[kind];
  // مفتاح غير معروف (زر قديم أو معرّف مشوّه) يرد برسالة بدل الانهيار
  if (!meta) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} إعداد غير معروف.`, flags: 64 });
  }
  const select = new ChannelSelectMenuBuilder().setCustomId(`panel:ticketset:${kind}`).setPlaceholder(`اختر: ${meta.label}`).setChannelTypes(meta.type);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: `🎫 ${meta.label}`, color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function ticketChannelSet(interaction, app, kind) {
  const meta = TICKET_CHANNEL_KEYS[kind];
  if (!meta) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} إعداد غير معروف.`, flags: 64 });
  }
  const id = interaction.values?.[0];
  if (!id) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر قناة.`, flags: 64 });
  }
  const channel = interaction.guild.channels.cache.get(id);
  const me = interaction.guild.members.me;
  if (channel?.isTextBased?.() && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${id}>.`, color: app.config.color("danger") })],
      components: [backRow(app)]
    }));
  }
  app.guildConfig.set(interaction.guild.id, meta.key, id);
  return safeUpdate(interaction, await ticketsPanelData(interaction, app));
}

// ============================================================
//  الإجازات والاستقالات والبلاغات
// ============================================================
async function lifecyclePanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const leaveStats = app.lifecycle.stats("leave", guildId);
  const resignStats = app.lifecycle.stats("resign", guildId);
  const reportStats = app.lifecycle.stats("report", guildId);

  const embed = buildEmbed({
    title: "🌴 الإجازات والاستقالات والبلاغات",
    color: app.config.color("primary"),
    fields: [
      { name: "🌴 الإجازات", value: `${cfg.leave.enabled ? "🟢" : "⚪"} • قناة: ${cfg.leave.requestChannelId ? `<#${cfg.leave.requestChannelId}>` : "—"}`, inline: true },
      { name: "📤 الاستقالات", value: `${cfg.resign.enabled ? "🟢" : "⚪"} • قناة: ${cfg.resign.requestChannelId ? `<#${cfg.resign.requestChannelId}>` : "—"}`, inline: true },
      { name: "🚨 البلاغات", value: `${cfg.reports.enabled ? "🟢" : "⚪"} • قناة: ${cfg.reports.channelId ? `<#${cfg.reports.channelId}>` : "—"}`, inline: true },
      { name: "معلّق (إجازات)", value: `\`${leaveStats.pending}\``, inline: true },
      { name: "معلّق (استقالات)", value: `\`${resignStats.pending}\``, inline: true },
      { name: "معلّق (بلاغات)", value: `\`${reportStats.pending}\``, inline: true }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:lifecycletoggle:leave", cfg.leave.enabled ? "إيقاف الإجازات" : "تفعيل الإجازات", "🌴"),
        btn("panel:lifecycletoggle:resign", cfg.resign.enabled ? "إيقاف الاستقالات" : "تفعيل الاستقالات", "📤"),
        btn("panel:lifecycletoggle:reports", cfg.reports.enabled ? "إيقاف البلاغات" : "تفعيل البلاغات", "🚨")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:lifecyclepick:leave", "قناة الإجازات", "📥"),
        btn("panel:lifecyclepick:resign", "قناة الاستقالات", "📥"),
        btn("panel:lifecyclepick:reports", "قناة البلاغات", "📥")
      ),
      backRow(app)
    ]
  }));
}

async function lifecycleToggle(interaction, app, kind) {
  const key = `${kind}.enabled`;
  const current = app.guildConfig.value(interaction.guild.id, key);
  app.guildConfig.set(interaction.guild.id, key, !current);
  return lifecyclePanel(interaction, app);
}

const LIFECYCLE_CHANNEL_KEYS = {
  leave: "leave.requestChannelId",
  resign: "resign.requestChannelId",
  reports: "reports.channelId"
};

async function lifecycleChannelPick(interaction, app, kind) {
  const select = new ChannelSelectMenuBuilder().setCustomId(`panel:lifecycleset:${kind}`).setPlaceholder("اختر القناة").setChannelTypes(ChannelType.GuildText);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "📥 اختر قناة الطلبات", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function lifecycleChannelSet(interaction, app, kind) {
  const id = interaction.values[0];
  app.guildConfig.set(interaction.guild.id, LIFECYCLE_CHANNEL_KEYS[kind], id);
  return lifecyclePanel(interaction, app);
}

// ============================================================
//  التقارير الدورية
// ============================================================
async function reportsPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const s = app.reports.getSchedule(guildId);

  const embed = buildEmbed({
    title: "📊 التقارير الدورية",
    color: s?.enabled ? app.config.color("success") : app.config.color("neutral"),
    fields: [
      { name: "الحالة", value: s?.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "القناة", value: s?.channel_id ? `<#${s.channel_id}>` : "غير محددة", inline: true },
      { name: "التكرار", value: s ? (s.frequency === "daily" ? "يومي" : "أسبوعي") : "—", inline: true },
      { name: "آخر إرسال", value: s?.last_run_at ? `<t:${Math.floor(s.last_run_at / 1000)}:R>` : "لم يُرسل بعد" }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:reporttoggle", s?.enabled ? "إيقاف التقارير" : "تفعيل التقارير", "🔀"),
        btn("panel:reportpick", "قناة التقارير", "📥")
      ),
      backRow(app)
    ]
  }));
}

async function reportsToggle(interaction, app) {
  const guildId = interaction.guild.id;
  const s = app.reports.getSchedule(guildId);
  app.reports.saveSchedule(guildId, { enabled: !(s?.enabled) });
  return reportsPanel(interaction, app);
}

async function reportsChannelPick(interaction, app) {
  const select = new ChannelSelectMenuBuilder().setCustomId("panel:reportset").setPlaceholder("اختر قناة التقارير").setChannelTypes(ChannelType.GuildText);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "📥 قناة التقارير الدورية", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function reportsChannelSet(interaction, app) {
  const id = interaction.values[0];
  app.reports.saveSchedule(interaction.guild.id, { channel_id: id });
  return reportsPanel(interaction, app);
}

// ============================================================
//  التفاعل والمحتوى (الردود التلقائية، رد التفاعلات، النجوم، المميّز)
// ============================================================
async function engagePanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const autoReplyCount = app.autoReplies.count(guildId);
  const reactionReplyCount = app.reactionReplies.count(guildId);
  const featuredCount = app.featured.count(guildId);

  const embed = buildEmbed({
    title: "🎉 التفاعل والمحتوى",
    description: "الردود والقوائم تُبنى بأسمائها من أوامرها المخصصة (`/رد_تلقائي` • `/رد_تفاعل`) لأن كل قاعدة لها اسم مستقل، لكن التبديل والقنوات هنا.",
    color: app.config.color("primary"),
    fields: [
      { name: "💬 الردود التلقائية", value: `\`${autoReplyCount}\` قاعدة`, inline: true },
      { name: "🎭 رد التفاعلات", value: `\`${reactionReplyCount}\` قاعدة`, inline: true },
      { name: "🌟 المميّز", value: `\`${featuredCount}\` منشور`, inline: true },
      { name: "⭐ لوحة النجوم", value: `${cfg.starboard.enabled ? "🟢" : "⚪"} • ${cfg.starboard.channelId ? `<#${cfg.starboard.channelId}>` : "بلا قناة"} • حد: \`${cfg.starboard.threshold}\``, inline: true },
      { name: "🌟 قناة المميّز", value: cfg.featured.channelId ? `<#${cfg.featured.channelId}>` : "غير محددة", inline: true }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:engagetoggle:starboard", cfg.starboard.enabled ? "إيقاف النجوم" : "تفعيل النجوم", "⭐")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:engagepick:starboard", "قناة النجوم", "📥"),
        btn("panel:engagepick:featured", "قناة المميّز", "📥")
      ),
      backRow(app)
    ]
  }));
}

async function engageToggle(interaction, app, kind) {
  if (kind === "starboard") {
    const current = app.guildConfig.value(interaction.guild.id, "starboard.enabled");
    app.guildConfig.set(interaction.guild.id, "starboard.enabled", !current);
  }
  return engagePanel(interaction, app);
}

const ENGAGE_CHANNEL_KEYS = { starboard: "starboard.channelId", featured: "featured.channelId" };

async function engageChannelPick(interaction, app, kind) {
  const select = new ChannelSelectMenuBuilder().setCustomId(`panel:engageset:${kind}`).setPlaceholder("اختر القناة").setChannelTypes(ChannelType.GuildText);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "📥 اختر القناة", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function engageChannelSet(interaction, app, kind) {
  const id = interaction.values[0];
  app.guildConfig.set(interaction.guild.id, ENGAGE_CHANNEL_KEYS[kind], id);
  return engagePanel(interaction, app);
}

// ============================================================
//  الدلائل
// ============================================================
async function evidencePanel(interaction, app) {
  const guildId = interaction.guild.id;
  const channelId = app.guildConfig.value(guildId, "logs.evidence");
  const embed = buildEmbed({
    title: "📁 توثيق العقوبات (الدلائل)",
    description: "سجّل الأدلة بأمر `/دليل add`. هنا تحدّد فقط قناة النشر.",
    color: app.config.color("primary"),
    fields: [{ name: "قناة الدلائل", value: channelId ? `<#${channelId}>` : "غير محددة" }]
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn("panel:evidencepick", "تحديد القناة", "📥")), backRow(app)]
  }));
}

async function evidenceChannelPick(interaction, app) {
  const select = new ChannelSelectMenuBuilder().setCustomId("panel:evidenceset").setPlaceholder("اختر قناة الدلائل").setChannelTypes(ChannelType.GuildText);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "📥 قناة الدلائل", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), backRow(app)]
  }));
}

async function evidenceChannelSet(interaction, app) {
  const id = interaction.values[0];
  app.guildConfig.set(interaction.guild.id, "logs.evidence", id);
  return evidencePanel(interaction, app);
}

// ============================================================
//  الحماية
// ============================================================
const SECURITY_RULES = [
  { key: "antiChannelCreate", label: "منع إنشاء القنوات الجماعي" },
  { key: "antiChannelDelete", label: "منع حذف القنوات الجماعي" },
  { key: "antiRoleCreate", label: "منع إنشاء الرتب الجماعي" },
  { key: "antiRoleDelete", label: "منع حذف الرتب الجماعي" },
  { key: "antiHighRoleGrant", label: "منع منح رتبة إدارية بغير صلاحية" },
  { key: "antiPermissionEscalation", label: "منع تصعيد صلاحيات الرتب" },
  { key: "antiBotAbuse", label: "مراقبة إساءة استخدام البوتات" }
];

async function securityPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.guildConfig.get(guildId);
  const embed = buildEmbed({
    title: "🔐 الحماية",
    color: cfg.security.enabled ? app.config.color("success") : app.config.color("neutral"),
    description: SECURITY_RULES.map((r) => {
      const rule = cfg.security.rules?.[r.key] || {};
      return `${rule.enabled ? "🟢" : "⚪"} **${r.label}**`;
    }).join("\n"),
    fields: [{ name: "قناة سجل الحماية", value: cfg.logs.security ? `<#${cfg.logs.security}>` : "غير محددة" }]
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(btn("panel:securitytoggle", cfg.security.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀")),
      new ActionRowBuilder().addComponents(btn("panel:securitypick", "تفعيل/تعطيل قاعدة", "⚙️")),
      backRow(app)
    ]
  }));
}

async function securityToggle(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "security.enabled");
  app.guildConfig.set(interaction.guild.id, "security.enabled", !current);
  return securityPanel(interaction, app);
}

async function securityRulePick(interaction, app) {
  const cfg = app.guildConfig.get(interaction.guild.id);
  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:securityset")
    .setPlaceholder("اختر قاعدة لعكس حالتها")
    .addOptions(SECURITY_RULES.map((r) => ({
      label: r.label,
      value: r.key,
      description: cfg.security.rules?.[r.key]?.enabled ? "مفعّلة حاليًا" : "معطّلة حاليًا"
    })));
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "⚙️ قواعد الحماية", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(menu), backRow(app)]
  }));
}

async function securityRuleSet(interaction, app) {
  const key = interaction.values[0];
  const path = `security.rules.${key}.enabled`;
  const current = app.guildConfig.value(interaction.guild.id, path);
  app.guildConfig.set(interaction.guild.id, path, !current);
  return securityPanel(interaction, app);
}

// ============================================================
//  مراقبة السيرفرات (للمطور)
// ============================================================
async function oversightPanel(interaction, app) {
  const t = app.oversight.totals();
  const embed = buildEmbed({
    title: "🛡️ مراقبة السيرفرات",
    color: app.config.color("danger"),
    fields: [
      { name: "متصل الآن", value: `\`${app.client.guilds.cache.size}\``, inline: true },
      { name: "نشط", value: `\`${t.active}\``, inline: true },
      { name: "محظور", value: `\`${t.blacklisted}\``, inline: true },
      { name: "إجمالي الأعضاء", value: `\`${t.members.toLocaleString("en-US")}\``, inline: true },
      { name: "أوامر نُفّذت", value: `\`${t.commands.toLocaleString("en-US")}\``, inline: true }
    ]
  });
  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(btn("panel:oversightpick", "إدارة سيرفر بآيديه", "🔎")), backRow(app)]
  }));
}

async function oversightGuildPick(interaction, app) {
  const modal = new ModalBuilder().setCustomId("panel:oversightset:lookup").setTitle("إدارة سيرفر");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("id").setLabel("آيدي السيرفر").setStyle(TextInputStyle.Short).setRequired(true)
    )
  );
  return safeModal(interaction, modal);
}

async function oversightGuildAction(interaction, app) {
  const id = interaction.fields.getTextInputValue("id").trim().match(/\d{15,25}/)?.[0];
  if (!id) return safeReply(interaction, { content: `${app.config.emoji("error")} آيدي غير صالح.`, flags: 64 });

  const record = app.oversight.get(id);
  const live = app.client.guilds.cache.get(id);
  if (!record && !live) return safeReply(interaction, { content: `${app.config.emoji("error")} ما لقيت سيرفرًا بهذا الآيدي.`, flags: 64 });

  const embed = buildEmbed({
    title: `🌐 ${live?.name || record?.name || "سيرفر"}`,
    color: app.config.color(record?.status === "blacklisted" ? "danger" : "primary"),
    fields: [
      { name: "الآيدي", value: `\`${id}\``, inline: true },
      { name: "الحالة", value: record?.status || "غير مسجّل", inline: true },
      { name: "الأعضاء", value: `\`${live?.memberCount ?? record?.member_count ?? 0}\``, inline: true }
    ]
  });

  return safeReply(interaction, {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn(`panel:oversightaction:leave-${id}`, "مغادرة", "🚪", ButtonStyle.Secondary),
        btn(`panel:oversightaction:blacklist-${id}`, "حظر ومغادرة", "🚫", ButtonStyle.Danger)
      )
    ],
    flags: 64
  });
}

async function oversightExecute(interaction, app, packed) {
  const [action, ...rest] = (packed || "").split("-");
  const guildId = rest.join("-");
  if (!["leave", "blacklist"].includes(action) || !/^\d{15,25}$/.test(guildId)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} طلب غير صالح.`, flags: 64 });
  }

  const guild = app.client.guilds.cache.get(guildId);
  const name = guild?.name || guildId;

  if (action === "blacklist") {
    app.oversight.blacklist(guildId, { reason: "حظر يدوي من لوحة التحكم", by: interaction.user.tag });
  }
  if (guild) await guild.leave().catch(() => {});

  return safeUpdate(interaction, panelView({
    embeds: [
      buildEmbed({
        description:
          `${app.config.emoji("success")} ${action === "blacklist" ? `تم حظر **${name}** ومغادرته.` : `تم مغادرة **${name}**.`}`,
        color: app.config.color("success")
      })
    ],
    components: []
  }));
}

// ============================================================
//  الفحص الشامل
// ============================================================
async function checkupPanel(interaction, app) {
  const { runChecks } = require("../checkup/commands/checkup");
  const { errors, warnings, ok } = runChecks(app, interaction.guild);

  const status = errors.length
    ? { icon: "🔴", text: "فيه مشاكل تمنع بعض الأنظمة من العمل", color: "danger" }
    : warnings.length
      ? { icon: "🟡", text: "يعمل، لكن فيه تحسينات مقترحة", color: "warning" }
      : { icon: "🟢", text: "كل شي سليم", color: "success" };

  const fields = [];
  if (errors.length) fields.push({ name: `🔴 أخطاء (${errors.length})`, value: truncate(errors.slice(0, 6).map((e) => `• ${e}`).join("\n"), 1024) });
  if (warnings.length) fields.push({ name: `🟡 تنبيهات (${warnings.length})`, value: truncate(warnings.slice(0, 6).map((w) => `• ${w}`).join("\n"), 1024) });
  if (ok.length) fields.push({ name: `🟢 سليم (${ok.length})`, value: truncate(ok.map((o) => `• ${o}`).join("\n"), 1024) });

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: `${status.icon} فحص السيرفر — ${status.text}`, color: app.config.color(status.color), fields })],
    components: [backRow(app)]
  }));
}

module.exports.ticketsPanel = ticketsPanel;
module.exports.lifecyclePanel = lifecyclePanel;
module.exports.reportsPanel = reportsPanel;
module.exports.engagePanel = engagePanel;
module.exports.evidencePanel = evidencePanel;
module.exports.securityPanel = securityPanel;
module.exports.oversightPanel = oversightPanel;
module.exports.checkupPanel = checkupPanel;

// ============================================================
//  أنظمة المدينة (RP): السجن، الكلبشة، الشخصيات، الممتلكات، الرتب
//  قاعدة المشروع: كل نظام جديد يُضاف، يُضاف معه تحكّمه هنا.
// ============================================================

async function rpPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.rpService.config(guildId);
  const jailed = app.rp.listJailed(guildId).length;
  const cuffed = app.rp.listCuffed(guildId).length;
  const items = app.rp.listItems(guildId).length;
  const jobs = app.rp.listJobs(guildId).length;
  const props = app.rp.listProperties(guildId).length;

  const embed = buildEmbed({
    title: "🏙️ أنظمة المدينة",
    description: cfg.enabled
      ? "كل أنظمة الحياة الواقعية من هنا."
      : "⚠️ النظام معطّل — فعّله من الزر بالأسفل.",
    color: app.config.color(cfg.enabled ? "primary" : "neutral"),
    fields: [
      { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "🔒 المسجونون", value: `\`${jailed}\``, inline: true },
      { name: "⛓️ المكلبشون", value: `\`${cuffed}\``, inline: true },
      { name: "📦 العناصر", value: `\`${items}\``, inline: true },
      { name: "💼 الوظائف", value: `\`${jobs}\``, inline: true },
      { name: "🔑 المعروضات", value: `\`${props}\``, inline: true },
      { name: "رتبة السجن", value: cfg.jailRoleId ? `<@&${cfg.jailRoleId}>` : "غير محددة", inline: true },
      { name: "رومات السجن", value: (cfg.jailVisibleChannels || []).length ? (cfg.jailVisibleChannels || []).map((c) => `<#${c}>`).join(" ") : "غير محددة", inline: false }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rpjail", "السجن", "🔒", ButtonStyle.Danger),
        btn("panel:rpcuffs", "الكلبشة", "⛓️"),
        btn("panel:rpranks", "الرتب العسكرية", "🎖️")
      ),
      new ActionRowBuilder().addComponents(
        btn(`panel:rptoggle:enabled`, cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀", cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        btn(`panel:rptoggle:wanted`, cfg.wantedOnRobbery ? "إيقاف: مطلوب بعد السرقة" : "تفعيل: مطلوب بعد السرقة", "🚔"),
        btn("panel:rpimages", "صور اللوحات", "🖼️")
      ),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️")),
    ]
  }));
}

async function rpJailPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.rpService.config(guildId);
  const jailed = app.rp.listJailed(guildId);

  const embed = buildEmbed({
    title: "🔒 نظام السجن",
    description: jailed.length
      ? jailed.map((r) => `<@${r.user_id}> — ينتهي ${timestamp(r.ends_at, "R")}${r.reason ? `\n  ${truncate(r.reason, 60)}` : ""}`).join("\n")
      : "ما فيه مسجونون حاليًا. 🕊️",
    color: app.config.color(jailed.length ? "danger" : "success"),
    fields: [
      { name: "رتبة السجن", value: cfg.jailRoleId ? `<@&${cfg.jailRoleId}>` : "⚠️ غير محددة", inline: true },
      {
        name: "الرومات الظاهرة للمسجون",
        value: (cfg.jailVisibleChannels || []).length
          ? (cfg.jailVisibleChannels || []).map((c) => `<#${c}>`).join(" ")
          : "⚠️ غير محددة — كل الرومات ستختفي"
      },
      { name: "الإعداد", value: "حدّد الرتبة والرومات ثم اضغط **تهيئة الصلاحيات** لتطبيقها على كل قنوات السيرفر." }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rpjailrole", "رتبة السجن", "🎭"),
        btn("panel:rpjailrooms", "رومات السجن", "📺"),
        btn("panel:rpjailsetup", "تهيئة الصلاحيات", "⚙️", ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:rpunjail", "فك سجن عضو", "🔓", ButtonStyle.Success),
        btn("panel:rpamnesty", "عفو عام", "🕊️", ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(btn("panel:rp", "رجوع", "⬅️")),
    ]
  }));
}

async function rpJailRolePick(interaction, app) {
  const select = new RoleSelectMenuBuilder()
    .setCustomId("panel:rpjailroleset")
    .setPlaceholder("اختر رتبة السجن");

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🎭 رتبة السجن",
      description: "الرتبة التي تُمنح للمسجون. لازم تكون **تحت رتبة البوت** ليقدر يمنحها.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpJailRoleSet(interaction, app) {
  const roleId = interaction.values[0];
  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId);
  const me = guild.members.me;

  if (role && (role.managed || role.position >= me.roles.highest.position)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} لا أستطيع إدارة <@&${roleId}> — ارفع رتبة البوت فوقها.`,
        color: app.config.color("danger")
      })],
      components: [new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
    }));
  }

  app.guildConfig.set(guild.id, "rp.jailRoleId", roleId);
  return rpJailPanel(interaction, app);
}

async function rpJailRoomsPick(interaction, app) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId("panel:rpjailroomsset")
    .setPlaceholder("اختر الرومات التي تبقى ظاهرة للمسجون")
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory)
    .setMinValues(1)
    .setMaxValues(10);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "📺 رومات السجن",
      description:
        "اختر الرومات التي **تبقى ظاهرة** للمسجون — وكل ما عداها يختفي.\n\n" +
        "لو اخترت كاتيغوري، كل قنواتها تبقى ظاهرة.\n" +
        "بعد الاختيار اضغط **تهيئة الصلاحيات** لتطبيق التغيير.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpJailRoomsSet(interaction, app) {
  app.guildConfig.set(interaction.guild.id, "rp.jailVisibleChannels", interaction.values);
  return rpJailPanel(interaction, app);
}

async function rpJailSetup(interaction, app) {
  // العملية تمس كل قنوات السيرفر فقد تتجاوز مهلة ديسكورد — نؤجّل الرد
  await ackComponent(interaction);

  const result = await app.rpService.setupJailPermissions(interaction.guild);
  if (!result.ok) {
    const messages = {
      noRole: "حدّد رتبة السجن أولًا.",
      roleMissing: "رتبة السجن محذوفة — اخترها من جديد.",
      missingPermission: "البوت يفتقد صلاحية **إدارة القنوات**."
    };
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} ${messages[result.reason] || "تعذّرت التهيئة."}`,
        color: app.config.color("danger")
      })],
      components: [new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
    }));
  }

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "⚙️ اكتملت تهيئة السجن",
      description:
        `🚫 أُخفيت **${result.hidden}** قناة عن المسجون\n` +
        `✅ بقيت **${result.shown}** قناة ظاهرة\n` +
        (result.failed ? `⚠️ تعذّر ضبط **${result.failed}** قناة (تحقق من صلاحيات البوت فيها)\n` : "") +
        "\nالآن أي عضو تسجنه تختفي عنه كل الرومات ما عدا المحددة.",
      color: app.config.color(result.failed ? "warning" : "success")
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpUnjailPick(interaction, app) {
  const jailed = app.rp.listJailed(interaction.guild.id);
  if (!jailed.length) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ما فيه مسجونون.`, flags: 64 });
  }

  const menu = new StringSelectMenuBuilder()
    .setCustomId("panel:rpunjailset")
    .setPlaceholder("اختر السجين لفك سجنه")
    .addOptions(
      jailed.slice(0, 25).map((r) => ({
        label: truncate(r.user_id, 100),
        description: truncate(r.reason || "بلا سبب", 90),
        value: r.user_id
      }))
    );

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "🔓 فك سجن", description: "اختر السجين. ستُستعاد رتبه المحفوظة تلقائيًا.", color: app.config.color("success") })],
    components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpUnjailSet(interaction, app) {
  const userId = interaction.values[0];
  const record = app.rp.activeJail(interaction.guild.id, userId);
  if (!record) return rpJailPanel(interaction, app);

  await ackComponent(interaction);
  await app.rpService.releaseJail(interaction.guild, record, interaction.user.id);

  const jailed = app.rp.listJailed(interaction.guild.id);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🔓 تم فك السجن",
      description: `أُفرج عن <@${userId}> واستُعيدت رتبه.\n\nالمسجونون المتبقون: **${jailed.length}**`,
      color: app.config.color("success")
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpAmnestyConfirm(interaction, app) {
  const count = app.rp.listJailed(interaction.guild.id).length;
  if (!count) return safeReply(interaction, { content: `${app.config.emoji("warning")} ما فيه مسجونون.`, flags: 64 });

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🕊️ تأكيد العفو العام",
      description: `سيُفرج عن **${count}** سجين دفعة واحدة، وتُستعاد رتب كل واحد منهم.\n\n**هذا الإجراء لا يمكن التراجع عنه.**`,
      color: app.config.color("danger")
    })],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rpamnestygo", `نعم، أفرج عن ${count}`, "🕊️", ButtonStyle.Danger),
        btn("panel:rpjail", "إلغاء", "✖️")
      )
    ]
  }));
}

async function rpAmnestyGo(interaction, app) {
  await ackComponent(interaction);
  const result = await app.rpService.amnesty(interaction.guild, interaction.user.id);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🕊️ صدر العفو العام",
      description:
        `أُفرج عن **${result.released}** من أصل **${result.total}**.` +
        (result.failed ? `\n⚠️ تعذّر الإفراج عن **${result.failed}** (غالبًا غادروا السيرفر).` : ""),
      color: app.config.color(result.failed ? "warning" : "success")
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:rpjail", "رجوع", "⬅️"))]
  }));
}

async function rpCuffsPanel(interaction, app) {
  const cuffed = app.rp.listCuffed(interaction.guild.id);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "⛓️ الكلبشة",
      description: cuffed.length
        ? cuffed.map((r) => `<@${r.user_id}> — بواسطة <@${r.officer_id}> ${timestamp(r.created_at, "R")}`).join("\n")
        : "ما فيه مكلبشون حاليًا.",
      color: app.config.color(cuffed.length ? "warning" : "success"),
      fields: [{ name: "ملاحظة", value: "الكلبشة تُجمّد أوامر المدينة بلا سحب رتب. للكلبشة استخدم `/كلبشة`." }]
    })],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rpuncuffall", "فك كل الكلبشات", "🔓", ButtonStyle.Danger).setDisabled(!cuffed.length)
      ),
      new ActionRowBuilder().addComponents(btn("panel:rp", "رجوع", "⬅️"))
    ]
  }));
}

async function rpUncuffAll(interaction, app) {
  const count = app.rp.uncuffAll(interaction.guild.id, interaction.user.id);
  await app.rpService.log(interaction.guild.id, "rpJail", buildEmbed({
    title: "🔓 فك كلبشات جماعي",
    description: `فُكّت **${count}** كلبشة بأمر <@${interaction.user.id}>.`,
    color: app.config.color("success")
  }));
  return rpCuffsPanel(interaction, app);
}

async function rpRanksPanel(interaction, app) {
  const ranks = app.military.listRanks(interaction.guild.id);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🎖️ سلّم الرتب العسكرية",
      description: ranks.length
        ? ranks.map((r) => `**${r.points}** نقطة → <@&${r.role_id}> (${r.label})`).join("\n")
        : "لم يُضبط السلّم بعد.",
      color: app.config.color("primary"),
      fields: [{
        name: "الإدارة",
        value: "`/عسكرية رتبة-اضافة` لإضافة رتبة\n`/عسكرية رتبة-حذف` لحذفها\nوالعسكري يستلم ترقيته بـ `/عسكرية ترقية`"
      }]
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:rp", "رجوع", "⬅️"))]
  }));
}

async function rpToggle(interaction, app, which) {
  const guildId = interaction.guild.id;
  const key = which === "wanted" ? "rp.wantedOnRobbery" : "rp.enabled";
  const current = app.guildConfig.value(guildId, key);
  app.guildConfig.set(guildId, key, !current);
  return rpPanel(interaction, app);
}

/** صور خلفية لوحتي الوظائف والسوق السوداء — مواصفة كصورة كاملة تحيط الحاوية لا فقط أيقونة صغيرة. */
async function rpImagesModal(interaction, app) {
  const cfg = app.rpService.config(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId("panel:rpimagessave").setTitle("صور لوحات المدينة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("jobs").setLabel("صورة لوحة الوظائف (رابط، فارغ للإلغاء)")
        .setStyle(TextInputStyle.Short).setValue(cfg.jobsImageUrl || "").setRequired(false).setMaxLength(300)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("market").setLabel("صورة السوق السوداء (رابط، فارغ للإلغاء)")
        .setStyle(TextInputStyle.Short).setValue(cfg.blackMarketImageUrl || "").setRequired(false).setMaxLength(300)
    )
  );
  return safeModal(interaction, modal);
}

async function rpImagesSave(interaction, app) {
  const jobs = interaction.fields.getTextInputValue("jobs").trim();
  const market = interaction.fields.getTextInputValue("market").trim();

  for (const [val, label] of [[jobs, "صورة الوظائف"], [market, "صورة السوق"]]) {
    if (val && !/^https:\/\/\S+$/i.test(val)) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} رابط ${label} لازم يبدأ بـ https://`, flags: 64 });
    }
  }

  app.guildConfig.setMany(interaction.guild.id, {
    "rp.jobsImageUrl": jobs || null,
    "rp.blackMarketImageUrl": market || null
  });

  return safeUpdate(interaction, await rpPanelData(interaction, app));
}

/** يعيد بناء شاشة المدينة بلا استدعاء update مزدوج — لاستخدامها بعد حفظ مودال. */
async function rpPanelData(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.rpService.config(guildId);
  const jailed = app.rp.listJailed(guildId).length;
  const cuffed = app.rp.listCuffed(guildId).length;
  const items = app.rp.listItems(guildId).length;
  const jobs = app.rp.listJobs(guildId).length;
  const props = app.rp.listProperties(guildId).length;

  const embed = buildEmbed({
    title: "🏙️ أنظمة المدينة",
    description: cfg.enabled ? "كل أنظمة الحياة الواقعية من هنا." : "⚠️ النظام معطّل — فعّله من الزر بالأسفل.",
    color: app.config.color(cfg.enabled ? "primary" : "neutral"),
    fields: [
      { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "🔒 المسجونون", value: `\`${jailed}\``, inline: true },
      { name: "⛓️ المكلبشون", value: `\`${cuffed}\``, inline: true },
      { name: "📦 العناصر", value: `\`${items}\``, inline: true },
      { name: "💼 الوظائف", value: `\`${jobs}\``, inline: true },
      { name: "🔑 المعروضات", value: `\`${props}\``, inline: true },
      { name: "رتبة السجن", value: cfg.jailRoleId ? `<@&${cfg.jailRoleId}>` : "غير محددة", inline: true },
      { name: "رومات السجن", value: (cfg.jailVisibleChannels || []).length ? (cfg.jailVisibleChannels || []).map((c) => `<#${c}>`).join(" ") : "غير محددة", inline: false }
    ]
  });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rpjail", "السجن", "🔒", ButtonStyle.Danger),
        btn("panel:rpcuffs", "الكلبشة", "⛓️"),
        btn("panel:rpranks", "الرتب العسكرية", "🎖️")
      ),
      new ActionRowBuilder().addComponents(
        btn(`panel:rptoggle:enabled`, cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀", cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        btn(`panel:rptoggle:wanted`, cfg.wantedOnRobbery ? "إيقاف: مطلوب بعد السرقة" : "تفعيل: مطلوب بعد السرقة", "🚔"),
        btn("panel:rpimages", "صور اللوحات", "🖼️")
      ),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️")),
    ]
  };
}


// ============================================================
//  مركز الأنظمة المدنية: مدخل موحّد للمدينة والهوية والحكومة
//  (تلافيًا لحد ديسكورد: 5 أزرار لكل صف، 5 صفوف لكل رسالة)
// ============================================================

async function civilHub(interaction, app) {
  const level = app.permissions.resolveLevel(interaction.member);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🏙️ الأنظمة المدنية",
      description: "المدينة والسجن، الهوية الوطنية، والحكومة — من هنا.",
      color: app.config.color("primary")
    })],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:rp", "المدينة والسجن", "🏙️"),
        ...(level >= Level.ADMIN ? [btn("panel:idn", "الهوية الوطنية", "🪪"), btn("panel:gov", "الحكومة", "🏛️")] : []),
        btn("panel:quests", "مهام الإدارة", "🎯")
      ),
      backRow(app)
    ]
  }));
}

// ============================================================
//  الهوية الوطنية
// ============================================================

async function idnPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.identityService.config(guildId);
  const stats = app.identities.stats(guildId);
  const canManage = app.identityService.canRenderImage(guildId);

  const embed = buildEmbed({
    title: "🪪 الهوية الوطنية",
    color: app.config.color(cfg.enabled ? "primary" : "neutral"),
    fields: [
      { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "معلّقة", value: `\`${stats.pending}\``, inline: true },
      { name: "معتمدة", value: `\`${stats.approved}\``, inline: true },
      { name: "قناة المراجعة", value: cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : "غير محددة", inline: true },
      { name: "رتبة المواطن", value: cfg.citizenRoleId ? `<@&${cfg.citizenRoleId}>` : "غير محددة", inline: true },
      { name: "مدة الصلاحية", value: cfg.validityDays ? `\`${cfg.validityDays}\` يوم` : "دائمة", inline: true },
      { name: "بطاقة القالب", value: canManage ? "🖼️ صورة مرسومة" : "📋 بطاقة منسّقة (بلا قالب أو مكتبة رسم)" }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:idnreview", "قناة المراجعة", "📥"),
        btn("panel:idnrole", "رتبة المواطن", "🎭"),
        btn("panel:idnvalidity", "مدة الصلاحية", "⏳")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:idntemplate", "قالب البطاقة", "🖼️"),
        btn("panel:idnpending", "الطلبات المعلّقة", "📋"),
        btn(`panel:idntoggle`, cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀", cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️")),
    ]
  }));
}

async function idnReviewPick(interaction, app) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId("panel:idnreviewset")
    .setPlaceholder("اختر قناة مراجعة طلبات الهوية")
    .setChannelTypes(ChannelType.GuildText);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "📥 قناة المراجعة", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:idn", "رجوع", "⬅️"))]
  }));
}

async function idnReviewSet(interaction, app) {
  const channelId = interaction.values[0];
  const channel = interaction.guild.channels.cache.get(channelId);
  const me = interaction.guild.members.me;
  if (channel?.isTextBased?.() && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>.`, color: app.config.color("danger") })],
      components: [btnRow(btn("panel:idn", "رجوع", "⬅️"))]
    }));
  }
  app.guildConfig.set(interaction.guild.id, "identity.reviewChannelId", channelId);
  return idnPanel(interaction, app);
}

async function idnRolePick(interaction, app) {
  const select = new RoleSelectMenuBuilder().setCustomId("panel:idnroleset").setPlaceholder("اختر رتبة المواطن");
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: "🎭 رتبة المواطن", description: "تُمنح تلقائيًا عند قبول الهوية.", color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:idn", "رجوع", "⬅️"))]
  }));
}

async function idnRoleSet(interaction, app) {
  const roleId = interaction.values[0];
  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId);
  const me = guild.members.me;
  if (role && (role.managed || role.position >= me.roles.highest.position)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أستطيع إدارة <@&${roleId}> — ارفع رتبة البوت فوقها.`, color: app.config.color("danger") })],
      components: [btnRow(btn("panel:idn", "رجوع", "⬅️"))]
    }));
  }
  app.guildConfig.set(guild.id, "identity.citizenRoleId", roleId);
  return idnPanel(interaction, app);
}

async function idnValidityModal(interaction, app) {
  const cfg = app.identityService.config(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId("panel:idnvaliditysave").setTitle("مدة صلاحية البطاقة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("days").setLabel("عدد الأيام (0 = دائمة)")
        .setStyle(TextInputStyle.Short).setValue(String(cfg.validityDays || 0)).setRequired(true).setMaxLength(5)
    )
  );
  return safeModal(interaction, modal);
}

async function idnValiditySave(interaction, app) {
  const raw = parseInt(interaction.fields.getTextInputValue("days"), 10);
  const days = isNaN(raw) || raw < 0 ? 0 : raw;
  app.guildConfig.set(interaction.guild.id, "identity.validityDays", days);
  return safeUpdate(interaction, await idnPanelData(interaction, app));
}

async function idnTemplateModal(interaction, app) {
  const cfg = app.identityService.config(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId("panel:idntemplatesave").setTitle("قالب بطاقة الهوية");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url").setLabel("رابط صورة القالب (https) — فارغ للإلغاء")
        .setStyle(TextInputStyle.Short).setValue(cfg.templateUrl || "").setRequired(false).setMaxLength(300)
    )
  );
  return safeModal(interaction, modal);
}

async function idnTemplateSave(interaction, app) {
  const raw = interaction.fields.getTextInputValue("url").trim();
  if (raw && !/^https:\/\/\S+$/i.test(raw)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} الرابط لازم يبدأ بـ https://`, flags: 64 });
  }
  app.guildConfig.set(interaction.guild.id, "identity.templateUrl", raw || null);
  return safeUpdate(interaction, await idnPanelData(interaction, app));
}

async function idnToggle(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "identity.enabled");
  app.guildConfig.set(interaction.guild.id, "identity.enabled", !current);
  return idnPanel(interaction, app);
}

async function idnPending(interaction, app) {
  const rows = app.identities.listPending(interaction.guild.id);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "📋 طلبات الهوية المعلّقة",
      description: rows.length
        ? rows.map((r) => `\`#${String(r.card_number).padStart(6, "0")}\` ${r.full_name} — <@${r.user_id}> • ${timestamp(r.created_at, "R")}`).join("\n")
        : "ما فيه طلبات معلّقة. 🎉",
      color: app.config.color(rows.length ? "warning" : "success"),
      footer: "استخدم الأزرار على رسالة الطلب نفسها في قناة المراجعة للقبول أو الرفض."
    })],
    components: [btnRow(btn("panel:idn", "رجوع", "⬅️"))]
  }));
}

/** يعيد بناء شاشة الهوية بلا استدعاء update مزدوج — تُستخدم بعد حفظ مودال. */
async function idnPanelData(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.identityService.config(guildId);
  const stats = app.identities.stats(guildId);
  const canManage = app.identityService.canRenderImage(guildId);

  const embed = buildEmbed({
    title: "🪪 الهوية الوطنية",
    color: app.config.color(cfg.enabled ? "primary" : "neutral"),
    fields: [
      { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "معلّقة", value: `\`${stats.pending}\``, inline: true },
      { name: "معتمدة", value: `\`${stats.approved}\``, inline: true },
      { name: "قناة المراجعة", value: cfg.reviewChannelId ? `<#${cfg.reviewChannelId}>` : "غير محددة", inline: true },
      { name: "رتبة المواطن", value: cfg.citizenRoleId ? `<@&${cfg.citizenRoleId}>` : "غير محددة", inline: true },
      { name: "مدة الصلاحية", value: cfg.validityDays ? `\`${cfg.validityDays}\` يوم` : "دائمة", inline: true },
      { name: "بطاقة القالب", value: canManage ? "🖼️ صورة مرسومة" : "📋 بطاقة منسّقة (بلا قالب أو مكتبة رسم)" }
    ]
  });

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:idnreview", "قناة المراجعة", "📥"),
        btn("panel:idnrole", "رتبة المواطن", "🎭"),
        btn("panel:idnvalidity", "مدة الصلاحية", "⏳")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:idntemplate", "قالب البطاقة", "🖼️"),
        btn("panel:idnpending", "الطلبات المعلّقة", "📋"),
        btn(`panel:idntoggle`, cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀", cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️")),
    ]
  };
}

// ============================================================
//  الحكومة: مجلس الشورى، التعاميم، التقاعد
// ============================================================

const GOV_CHANNEL_KEYS = {
  council: { key: "government.councilChannelId", label: "قناة مجلس الشورى" },
  circulars: { key: "government.circularsChannelId", label: "قناة التعاميم" },
  retirements: { key: "government.retirementsChannelId", label: "قناة قرارات التقاعد" }
};
const GOV_ROLE_KEYS = {
  council: { key: "government.councilRoleId", label: "رتبة أعضاء المجلس" },
  retired: { key: "government.retiredRoleId", label: "رتبة المتقاعد" }
};

async function govPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.governmentService.config(guildId);
  const projects = app.government.listProjects(guildId, { limit: 100 });
  const openProjects = projects.filter((p) => p.status === "open").length;

  const embed = buildEmbed({
    title: "🏛️ الحكومة",
    color: app.config.color(cfg.enabled ? "primary" : "neutral"),
    fields: [
      { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
      { name: "مشاريع مفتوحة", value: `\`${openProjects}\``, inline: true },
      { name: "التعاميم", value: `\`${app.government.listCirculars(guildId).length}\``, inline: true },
      { name: "قناة المجلس", value: cfg.councilChannelId ? `<#${cfg.councilChannelId}>` : "—", inline: true },
      { name: "قناة التعاميم", value: cfg.circularsChannelId ? `<#${cfg.circularsChannelId}>` : "—", inline: true },
      { name: "قناة التقاعد", value: cfg.retirementsChannelId ? `<#${cfg.retirementsChannelId}>` : "—", inline: true },
      { name: "رتبة المجلس", value: cfg.councilRoleId ? `<@&${cfg.councilRoleId}>` : "الجميع", inline: true },
      { name: "رتبة المتقاعد", value: cfg.retiredRoleId ? `<@&${cfg.retiredRoleId}>` : "—", inline: true }
    ]
  });

  return safeUpdate(interaction, panelView({
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        btn("panel:govcouncil", "قناة المجلس", "🏛️"),
        btn("panel:govcirculars", "قناة التعاميم", "📢"),
        btn("panel:govretirements", "قناة التقاعد", "🎗️")
      ),
      new ActionRowBuilder().addComponents(
        btn("panel:govcouncilrole", "رتبة المجلس", "🎭"),
        btn("panel:govretiredrole", "رتبة المتقاعد", "🎖️"),
        btn("panel:govtoggle", cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀", cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
      ),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️")),
    ]
  }));
}

async function govChannelPick(interaction, app, which) {
  const meta = GOV_CHANNEL_KEYS[which];
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(`panel:gov${which}set`)
    .setPlaceholder(`اختر: ${meta.label}`)
    .setChannelTypes(ChannelType.GuildText);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: `🏛️ ${meta.label}`, color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:gov", "رجوع", "⬅️"))]
  }));
}

async function govChannelSet(interaction, app, which) {
  const meta = GOV_CHANNEL_KEYS[which];
  const channelId = interaction.values[0];
  const channel = interaction.guild.channels.cache.get(channelId);
  const me = interaction.guild.members.me;
  if (channel?.isTextBased?.() && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>.`, color: app.config.color("danger") })],
      components: [btnRow(btn("panel:gov", "رجوع", "⬅️"))]
    }));
  }
  app.guildConfig.set(interaction.guild.id, meta.key, channelId);
  return govPanel(interaction, app);
}

async function govRolePick(interaction, app, which) {
  const meta = GOV_ROLE_KEYS[which];
  const select = new RoleSelectMenuBuilder().setCustomId(`panel:gov${which}roleset`).setPlaceholder(`اختر: ${meta.label}`);
  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({ title: `🎭 ${meta.label}`, color: app.config.color("primary") })],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(btn("panel:gov", "رجوع", "⬅️"))]
  }));
}

async function govRoleSet(interaction, app, which) {
  const meta = GOV_ROLE_KEYS[which];
  const roleId = interaction.values[0];
  const guild = interaction.guild;
  const role = guild.roles.cache.get(roleId);
  const me = guild.members.me;
  if (which === "retired" && role && (role.managed || role.position >= me.roles.highest.position)) {
    return safeUpdate(interaction, panelView({
      embeds: [buildEmbed({ description: `${app.config.emoji("error")} لا أستطيع إدارة <@&${roleId}> — ارفع رتبة البوت فوقها.`, color: app.config.color("danger") })],
      components: [btnRow(btn("panel:gov", "رجوع", "⬅️"))]
    }));
  }
  app.guildConfig.set(guild.id, meta.key, roleId);
  return govPanel(interaction, app);
}

async function govToggle(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "government.enabled");
  app.guildConfig.set(interaction.guild.id, "government.enabled", !current);
  return govPanel(interaction, app);
}

/** صف زر واحد — اختصار محلي لشاشات الخطأ القصيرة في هذا القسم. */
function btnRow(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

/**
 * مركز المساعدة داخل اللوحة.
 * كان هذا القسم يرد بنص يطلب كتابة `/مساعدة` — وهو طريق مسدود يناقض
 * فكرة اللوحة نفسها، فصار يعرض الأوامر مجمّعة حسب القسم ومفلترة بصلاحية العضو.
 */
async function helpPanel(interaction, app) {
  const level = app.permissions.resolveLevel(interaction.member);

  const LABELS = {
    tickets: "🎫 التذاكر", economy: "🏦 الاقتصاد", moderation: "🛡️ الإدارة",
    staff: "👥 الطاقم", security: "🔐 الحماية", builder: "🎨 البناء",
    rp: "🏙️ المدينة", identity: "🪪 الهوية", government: "🏛️ الحكومة",
    military: "🎖️ العسكرية", elections: "🗳️ الانتخابات", social: "🐦 الاجتماعي",
    applications: "📋 التقديمات", oversight: "📡 المراقبة",
    developer: "🧰 المطور", general: "⚙️ عام"
  };

  // نعرض ما يملك العضو صلاحيته فقط — قائمة أوامر لا يقدر يستخدمها مضلّلة
  const groups = new Map();
  for (const [name, cmd] of app.registry.commands) {
    const need = cmd.permissions?.level ?? 0;
    if (level < need) continue;
    const cat = cmd.category || "general";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(name);
  }

  const fields = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)
    .map(([cat, names]) => ({
      name: `${LABELS[cat] || cat} (${names.length})`,
      value: truncate(names.sort().map((n) => `\`/${n}\``).join(" • "), 1000)
    }));

  const total = [...groups.values()].reduce((s, a) => s + a.length, 0);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: `${app.config.emoji("help")} مركز المساعدة`,
      description:
        `الأوامر المتاحة لك: **${total}**\n` +
        "لتفاصيل أمر معيّن: `/مساعدة command:<الاسم>`",
      color: app.config.color("primary"),
      fields: fields.length ? fields : [{ name: "—", value: "لا أوامر متاحة لمستواك." }]
    })],
    components: [backRow(app)]
  }));
}

/**
 * صدارة نقاط الطاقم داخل اللوحة.
 * النقاط تجمع الرسائل والتذاكر والوقت الصوتي والتقييمات في مقياس واحد،
 * وتُحسب من الجداول الموجودة (`staff_activity` و`ticket_ratings`) بلا جدول جديد.
 */
async function staffPointsPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const weights = app.guildConfig.value(guildId, "staff.points") || {};
  const top = app.activity.pointsLeaderboard(guildId, 30, 10, weights);

  const medals = ["🥇", "🥈", "🥉"];
  const description = top.length
    ? top
        .map((r, i) => {
          const b = r.breakdown;
          return `${medals[i] || `**${i + 1}.**`} <@${r.userId}> — **${r.total}** نقطة\n` +
            `-# رسائل ${b.messages} • تذاكر ${b.claims + b.closes} • صوت ${b.voice} • تقييم ${b.ratings}`;
        })
        .join("\n")
    : "لا توجد بيانات نشاط خلال آخر 30 يومًا.";

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "⭐ صدارة نقاط الطاقم — آخر 30 يومًا",
      description,
      color: app.config.color("primary"),
      fields: [{
        name: "كيف تُحسب النقاط",
        value:
          `كل \`${weights.perMessages || 50}\` رسالة = نقطة • استلام تذكرة = \`${weights.claim ?? 1}\` • ` +
          `إغلاق = \`${weights.close ?? 1}\` • ساعة صوت = \`${weights.voiceHour ?? 1}\`\n` +
          "التقييم: ⭐1=0.25 • ⭐2=0.5 • ⭐3=0.75 • ⭐4=1 • ⭐5=1.5\n" +
          "-# الأوزان قابلة للتعديل من `config/guild-defaults.json` ← `staff.points`"
      }]
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:staff", "رجوع", "⬅️"))]
  }));
}

/** ملف العضو بالتفصيل: نيك نيم ورتبته وكل أرقام نشاطه. */
async function staffMePanel(interaction, app) {
  const guild = interaction.guild;
  const member = interaction.member;
  const weights = app.guildConfig.value(guild.id, "staff.points") || {};
  const pts = app.activity.points(guild.id, member.id, 30, weights);
  const act = app.activity.summary(guild.id, member.id, 30);
  const rank = app.staffService.currentRank(member);
  const b = pts.breakdown;

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "👤 ملفي الإداري",
      color: app.config.color("primary"),
      thumbnail: member.user?.displayAvatarURL?.() || guild.iconURL?.() || undefined,
      fields: [
        { name: "الاسم", value: truncate(member.nickname || member.displayName || member.user?.username || "—", 60), inline: true },
        { name: "الرتبة", value: rank ? `**${rank.name}**\n<@&${rank.role_id}>` : "لست ضمن الطاقم", inline: true },
        { name: "⭐ النقاط", value: `**${pts.total}**`, inline: true },
        { name: "الرسائل (30 يوم)", value: `\`${act.messages}\``, inline: true },
        { name: "رسائل اليوم", value: `\`${act.today?.messages ?? 0}\``, inline: true },
        { name: "الوقت الصوتي", value: formatDuration((act.voice_seconds || 0) * 1000), inline: true },
        { name: "تذاكر مستلمة", value: `\`${act.tickets_claimed}\``, inline: true },
        { name: "تذاكر مغلقة", value: `\`${act.tickets_closed}\``, inline: true },
        { name: "متوسط التقييم", value: pts.raw.ratingCount ? `${pts.raw.averageStars} من 5` : "—", inline: true },
        {
          name: "توزيع النقاط",
          value: `رسائل \`${b.messages}\` • استلام \`${b.claims}\` • إغلاق \`${b.closes}\` • صوت \`${b.voice}\` • تقييم \`${b.ratings}\``
        }
      ]
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:staff", "رجوع", "⬅️"))]
  }));
}

const STAFF_ACTION_META = {
  up: { label: "ترقية", emoji: "⬆️", color: "success" },
  down: { label: "تنزيل", emoji: "⬇️", color: "warning" },
  dismiss: { label: "سحب من الطاقم", emoji: "🚫", color: "danger" }
};

/** يعرض قائمة اختيار العضو للإجراء الإداري. */
async function staffActionPick(interaction, app, action) {
  const meta = STAFF_ACTION_META[action];
  if (!meta) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} إجراء غير معروف.`, flags: 64 });
  }

  const select = new UserSelectMenuBuilder()
    .setCustomId(`panel:staffact:${action}`)
    .setPlaceholder(`اختر العضو المراد ${meta.label}`);

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: `${meta.emoji} ${meta.label}`,
      description:
        action === "dismiss"
          ? "تُزال **كل** رتب السلم الإداري من العضو دفعة واحدة، ومعها رتبة الطاقم الأساسية.\nللتنزيل رتبة واحدة فقط استخدم **تنزيل**."
          : action === "up"
            ? "يُنقل العضو رتبة واحدة للأعلى في السلم. من ليس في الطاقم يدخل أول رتبة."
            : "يُنقل العضو رتبة واحدة للأسفل. من في أدنى رتبة يخرج من الطاقم.",
      color: app.config.color(meta.color)
    })],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(btn("panel:staff", "رجوع", "⬅️"))
    ]
  }));
}

/** ينفّذ الإجراء عبر StaffService — نفس سلسلة الفحوصات التي تمر بها الأوامر. */
async function staffActionRun(interaction, app, action) {
  const meta = STAFF_ACTION_META[action];
  if (!meta) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} إجراء غير معروف.`, flags: 64 });
  }

  const userId = interaction.values?.[0];
  if (!userId) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر عضوًا.`, flags: 64 });
  }

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!target) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} العضو لم يعد في السيرفر.`, flags: 64 });
  }

  const result = action === "dismiss"
    ? await app.staffService.dismiss(interaction.member, target)
    : await app.staffService.move(interaction.member, target, action);

  if (!result.ok) {
    const messages = {
      noPermission: "ما عندك صلاحية لهذا الإجراء.",
      notStaff: "هذا العضو ليس ضمن الطاقم أصلًا.",
      atTop: "العضو في أعلى رتبة بالسلم.",
      noRanks: "السلم الإداري فارغ — أضف رتبًا أولًا.",
      roleNotFound: "رتبة السلم محذوفة من السيرفر.",
      botHierarchy: "رتبة البوت أقل من الرتبة المطلوبة — ارفعها.",
      hierarchy: "ما تقدر تتصرّف بعضو رتبته مثلك أو أعلى.",
      self: "ما تقدر تطبّق هذا على نفسك.",
      bot: "لا يمكن تطبيق هذا على بوت.",
      actionFailed: `فشل التنفيذ: ${truncate(result.details || "", 150)}`
    };
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} ${messages[result.reason] || "تعذّر تنفيذ الإجراء."}`,
      flags: 64
    });
  }

  const summary = action === "dismiss"
    ? `سُحب <@${userId}> من الطاقم.\nكان: **${result.from.name}** • أُزيلت \`${result.removed}\` رتبة.`
    : `<@${userId}>\n**${result.from?.name || "خارج الطاقم"}** ← **${result.to?.name || "خارج الطاقم"}**`;

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: `${meta.emoji} تم ${meta.label}`,
      description: summary,
      color: app.config.color(meta.color)
    })],
    components: [new ActionRowBuilder().addComponents(btn("panel:staff", "رجوع", "⬅️"))]
  }));
}

/**
 * مهام الإدارة في اللوحة.
 * الإدارة الكاملة عبر `/مهام` لأنها تحتاج حقولًا كثيرة، واللوحة تعطي
 * النظرة السريعة والتفعيل — تماشيًا مع بقية الأقسام.
 */
async function questsPanel(interaction, app) {
  const guildId = interaction.guild.id;
  const cfg = app.questService.config(guildId);
  const all = app.quests.list(guildId, { enabledOnly: false });
  const stats = app.quests.guildStats(guildId, 30);
  const mine = app.quests.activeClaims(guildId, interaction.member.id);
  const level = app.permissions.resolveLevel(interaction.member);

  const byKind = { daily: 0, weekly: 0, special: 0 };
  let measurable = 0;
  for (const q of all) {
    byKind[q.kind] = (byKind[q.kind] || 0) + 1;
    if (app.questService.verifier(q.verify_type).measurable) measurable++;
  }

  return safeUpdate(interaction, panelView({
    embeds: [buildEmbed({
      title: "🎯 مهام الإدارة",
      description: cfg.enabled
        ? "المهام تُنشر كبطاقات، والبوت **يتحقق آليًا** من إنجاز أغلبها من بيانات السيرفر."
        : "⚠️ النظام معطّل — فعّله من الزر بالأسفل.",
      color: app.config.color(cfg.enabled ? "primary" : "neutral"),
      fields: [
        { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
        { name: "إجمالي المهام", value: `\`${all.length}\``, inline: true },
        { name: "قابلة للقياس الآلي", value: `\`${measurable}\``, inline: true },
        { name: "☀️ يومية", value: `\`${byKind.daily || 0}\``, inline: true },
        { name: "📅 أسبوعية", value: `\`${byKind.weekly || 0}\``, inline: true },
        { name: "✨ خاصة", value: `\`${byKind.special || 0}\``, inline: true },
        { name: "إنجازات (30 يوم)", value: `\`${stats.completions}\` من \`${stats.participants}\` عضو`, inline: true },
        { name: "مهامك النشطة", value: `\`${mine.length}\``, inline: true },
        { name: "قناة النشر", value: cfg.channelId ? `<#${cfg.channelId}>` : "غير محددة", inline: true },
        {
          name: "الإدارة",
          value:
            "`/مهام جاهزة` لزرع 20 مهمة جاهزة\n" +
            "`/مهام نشر` لنشر مهمة • `/مهام تعديل` لتغيير عدد المنفذين أو الشروط\n" +
            "`/مهام مهامي` لمتابعة تقدّمك"
        }
      ]
    })],
    components: [
      ...(level >= Level.ADMIN
        ? [new ActionRowBuilder().addComponents(
            btn("panel:questtoggle", cfg.enabled ? "إيقاف النظام" : "تفعيل النظام", "🔀",
              cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success)
          )]
        : []),
      new ActionRowBuilder().addComponents(btn("panel:civil", "رجوع", "⬅️"))
    ]
  }));
}

async function questsToggle(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "quests.enabled");
  app.guildConfig.set(interaction.guild.id, "quests.enabled", !current);
  return questsPanel(interaction, app);
}
