const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ContextMenuCommandBuilder, ApplicationCommandType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");

async function featureMessage(ctx, message, reason) {
  const guildId = ctx.guild.id;
  const channelId = ctx.app.guildConfig.value(guildId, "featured.channelId");
  if (!channelId) return { ok: false, details: "ما فيه قناة مميّزة محددة. اضبطها بـ `/featured channel`." };

  if (ctx.app.featured.getBySource(guildId, message.id)) {
    return { ok: false, details: "هذه الرسالة مميّزة بالفعل." };
  }

  const channel = await ctx.app.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return { ok: false, details: "قناة المميّزة لم تعد صالحة." };

  const image = message.attachments?.find((a) => /^image\//i.test(a.contentType || ""));
  const embed = buildEmbed({
    description: truncate(message.content || "*(بلا نص)*", 3000),
    color: ctx.color("warning"),
    image: image?.url,
    footer: `#${message.channel.name || ""}`
  });
  embed.setAuthor({ name: message.author?.tag || "عضو", iconURL: message.author?.displayAvatarURL?.() });
  if (reason) embed.addFields({ name: "سبب التمييز", value: truncate(reason, 500) });

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
  const sent = await channel
    .send({
      content: "🌟 منشور مميّز",
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setLabel("الذهاب للرسالة الأصلية").setStyle(ButtonStyle.Link).setURL(message.url)
        )
      ]
    })
    .catch(() => null);

  const record = ctx.app.featured.create({
    guildId,
    sourceChannel: message.channel.id,
    sourceMessage: message.id,
    featuredChannel: channel.id,
    featuredMessage: sent?.id,
    authorId: message.author?.id,
    reason,
    featuredBy: ctx.user.id
  });

  return { ok: true, record, channelId: channel.id };
}

module.exports = [
  {
    name: "مميز",
    aliases: ["featured", "تمييز"],
    description: "تمييز منشورات بارزة ونشرها في قناة مخصصة.",
    usage: "/featured post message-id:<الآيدي> reason:<السبب>",
    arguments: [
      { name: "channel", required: false, description: "تحديد قناة المنشورات المميّزة" },
      { name: "post", required: false, description: "تمييز رسالة بآيديها" },
      { name: "list", required: false, description: "عرض آخر المميّزات" },
      { name: "remove", required: false, description: "إزالة رسالة من السجل" }
    ],
    examples: ["/featured channel channel:#مميز", "/featured post message-id:123... reason:فكرة رائعة"],
    category: "featured",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("مميز")
      .setDescription("المنشورات المميّزة")
      .addSubcommand((s) =>
        s.setName("channel").setDescription("تحديد قناة المميّزة")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("post").setDescription("تمييز رسالة بآيديها")
          .addStringOption((o) => o.setName("message-id").setDescription("آيدي الرسالة").setRequired(true))
          .addChannelOption((o) => o.setName("source").setDescription("القناة المصدر (افتراضي: الحالية)").addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("reason").setDescription("سبب التمييز").setMaxLength(500))
      )
      .addSubcommand((s) => s.setName("list").setDescription("آخر المميّزات"))
      .addSubcommand((s) =>
        s.setName("remove").setDescription("إزالة من السجل")
          .addStringOption((o) => o.setName("message-id").setDescription("آيدي الرسالة الأصلية").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

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
        ctx.app.guildConfig.set(guildId, "featured.channelId", channel.id);
        return ctx.success(`سيتم نشر المميّزات في <#${channel.id}>.\nيمكنك أيضًا الضغط بالزر الأيمن على أي رسالة ← تطبيقات ← تمييز.`);
      }

      if (sub === "list") {
        const rows = ctx.app.featured.list(guildId, 10);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "ما فيه منشورات مميّزة بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🌟 آخر المميّزات",
            description: rows.map((r) =>
              `<@${r.author_id}> — بواسطة <@${r.featured_by}> • ${timestamp(r.created_at, "R")}` +
              (r.reason ? `\n  ${truncate(r.reason, 100)}` : "")
            ).join("\n"),
            color: ctx.color("warning"),
            footer: `الإجمالي: ${ctx.app.featured.count(guildId)}`
          })]
        }, { ephemeral: true });
      }

      if (sub === "remove") {
        if (level < Level.ADMIN) return ctx.fail("errors.noPermission");
        const id = ctx.interaction.options.getString("message-id").trim();
        if (!ctx.app.featured.remove(guildId, id)) return ctx.fail("errors.actionFailed", { details: "ما لقيت رسالة بهذا الآيدي في السجل." });
        return ctx.success("تمت إزالتها من السجل.");
      }

      // post
      const id = ctx.interaction.options.getString("message-id").trim().match(/\d{15,25}/)?.[0];
      if (!id) return ctx.fail("errors.actionFailed", { details: "آيدي رسالة غير صالح." });

      const source = ctx.interaction.options.getChannel("source") || ctx.channel;
      const message = await source.messages.fetch(id).catch(() => null);
      if (!message) return ctx.fail("errors.actionFailed", { details: "ما لقيت الرسالة في تلك القناة." });

      const result = await featureMessage(ctx, message, ctx.interaction.options.getString("reason"));
      if (!result.ok) return ctx.fail("errors.actionFailed", { details: result.details });
      return ctx.success(`تم تمييز الرسالة في <#${result.channelId}>.`);
    }
  }
];

module.exports.contextMenu = {
  name: "تمييز الرسالة",
  isContextMenu: true,
  slashOnly: true,
  category: "featured",
  permissions: { level: Level.STAFF },
  slash: new ContextMenuCommandBuilder().setName("تمييز الرسالة").setType(ApplicationCommandType.Message)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(ctx) {
    const message = ctx.interaction.targetMessage;
    const result = await featureMessage(ctx, message, null);
    if (!result.ok) return ctx.fail("errors.actionFailed", { details: result.details });
    return ctx.reply({ content: `${ctx.emoji("success")} تم تمييز الرسالة في <#${result.channelId}>.` }, { ephemeral: true });
  }
};
