const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseDuration, formatDuration, truncate } = require("../../../core/utils/helpers");

const SYSTEM = "rp.enabled";

/** أوامر اللاعب: الحقيبة، البيع، بدء العمل، المواقع. */
module.exports = [
  {
    name: "حقيبة",
    aliases: ["inv", "inventory", "حقيبتي"],
    description: "الحقيبة الشخصية: عرض عناصرك مع الكميات وأسعار البيع.",
    usage: "/حقيبة",
    arguments: [{ name: "user", required: false, description: "حقيبة عضو آخر (للطاقم)" }],
    examples: ["/حقيبة", "/حقيبة user:@أحمد"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("حقيبة")
      .setDescription("الحقيبة الشخصية")
      .addUserOption((o) => o.setName("user").setDescription("عضو آخر (للطاقم)")),

    async execute(ctx) {
      const target = ctx.interaction.options.getUser("user");
      if (target && target.id !== ctx.user.id && ctx.app.permissions.resolveLevel(ctx.member) < Level.STAFF) {
        return ctx.fail("errors.noPermission");
      }
      const user = target || ctx.user;
      const rows = ctx.app.rp.inventory(ctx.guild.id, user.id);
      return ctx.reply(ctx.app.rpService.inventoryPayload(ctx.guild, user, rows, 0), { ephemeral: true });
    }
  },

  {
    name: "بيع",
    aliases: ["sell"],
    description: "بيع عناصر من حقيبتك وإضافة المبلغ لرصيدك.",
    usage: "/بيع item:<العنصر> amount:<الكمية>",
    arguments: [
      { name: "item", required: true, description: "العنصر" },
      { name: "amount", required: false, description: "الكمية (افتراضي: الكل)" }
    ],
    examples: ["/بيع item:salmon amount:5", "/بيع item:wood"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("بيع")
      .setDescription("بيع عناصر من حقيبتك")
      .addStringOption((o) => o.setName("item").setDescription("مفتاح العنصر").setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("الكمية (افتراضي: الكل)").setMinValue(1)),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused().toLowerCase();
      const rows = app.rp.inventory(interaction.guild.id, interaction.user.id)
        .filter((r) => r.sell_price > 0)
        .filter((r) => r.item_key.toLowerCase().includes(focused) || (r.label || "").toLowerCase().includes(focused))
        .slice(0, 25);
      return interaction.respond(rows.map((r) => ({ name: `${r.label || r.item_key} (${r.amount})`, value: r.item_key })));
    },

    async execute(ctx) {
      const guildId = ctx.guild.id;
      const svc = ctx.app.rpService;

      const blocked = svc.restrictionOf(guildId, ctx.user.id);
      if (blocked) return ctx.fail("errors.actionFailed", { details: blocked });

      const key = ctx.interaction.options.getString("item").trim();
      const item = ctx.app.rp.getItem(guildId, key);
      if (!item) return ctx.fail("errors.actionFailed", { details: `ما فيه عنصر بمفتاح \`${key}\`.` });
      if (!item.sell_price) return ctx.fail("errors.actionFailed", { details: `**${item.label}** غير قابل للبيع.` });

      const owned = ctx.app.rp.amountOf(guildId, ctx.user.id, key);
      if (owned < 1) return ctx.fail("errors.actionFailed", { details: `ما تملك **${item.label}**.` });

      const requested = ctx.interaction.options.getInteger("amount") || owned;
      if (requested > owned) {
        return ctx.fail("errors.actionFailed", { details: `تملك \`${owned}\` فقط من **${item.label}**.` });
      }

      // السحب أولًا وذرّيًا: لو فشل لا يُدفع شيء، فلا يمكن تكرار البيع
      const taken = ctx.app.rp.take({
        guildId, userId: ctx.user.id, itemKey: key, amount: requested, reason: "بيع"
      });
      if (!taken.ok) {
        return ctx.fail("errors.actionFailed", { details: "الكمية تغيّرت — حاول مرة ثانية." });
      }

      const total = item.sell_price * requested;
      ctx.app.economyService.add(guildId, ctx.user.id, total, { target: "wallet", reason: `بيع ${requested}× ${item.label}` });

      await svc.log(guildId, "rpSell", buildEmbed({
        title: "💵 عملية بيع",
        color: ctx.color("success"),
        fields: [
          { name: "البائع", value: `<@${ctx.user.id}>`, inline: true },
          { name: "العنصر", value: `${requested}× ${item.label}`, inline: true },
          { name: "المبلغ", value: svc.money(guildId, total), inline: true }
        ]
      }));

      return ctx.reply({
        embeds: [buildEmbed({
          description:
            `✅ | **تم البيع بنجاح**\n\n` +
            `💰 تم بيع **${requested}** ${item.label} مقابل **${svc.money(guildId, total)}**\n` +
            `🎒 المتبقي: \`${taken.amount}\``,
          color: ctx.color("success")
        })]
      });
    }
  },

  {
    name: "مواقع",
    aliases: ["locations"],
    description: "عرض مواقع العمل (الصيد، الحطب...) بالصور.",
    usage: "/مواقع job:<الوظيفة>",
    arguments: [{ name: "job", required: true, description: "مفتاح الوظيفة" }],
    examples: ["/مواقع job:fisherman"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("مواقع")
      .setDescription("مواقع العمل")
      .addStringOption((o) => o.setName("job").setDescription("الوظيفة").setRequired(true).setAutocomplete(true)),

    async autocomplete(interaction, app) {
      const focused = interaction.options.getFocused().toLowerCase();
      const jobs = app.rp.listJobs(interaction.guild.id)
        .filter((j) => j.key.toLowerCase().includes(focused) || j.label.toLowerCase().includes(focused))
        .slice(0, 25);
      return interaction.respond(jobs.map((j) => ({ name: j.label, value: j.key })));
    },

    async execute(ctx) {
      const key = ctx.interaction.options.getString("job").trim();
      const job = ctx.app.rp.getJob(ctx.guild.id, key);
      if (!job) return ctx.fail("errors.actionFailed", { details: `ما فيه وظيفة بمفتاح \`${key}\`.` });

      const locations = ctx.app.rp.listLocations(ctx.guild.id, key);
      return ctx.reply({ embeds: [ctx.app.rpService.locationsEmbed(ctx.guild, job, locations)] }, { ephemeral: true });
    }
  }
];
