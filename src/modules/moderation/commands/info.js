const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../../core/utils/helpers");

const TYPE_LABELS = { ban: "حظر", unban: "فك حظر", kick: "طرد", timeout: "إسكات", untimeout: "فك إسكات", warn: "تحذير" };

module.exports = [
  {
    name: "معلومات",
    aliases: ["userinfo", "user"],
    description: "عرض معلومات عضو وسجله الإداري المختصر.",
    usage: "userinfo [@عضو]",
    arguments: [{ name: "عضو", required: false, description: "العضو، أو نفسك إن تُرك فارغًا" }],
    examples: ["userinfo", "userinfo @أحمد"],
    category: "moderation",
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("معلومات")
      .setDescription("عرض معلومات عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو")),

    async execute(ctx) {
      const member = (await ctx.getMember("user", 0)) || ctx.member;
      const level = ctx.app.permissions.resolveLevel(member);

      const roles = member.roles.cache
        .filter((r) => r.id !== ctx.guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => `<@&${r.id}>`)
        .slice(0, 15);

      const warns = ctx.app.cases.countByTarget(ctx.guild.id, member.id, "warn");
      const totalCases = ctx.app.cases.countByTarget(ctx.guild.id, member.id);

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: `${ctx.emoji("staff")} ${ctx.t("moderation.userinfo.title")}`,
            color: member.displayColor || ctx.color("primary"),
            thumbnail: member.user.displayAvatarURL({ size: 256 }),
            fields: [
              { name: "العضو", value: `<@${member.id}>\n\`${member.user.tag}\``, inline: true },
              { name: "الآيدي", value: `\`${member.id}\``, inline: true },
              { name: "المستوى", value: ctx.t(`levels.${level}`), inline: true },
              { name: "أنشأ الحساب", value: timestamp(member.user.createdTimestamp, "R"), inline: true },
              { name: "انضم للسيرفر", value: member.joinedTimestamp ? timestamp(member.joinedTimestamp, "R") : "—", inline: true },
              { name: "الإسكات", value: member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
                  ? `ينتهي ${timestamp(member.communicationDisabledUntilTimestamp, "R")}` : "—", inline: true },
              { name: "السجل الإداري", value: `تحذيرات فعّالة: \`${warns}\` • إجمالي القضايا: \`${totalCases}\`` },
              { name: `الرتب (${member.roles.cache.size - 1})`, value: roles.length ? truncate(roles.join(" ")) : "—" }
            ]
          })
        ]
      });
    }
  },

  {
    name: "سجل",
    aliases: ["history"],
    description: "عرض السجل الإداري الكامل لعضو.",
    usage: "history <@عضو>",
    arguments: [{ name: "عضو", required: true, description: "العضو المراد عرض سجله" }],
    examples: ["history @أحمد"],
    category: "moderation",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("سجل")
      .setDescription("عرض السجل الإداري لعضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const user = await ctx.getUser("user", 0);
      if (!user) return ctx.fail("errors.userNotFound");

      const list = ctx.app.cases.listByTarget(ctx.guild.id, user.id, { limit: 20 });
      if (!list.length) {
        return ctx.reply({ embeds: [buildEmbed({ description: ctx.t("moderation.history.empty"), color: ctx.color("neutral") })] });
      }

      const fields = list.map((c) => ({
        name: `#${c.case_number} • ${TYPE_LABELS[c.type] || c.type}${c.active ? "" : " (ملغاة)"}`,
        value: `${truncate(c.reason || ctx.t("common.noReason"), 150)}\n${ctx.t("common.moderator")}: <@${c.moderator_id}> • ${timestamp(c.created_at, "R")}`
      }));

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: ctx.t("moderation.history.title", { target: user.tag }),
            color: ctx.color("primary"),
            thumbnail: user.displayAvatarURL(),
            fields: fields.slice(0, 25),
            footer: `إجمالي المعروض: ${fields.length}`
          })
        ]
      });
    }
  },

  {
    name: "قضية",
    aliases: ["case"],
    description: "عرض تفاصيل قضية إدارية برقمها، وإدارتها: ملاحظات، أدلة، ربط قضايا، خط زمني، تصدير، إغلاق/إعادة فتح.",
    usage: "case <الرقم> [timeline|note|evidence|link|unlink|export|close|reopen] [نص/رقم/روابط]",
    arguments: [
      { name: "الرقم", required: true, description: "رقم القضية" },
      { name: "الإجراء", required: false, description: "timeline, note, evidence, link, unlink, export, close, reopen" },
      { name: "النص", required: false, description: "نص الملاحظة، روابط الأدلة، أو رقم القضية المرتبطة" }
    ],
    examples: ["case 152", "case 152 timeline", "case 152 note راجعت التسجيل", "case 152 link 140"],
    category: "moderation",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("قضية")
      .setDescription("عرض تفاصيل قضية إدارية")
      .addIntegerOption((o) => o.setName("number").setDescription("رقم القضية").setRequired(true))
      .addStringOption((o) => o.setName("action").setDescription("إجراء على القضية").addChoices(
        { name: "عرض", value: "view" }, { name: "الخط الزمني", value: "timeline" }, { name: "ملاحظة", value: "note" },
        { name: "دليل", value: "evidence" }, { name: "ربط قضية", value: "link" }, { name: "فك ربط", value: "unlink" },
        { name: "تصدير", value: "export" }, { name: "إغلاق", value: "close" }, { name: "إعادة فتح", value: "reopen" }))
      .addStringOption((o) => o.setName("text").setDescription("نص الملاحظة أو روابط الأدلة").setMaxLength(1000))
      .addIntegerOption((o) => o.setName("related").setDescription("رقم القضية المرتبطة").setMinValue(1))
      .addAttachmentOption((o) => o.setName("file").setDescription("ملف دليل"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const number = ctx.getNumber("number", 0);
      if (!number) return ctx.fail("errors.invalidNumber");

      const record = ctx.app.cases.getByNumber(ctx.guild.id, number);
      if (!record) return ctx.fail("errors.caseNotFound");

      const action = String(ctx.getString("action", 1) || "view").toLowerCase();
      if (action !== "view") return manageCase(ctx, record, action);

      const fields = [
        { name: "النوع", value: TYPE_LABELS[record.type] || record.type, inline: true },
        { name: "الحالة", value: record.active ? "فعّالة" : "ملغاة", inline: true },
        { name: ctx.t("common.date"), value: timestamp(record.created_at, "F"), inline: true },
        { name: ctx.t("common.target"), value: `<@${record.target_id}>\n\`${record.target_tag || record.target_id}\``, inline: true },
        { name: ctx.t("common.moderator"), value: `<@${record.moderator_id}>\n\`${record.moderator_tag || ""}\``, inline: true }
      ];
      if (record.duration_ms) fields.push({ name: ctx.t("common.duration"), value: formatDuration(record.duration_ms), inline: true });
      fields.push({ name: ctx.t("common.reason"), value: truncate(record.reason || ctx.t("common.noReason")) });

      return ctx.reply({
        embeds: [
          buildEmbed({
            title: ctx.t("moderation.case.title", { caseNumber: record.case_number }),
            color: record.active ? ctx.color("warning") : ctx.color("neutral"),
            fields
          })
        ]
      });
    }
  }
];

