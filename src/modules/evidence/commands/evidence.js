const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");

const KINDS = [
  { name: "حظر", value: "حظر" },
  { name: "طرد", value: "طرد" },
  { name: "إسكات", value: "إسكات" },
  { name: "تحذير", value: "تحذير" },
  { name: "سجن", value: "سجن" },
  { name: "سحب رتبة", value: "سحب رتبة" },
  { name: "أخرى", value: "أخرى" }
];

/** يقبل الروابط الآمنة فقط، وحتى 10 روابط. */
function parseLinks(raw) {
  return (raw || "")
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter((v) => /^https:\/\/\S+$/i.test(v))
    .slice(0, 10);
}

function evidenceEmbed(ctx, record, target, officer) {
  const fields = [
    { name: "👤 العضو", value: `<@${record.target_id}>`, inline: true },
    { name: "🛡️ المسؤول", value: `<@${record.officer_id}>`, inline: true },
    { name: "⚖️ العقوبة", value: record.kind, inline: true }
  ];
  if (record.duration) fields.push({ name: "⏳ المدة", value: record.duration, inline: true });
  if (record.place) fields.push({ name: "📍 المكان", value: truncate(record.place, 256), inline: true });
  if (record.case_number) fields.push({ name: "📁 القضية", value: `#${record.case_number}`, inline: true });
  if (record.reason) fields.push({ name: "📝 السبب", value: truncate(record.reason, 1024) });
  if (record.note) fields.push({ name: "🗒️ ملاحظات", value: truncate(record.note, 1024) });
  if (record.links.length) {
    fields.push({
      name: `📎 الأدلة (${record.links.length})`,
      value: truncate(record.links.map((l, i) => `[دليل ${i + 1}](${l})`).join(" • "), 1024)
    });
  }

  const image = record.links.find((l) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(l));

  return buildEmbed({
    title: `📁 دليل عقوبة #${record.number}`,
    color: ctx.color("danger"),
    fields,
    thumbnail: target?.displayAvatarURL?.() || undefined,
    image: image || undefined,
    footer: `سُجّل ${new Date(record.created_at).toLocaleString("ar", { hour12: false })}`
  });
}

