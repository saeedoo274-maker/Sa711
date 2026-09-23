const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration, buildEmbed, timestamp } = require("../../../core/utils/helpers");

module.exports = [
  {
    name: "سحب",
    aliases: ["giveaway", "قيف"],
    description: "إدارة السحوبات: بدء، إنهاء، إعادة سحب، إلغاء، وعرض القائمة.",
    usage: "/giveaway start prize:<الجائزة> duration:<المدة> winners:<العدد>",
    arguments: [
      { name: "prize", required: true, description: "الجائزة" },
      { name: "duration", required: true, description: "مدة السحب مثل 1h أو 2d" },
      { name: "winners", required: false, description: "عدد الفائزين (افتراضي 1)" },
      { name: "required-role", required: false, description: "رتبة مطلوبة للمشاركة" },
      { name: "bonus-role", required: false, description: "رتبة تمنح فرص إضافية" },
      { name: "bonus-entries", required: false, description: "عدد الفرص لحاملي رتبة البونص" },
      { name: "min-account-age", required: false, description: "أقل عمر للحساب مثل 30d" },
      { name: "channel", required: false, description: "قناة نشر السحب" }
    ],
    examples: [
      "/giveaway start prize:نيترو duration:2h winners:2",
      "/giveaway start prize:نيترو duration:1d required-role:@عضو bonus-role:@VIP bonus-entries:3"
    ],
    category: "giveaways",
    slashOnly: true,
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("سحب")
      .setDescription("إدارة السحوبات")
      .addSubcommand((s) =>
        s.setName("start").setDescription("بدء سحب جديد")
          .addStringOption((o) => o.setName("prize").setDescription("الجائزة").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 1h أو 2d").setRequired(true))
          .addIntegerOption((o) => o.setName("winners").setDescription("عدد الفائزين").setMinValue(1).setMaxValue(20))
          .addRoleOption((o) => o.setName("required-role").setDescription("رتبة مطلوبة للمشاركة"))
          .addRoleOption((o) => o.setName("bonus-role").setDescription("رتبة تمنح فرص إضافية"))
          .addIntegerOption((o) => o.setName("bonus-entries").setDescription("عدد الفرص للبونص").setMinValue(2).setMaxValue(10))
          .addStringOption((o) => o.setName("min-account-age").setDescription("أقل عمر للحساب مثل 30d"))
          .addChannelOption((o) => o.setName("channel").setDescription("قناة النشر").addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("end").setDescription("إنهاء سحب فورًا")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("reroll").setDescription("إعادة سحب الفائزين")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("cancel").setDescription("إلغاء سحب بدون فائزين")
          .addIntegerOption((o) => o.setName("id").setDescription("رقم السحب").setRequired(true))
      )
      .addSubcommand((s) => s.setName("list").setDescription("عرض السحوبات النشطة"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const service = ctx.app.giveawayService;

      if (sub === "start") {
        const prize = ctx.interaction.options.getString("prize");
        const durationMs = parseDuration(ctx.interaction.options.getString("duration"));
        if (!durationMs) return ctx.fail("errors.invalidDuration");
        if (durationMs > 30 * 86400000) return ctx.fail("errors.actionFailed", { details: "أقصى مدة للسحب 30 يومًا." });

        const minAgeRaw = ctx.interaction.options.getString("min-account-age");
        const minAccountAgeMs = minAgeRaw ? parseDuration(minAgeRaw) : null;
        if (minAgeRaw && !minAccountAgeMs) return ctx.fail("errors.invalidDuration");

        const channel = ctx.interaction.options.getChannel("channel") || ctx.channel;
        if (!channel.isTextBased()) return ctx.fail("errors.channelNotFound");

        const giveaway = ctx.app.giveaways.create({
          guildId: ctx.guild.id,
          channelId: channel.id,
          prize,
          winnersCount: ctx.interaction.options.getInteger("winners") || 1,
          hostId: ctx.user.id,
          requiredRoleId: ctx.interaction.options.getRole("required-role")?.id || null,
          bonusRoleId: ctx.interaction.options.getRole("bonus-role")?.id || null,
          bonusEntries: ctx.interaction.options.getInteger("bonus-entries") || 1,
          minAccountAgeMs,
          endsAt: Date.now() + durationMs
        });

        const message = await channel.send({
          embeds: [service.buildEmbed(giveaway)],
          components: service.buttons(giveaway)
        });
        ctx.app.giveaways.setMessage(giveaway.id, message.id);

        return ctx.reply(
          { content: `${ctx.emoji("success")} تم بدء السحب رقم \`${giveaway.id}\` في <#${channel.id}> — ينتهي ${timestamp(giveaway.ends_at, "R")}` },
          { ephemeral: true }
        );
      }

      const id = ctx.interaction.options.getInteger("id");
      if (sub !== "list" && !id) return ctx.fail("errors.invalidNumber");

      if (sub === "list") {
        const active = ctx.app.giveaways.listActive(ctx.guild.id);
        if (!active.length) return ctx.fail("errors.actionFailed", { details: "لا توجد سحوبات نشطة." });
        return ctx.reply({
          embeds: [
            buildEmbed({
              title: "🎁 السحوبات النشطة",
              description: active
                .map((g) => `\`#${g.id}\` **${g.prize}** — <#${g.channel_id}> — ينتهي ${timestamp(g.ends_at, "R")}`)
                .join("\n"),
              color: ctx.color("primary")
            })
          ]
        });
      }

      const giveaway = ctx.app.giveaways.getById(id);
      if (!giveaway || giveaway.guild_id !== ctx.guild.id) {
        return ctx.fail("errors.actionFailed", { details: "لم أجد سحبًا بهذا الرقم في هذا السيرفر." });
      }

      if (sub === "cancel") {
        if (!ctx.app.giveaways.cancel(id)) return ctx.fail("errors.actionFailed", { details: "السحب منتهٍ أو ملغى بالفعل." });
        return ctx.success(`تم إلغاء السحب \`#${id}\` بدون اختيار فائزين.`);
      }

      if (sub === "end") {
        const result = await service.end(id);
        if (!result.ok) return ctx.fail("errors.actionFailed", { details: "السحب منتهٍ بالفعل." });
        return ctx.success(`تم إنهاء السحب \`#${id}\`. عدد الفائزين: \`${result.winners.length}\``);
      }

      // reroll
      if (giveaway.status === "active") return ctx.fail("errors.actionFailed", { details: "لا يمكن إعادة سحب لم ينتهِ بعد." });
      const result = await service.end(id, { rerolledBy: ctx.user.id });
      return ctx.success(`تمت إعادة سحب \`#${id}\`. الفائزون الجدد: \`${result.winners.length}\``);
    }
  }
];