/** إجراءات إدارة القضية (إضافة cases-plus). المشرفون فما فوق لأي تعديل. */
async function manageCase(ctx, record, action) {
  const app = ctx.app;
  const svc = app.casework;
  if (!svc || !app.features.isEnabled(ctx.guild.id, "moderation")) return ctx.fail("errors.systemDisabled", { system: "cases-plus" });
  const t = (k, v) => ctx.t(k, v);
  const fail = (res) => ctx.fail("errors.actionFailed", { details: t(`cw.err.${res.reason}`) });
  const guildId = ctx.guild.id;
  const text = ctx.isSlash ? ctx.interaction.options.getString("text") : ctx.args.slice(2).join(" ");
  const related = ctx.isSlash ? ctx.interaction.options.getInteger("related") : parseInt(ctx.args[2], 10);

  if (action === "timeline") return ctx.reply(svc.casePayload(ctx.guild, record));
  if (action === "export") return ctx.reply({ files: [svc.exportCase(guildId, record)] }, { ephemeral: true });

  if (app.permissions.resolveLevel(ctx.member) < Level.MODERATOR) return ctx.fail("errors.noPermission");
  let res;
  if (action === "note") res = svc.addNote(guildId, record.case_number, ctx.user.id, text);
  else if (action === "evidence") {
    const file = ctx.isSlash ? ctx.interaction.options.getAttachment("file") : null;
    const urls = [...String(text || "").split(/\s+/).filter(Boolean), ...(file ? [file.url] : []), ...(ctx.message?.attachments ? [...ctx.message.attachments.values()].map((a) => a.url) : [])];
    res = svc.addEvidence(guildId, record.case_number, ctx.user.id, urls);
  } else if (action === "link" || action === "unlink") {
    if (!Number.isInteger(related) || related < 1) return ctx.fail("errors.invalidNumber");
    res = action === "link" ? svc.link(guildId, record.case_number, related, ctx.user.id) : svc.unlink(guildId, record.case_number, related, ctx.user.id);
  } else if (action === "close" || action === "reopen") res = svc.setStatus(guildId, record.case_number, ctx.user.id, action === "reopen");
  else return ctx.fail("errors.actionFailed", { details: action });
  if (!res.ok) return fail(res);
  return ctx.success(t("cw.done"));
}