module.exports = [
  {
    name: "دليل",
    aliases: ["evidence", "دلائل"],
    description: "توثيق العقوبات بالأدلة: يُنشر في قناة الدلائل ويُربط بالقضية الإدارية.",
    usage: "/evidence add user:@عضو kind:حظر reason:<السبب> links:<روابط>",
    arguments: [
      { name: "add", required: false, description: "تسجيل دليل عقوبة" },
      { name: "show", required: false, description: "عرض دليل برقمه" },
      { name: "list", required: false, description: "دلائل عضو" },
      { name: "delete", required: false, description: "حذف دليل" },
      { name: "channel", required: false, description: "تحديد قناة الدلائل" }
    ],
    examples: [
      "/evidence add user:@أحمد kind:حظر reason:تخريب links:https://i.imgur.com/a.png",
      "/evidence list user:@أحمد",
      "/evidence channel channel:#الدلائل"
    ],
    category: "evidence",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("دليل")
      .setDescription("توثيق العقوبات بالأدلة")
      .addSubcommand((s) =>
        s.setName("add").setDescription("تسجيل دليل عقوبة")
          .addUserOption((o) => o.setName("user").setDescription("العضو المعاقَب").setRequired(true))
          .addStringOption((o) => o.setName("kind").setDescription("نوع العقوبة").setRequired(true).addChoices(...KINDS))
          .addStringOption((o) => o.setName("reason").setDescription("سبب العقوبة").setRequired(true).setMaxLength(1000))
          .addStringOption((o) => o.setName("links").setDescription("روابط الأدلة مفصولة بمسافة").setMaxLength(1500))
          .addStringOption((o) => o.setName("duration").setDescription("مدة العقوبة").setMaxLength(100))
          .addStringOption((o) => o.setName("place").setDescription("مكان المخالفة").setMaxLength(200))
          .addIntegerOption((o) => o.setName("case").setDescription("رقم القضية الإدارية المرتبطة").setMinValue(1))
          .addStringOption((o) => o.setName("note").setDescription("ملاحظات إضافية").setMaxLength(1000))
      )
      .addSubcommand((s) =>
        s.setName("show").setDescription("عرض دليل")
          .addIntegerOption((o) => o.setName("number").setDescription("رقم الدليل").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("list").setDescription("دلائل عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("delete").setDescription("حذف دليل")
          .addIntegerOption((o) => o.setName("number").setDescription("رقم الدليل").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("channel").setDescription("تحديد قناة نشر الدلائل")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "channel") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const channel = ctx.interaction.options.getChannel("channel");
        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        ctx.app.guildConfig.set(guildId, "logs.evidence", channel.id);
        return ctx.success(`سيتم نشر الدلائل في <#${channel.id}>.`);
      }

      if (sub === "show") {
        const number = ctx.interaction.options.getInteger("number");
        const record = ctx.app.reports.getEvidence(guildId, number);
        if (!record) return ctx.fail("errors.actionFailed", { details: "ما لقيت دليلًا بهذا الرقم." });
        const target = await ctx.app.client.users.fetch(record.target_id).catch(() => null);
        return ctx.reply({ embeds: [evidenceEmbed(ctx, record, target)] }, { ephemeral: true });
      }

      if (sub === "list") {
        const user = ctx.interaction.options.getUser("user");
        const rows = ctx.app.reports.evidenceForTarget(guildId, user.id);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: `ما فيه دلائل على <@${user.id}>.` });
        return ctx.reply({
          embeds: [buildEmbed({
            title: `📁 دلائل ${user.username}`,
            description: rows
              .map((r) =>
                `\`#${r.number}\` **${r.kind}**${r.duration ? ` • ${r.duration}` : ""}\n` +
                `  ${truncate(r.reason || "—", 120)}\n` +
                `  <@${r.officer_id}> • ${timestamp(r.created_at, "R")}${r.links.length ? ` • \`${r.links.length}\` دليل` : ""}`
              )
              .join("\n\n"),
            color: ctx.color("warning"),
            thumbnail: user.displayAvatarURL(),
            footer: `الإجمالي: ${rows.length}`
          })]
        }, { ephemeral: true });
      }

      if (sub === "delete") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const number = ctx.interaction.options.getInteger("number");
        const record = ctx.app.reports.getEvidence(guildId, number);
        if (!record) return ctx.fail("errors.actionFailed", { details: "ما لقيت دليلًا بهذا الرقم." });

        // تُحذف رسالة النشر أيضًا حتى لا يبقى سجل معلّق
        if (record.channel_id && record.message_id) {
          const channel = await ctx.app.client.channels.fetch(record.channel_id).catch(() => null);
          const message = channel?.isTextBased() ? await channel.messages.fetch(record.message_id).catch(() => null) : null;
          await message?.delete().catch(() => {});
        }
        ctx.app.reports.deleteEvidence(guildId, number);
        return ctx.success(`تم حذف الدليل \`#${number}\`.`);
      }

      // add
      const target = ctx.interaction.options.getUser("user");
      if (target.bot) return ctx.fail("errors.actionFailed", { details: "ما ينفع توثيق عقوبة على بوت." });

      const caseNumber = ctx.interaction.options.getInteger("case");
      if (caseNumber && !ctx.app.cases.getByNumber(guildId, caseNumber)) {
        return ctx.fail("errors.actionFailed", { details: `ما لقيت قضية برقم \`#${caseNumber}\`.` });
      }

      const links = parseLinks(ctx.interaction.options.getString("links"));

      const record = ctx.app.reports.createEvidence({
        guildId,
        caseNumber,
        targetId: target.id,
        officerId: ctx.user.id,
        kind: ctx.interaction.options.getString("kind"),
        reason: ctx.interaction.options.getString("reason"),
        duration: ctx.interaction.options.getString("duration"),
        place: ctx.interaction.options.getString("place"),
        note: ctx.interaction.options.getString("note"),
        links
      });

      const embed = evidenceEmbed(ctx, record, target);
      const channelId = ctx.app.guildConfig.value(guildId, "logs.evidence");
      let posted = false;

      if (channelId) {
        const channel = await ctx.app.client.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased()) {
          const message = await channel.send({ embeds: [embed] }).catch(() => null);
          if (message) {
            ctx.app.reports.setEvidenceMessage(guildId, record.number, channel.id, message.id);
            posted = true;
          }
        }
      }

      return ctx.reply({
        content:
          `${ctx.emoji("success")} تم توثيق الدليل \`#${record.number}\`` +
          (links.length ? ` مع \`${links.length}\` رابط.` : ".") +
          (posted ? `\nنُشر في <#${channelId}>.` : `\n${ctx.emoji("warning")} ما فيه قناة دلائل — حدّدها بـ \`/evidence channel\`.`),
        embeds: [embed]
      }, { ephemeral: true });
    }
  }
];
