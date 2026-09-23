const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

/** المهام المعلّقة بانتظار التأكيد. تنتهي صلاحيتها تلقائيًا. */
const pending = new Map();

function cleanup() {
  const now = Date.now();
  for (const [key, job] of pending) if (now - job.createdAt > 120000) pending.delete(key);
}

module.exports = [
  {
    name: "بث",
    aliases: ["broadcast", "برودكاست", "اذاعة"],
    description: "إرسال رسالة جماعية إلى قناة أو إلى خاص أعضاء رتبة معينة.",
    usage: "/broadcast message:<النص> method:<channel|dm> role:<رتبة>",
    arguments: [
      { name: "message", required: true, description: "نص الرسالة" },
      { name: "method", required: true, description: "channel للإرسال في قناة، dm للخاص" },
      { name: "role", required: false, description: "الرتبة المستهدفة عند الإرسال للخاص" },
      { name: "channel", required: false, description: "القناة المستهدفة" },
      { name: "embed", required: false, description: "إرسال كإمبيد بدل رسالة عادية" }
    ],
    examples: ["/broadcast message:صيانة الليلة method:channel channel:#عام"],
    category: "broadcast",
    slashOnly: true,
    cooldown: 30000,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("بث")
      .setDescription("إرسال رسالة جماعية")
      .addStringOption((o) => o.setName("message").setDescription("نص الرسالة").setRequired(true).setMaxLength(2000))
      .addStringOption((o) =>
        o.setName("method").setDescription("طريقة الإرسال").setRequired(true)
          .addChoices({ name: "قناة", value: "channel" }, { name: "خاص الأعضاء", value: "dm" })
      )
      .addRoleOption((o) => o.setName("role").setDescription("الرتبة المستهدفة (للخاص)"))
      .addChannelOption((o) => o.setName("channel").setDescription("القناة").addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName("title").setDescription("عنوان الإمبيد"))
      .addBooleanOption((o) => o.setName("embed").setDescription("إرسال كإمبيد"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      cleanup();
      const message = ctx.getString("message");
      const method = ctx.getString("method");
      const asEmbed = ctx.getBoolean("embed");
      const title = ctx.getString("title");
      const role = ctx.interaction.options.getRole("role");
      const channel = ctx.interaction.options.getChannel("channel");

      const payload = asEmbed
        ? { embeds: [buildEmbed({ title: title || "📢 إعلان", description: message, color: ctx.color("primary"), footer: ctx.guild.name })] }
        : { content: message };

      // إرسال في قناة: عملية واحدة، لا حاجة لتأكيد
      if (method === "channel") {
        const target = channel || ctx.channel;
        if (!target.isTextBased()) return ctx.fail("errors.channelNotFound");
        await target.send(payload);
        return ctx.reply({ content: `${ctx.emoji("success")} تم الإرسال إلى <#${target.id}>` }, { ephemeral: true });
      }

      // إرسال للخاص: يتطلب تأكيدًا لأنه عملية ضخمة وقابلة لإزعاج الأعضاء
      if (!role) return ctx.fail("errors.actionFailed", { details: "حدّد رتبة مستهدفة عند الإرسال للخاص." });

      await ctx.guild.members.fetch().catch(() => null);
      const targets = role.members.filter((m) => !m.user.bot);
      if (!targets.size) return ctx.fail("errors.actionFailed", { details: "لا يوجد أعضاء في هذه الرتبة." });

      const jobId = `${ctx.user.id}:${Date.now()}`;
      pending.set(jobId, { payload, targetIds: [...targets.keys()], guildId: ctx.guild.id, createdAt: Date.now(), userId: ctx.user.id });

      return ctx.reply(
        {
          embeds: [
            buildEmbed({
              title: `${ctx.emoji("warning")} تأكيد الإرسال الجماعي`,
              description: `سيتم إرسال الرسالة إلى **${targets.size}** عضو في الخاص.\nقد يستغرق الأمر عدة دقائق بسبب حدود ديسكورد.`,
              color: ctx.color("warning")
            })
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`broadcast:confirm:${jobId}`).setLabel("تأكيد الإرسال").setStyle(ButtonStyle.Danger),
              new ButtonBuilder().setCustomId(`broadcast:cancel:${jobId}`).setLabel("إلغاء").setStyle(ButtonStyle.Secondary)
            )
          ]
        },
        { ephemeral: true }
      );
    }
  }
];

module.exports.pending = pending;
