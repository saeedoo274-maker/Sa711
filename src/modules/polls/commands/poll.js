const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, timestamp } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "استطلاع",
    aliases: ["poll", "تصويت"],
    description: "إنشاء استطلاع رأي بخيارات وأزرار تصويت.",
    usage: "/poll question:<السؤال> option1:<خيار> option2:<خيار> duration:<المدة>",
    arguments: [
      { name: "question", required: true, description: "سؤال الاستطلاع" },
      { name: "option1..option5", required: true, description: "الخيارات (خياران على الأقل)" },
      { name: "duration", required: false, description: "مدة الاستطلاع مثل 1h" },
      { name: "multiple", required: false, description: "السماح باختيار أكثر من خيار" },
      { name: "anonymous", required: false, description: "إخفاء النتائج حتى الإغلاق" }
    ],
    examples: ["/poll question:وش رأيكم بالتحديث؟ option1:ممتاز option2:يحتاج تحسين duration:1d"],
    category: "polls",
    slashOnly: true,
    permissions: { level: Level.STAFF },
    slash: (() => {
      const b = new SlashCommandBuilder()
        .setName("استطلاع")
        .setDescription("إنشاء استطلاع رأي")
        .addStringOption((o) => o.setName("question").setDescription("السؤال").setRequired(true).setMaxLength(240));
      for (let i = 1; i <= 5; i++) {
        b.addStringOption((o) => o.setName(`option${i}`).setDescription(`الخيار ${i}`).setRequired(i <= 2).setMaxLength(80));
      }
      return b
        .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 1h أو 2d"))
        .addBooleanOption((o) => o.setName("multiple").setDescription("السماح باختيار متعدد"))
        .addBooleanOption((o) => o.setName("anonymous").setDescription("إخفاء النتائج حتى الإغلاق (افتراضي: نعم)"))
        .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages);
    })(),

    async execute(ctx) {
      const question = ctx.getString("question");
      const options = [];
      for (let i = 1; i <= 5; i++) {
        const value = ctx.interaction.options.getString(`option${i}`);
        if (value) options.push(value);
      }
      if (options.length < 2) return ctx.fail("errors.actionFailed", { details: "يجب إدخال خيارين على الأقل." });

      const durationRaw = ctx.getString("duration");
      const durationMs = durationRaw ? parseDuration(durationRaw) : null;
      if (durationRaw && !durationMs) return ctx.fail("errors.invalidDuration");

      const channel = ctx.interaction.options.getChannel("channel") || ctx.channel;
      if (!channel.isTextBased()) return ctx.fail("errors.channelNotFound");

      const poll = ctx.app.polls.create({
        guildId: ctx.guild.id,
        channelId: channel.id,
        question,
        options,
        multiple: ctx.getBoolean("multiple") === true,
        anonymous: ctx.getBoolean("anonymous") !== false,
        authorId: ctx.user.id,
        endsAt: durationMs ? Date.now() + durationMs : null
      });

      const message = await channel.send({
        embeds: [ctx.app.pollService.buildEmbed(poll)],
        components: ctx.app.pollService.buttons(poll)
      });
      ctx.app.polls.setMessage(poll.id, message.id);

      return ctx.reply(
        {
          content: `${ctx.emoji("success")} تم إنشاء الاستطلاع \`#${poll.id}\` في <#${channel.id}>` +
            (durationMs ? ` — يُغلق ${timestamp(poll.ends_at, "R")}` : "")
        },
        { ephemeral: true }
      );
    }
  }
];
