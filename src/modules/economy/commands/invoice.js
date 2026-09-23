const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseAmount } = require("../../../core/utils/helpers");

const SYSTEM = "invoices.enabled";

module.exports = [
  {
    name: "فاتورة",
    aliases: ["invoice", "bill"],
    description: "توثيق عملية بيع: العميل والمنتج والمبلغ وطريقة الدفع، وتُنشر في قناة الفواتير.",
    usage: "/فاتورة create client:<العميل> product:<المنتج> amount:<المبلغ> method:<طريقة الدفع>",
    arguments: [
      { name: "create", required: false, description: "إنشاء فاتورة جديدة" },
      { name: "list", required: false, description: "عرض آخر فواتيرك" },
      { name: "stats", required: false, description: "إجمالي مبيعاتك" },
      { name: "channel", required: false, description: "تحديد قناة نشر الفواتير (أدمن)" }
    ],
    examples: [
      "/فاتورة create client:أحمد product:حساب نيترو amount:10k method:تحويل بنكي",
      "/فاتورة list",
      "/فاتورة channel channel:#الفواتير"
    ],
    category: "economy",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("فاتورة")
      .setDescription("توثيق فواتير البيع")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء فاتورة")
          .addStringOption((o) => o.setName("client").setDescription("اسم العميل").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("product").setDescription("المنتج المباع").setRequired(true).setMaxLength(200))
          .addStringOption((o) => o.setName("amount").setDescription("المبلغ، يقبل صيغة مختصرة مثل 10k").setRequired(true))
          .addStringOption((o) => o.setName("method").setDescription("طريقة الدفع").setRequired(true).setMaxLength(100))
      )
      .addSubcommand((s) => s.setName("list").setDescription("آخر فواتيرك"))
      .addSubcommand((s) => s.setName("stats").setDescription("إجمالي مبيعاتك"))
      .addSubcommand((s) =>
        s.setName("channel").setDescription("تحديد قناة نشر الفواتير")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const svc = ctx.app.invoiceService;

      if (sub === "channel") {
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel?.isTextBased?.()) return ctx.fail("errors.actionFailed", { details: "اختر قناة نصية." });

        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        ctx.app.guildConfig.set(guildId, "invoices.channelId", channel.id);
        return ctx.success(`سيتم نشر الفواتير في <#${channel.id}>.`);
      }

      if (sub === "list") {
        const rows = ctx.app.invoices.listBySeller(guildId, ctx.user.id, 15);
        return ctx.reply({ embeds: [svc.listEmbed(ctx.guild, ctx.user, rows)] }, { ephemeral: true });
      }

      if (sub === "stats") {
        const totals = ctx.app.invoices.totalBySeller(guildId, ctx.user.id);
        return ctx.reply({ embeds: [svc.statsEmbed(ctx.guild, ctx.user, totals)] }, { ephemeral: true });
      }

      // create
      const amount = parseAmount(ctx.interaction.options.getString("amount"));
      if (amount === null || amount <= 0) {
        return ctx.fail("errors.actionFailed", { details: "أدخل مبلغًا صالحًا، مثل `500` أو `10k` أو `1.5m`." });
      }

      const result = await svc.create({
        guild: ctx.guild,
        seller: ctx.user,
        clientName: ctx.interaction.options.getString("client"),
        product: ctx.interaction.options.getString("product"),
        amount,
        method: ctx.interaction.options.getString("method")
      });

      return ctx.reply({
        content:
          `${ctx.emoji("success")} تم تسجيل الفاتورة **#${result.record.number}** بمبلغ ${ctx.app.economyService.format(guildId, amount)}.` +
          (result.posted ? "" : `\n${ctx.emoji("warning")} ما فيه قناة فواتير محددة — استخدم \`/فاتورة channel\`.`)
      }, { ephemeral: true });
    }
  }
];
