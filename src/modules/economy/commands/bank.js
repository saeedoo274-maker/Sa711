const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseAmount } = require("../../../core/utils/helpers");
const { containerPayload } = require("../../../core/utils/componentsV2");
const { bankPanelRows } = require("../interactions");

const SYSTEM = "economy.enabled";

function amountOf(ctx, name) {
  const value = ctx.interaction.options.getInteger(name);
  if (value === null || value === undefined) return null;
  return value > 0 ? value : null;
}

/** رسالة موحّدة تُعرض عند رفض عملية بسبب تجميد الحساب. */
function frozenMessage(account) {
  const reason = account?.frozen_reason ? `\nالسبب: ${account.frozen_reason}` : "";
  return `⛔ خدماتك البنكية موقوفة حاليًا من الإدارة.${reason}\nتواصل مع الطاقم الإداري لمعرفة التفاصيل.`;
}

module.exports = [
  {
    name: "بنك",
    aliases: ["bank", "رصيد"],
    description: "الخدمات المصرفية: كشف الحساب، التحويل، الإيداع، السحب، والسجل.",
    usage: "/bank balance  •  /bank transfer user:<عضو> amount:<مبلغ>",
    arguments: [
      { name: "balance", required: false, description: "كشف حسابك أو حساب عضو" },
      { name: "transfer", required: false, description: "تحويل مبلغ لعضو آخر" },
      { name: "deposit", required: false, description: "إيداع من النقدي إلى المصرفي" },
      { name: "withdraw", required: false, description: "سحب من المصرفي إلى النقدي" },
      { name: "statement", required: false, description: "آخر الحركات المالية" },
      { name: "top", required: false, description: "أغنى الأعضاء" },
      { name: "tax", required: false, description: "حساب المبلغ الإجمالي شامل الضريبة لمبلغ صافٍ" }
    ],
    examples: ["/bank balance", "/bank transfer user:@أحمد amount:5000", "/bank deposit amount:1000", "/bank tax amount:10k"],
    category: "economy",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("بنك")
      .setDescription("الخدمات المصرفية")
      .addSubcommand((s) =>
        s.setName("balance").setDescription("كشف الحساب")
          .addUserOption((o) => o.setName("user").setDescription("عضو آخر (اختياري)"))
      )
      .addSubcommand((s) =>
        s.setName("transfer").setDescription("تحويل مبلغ لعضو")
          .addUserOption((o) => o.setName("user").setDescription("المستلم").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("المبلغ").setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName("reason").setDescription("سبب التحويل").setMaxLength(200))
      )
      .addSubcommand((s) =>
        s.setName("deposit").setDescription("إيداع في البنك")
          .addIntegerOption((o) => o.setName("amount").setDescription("المبلغ").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("withdraw").setDescription("سحب من البنك")
          .addIntegerOption((o) => o.setName("amount").setDescription("المبلغ").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("statement").setDescription("آخر الحركات المالية")
          .addUserOption((o) => o.setName("user").setDescription("عضو آخر (للإدارة)"))
      )
      .addSubcommand((s) => s.setName("top").setDescription("أغنى الأعضاء"))
      .addSubcommand((s) =>
        s.setName("tax").setDescription("حساب المبلغ الإجمالي شامل الضريبة لمبلغ صافٍ")
          .addStringOption((o) => o.setName("amount").setDescription("المبلغ الصافي، يقبل صيغة مختصرة مثل 10k أو 1.5m").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("panel").setDescription("نشر لوحة بنكية دائمة بالشكل الحديث في قناة")
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const svc = ctx.app.economyService;
      const guildId = ctx.guild.id;

      if (sub === "balance") {
        const user = ctx.interaction.options.getUser("user") || ctx.user;
        const account = svc.account(guildId, user.id);
        return ctx.reply({ embeds: [svc.balanceEmbed(guildId, user, account)] }, { ephemeral: user.id === ctx.user.id });
      }

      if (sub === "top") {
        const rows = ctx.app.economy.top(guildId, 10);
        if (!rows.length) return ctx.fail("errors.actionFailed", { details: "لا توجد حسابات بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🏆 أغنى الأعضاء",
            description: rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${svc.format(guildId, r.total)}`).join("\n"),
            color: ctx.color("primary")
          })]
        });
      }

      if (sub === "tax") {
        const raw = ctx.interaction.options.getString("amount");
        const net = parseAmount(raw);
        if (net === null || net <= 0) {
          return ctx.fail("errors.actionFailed", { details: "أدخل مبلغًا صالحًا، مثل `10000` أو `10k` أو `1.5m`." });
        }

        const result = svc.calculateTax(guildId, net);
        if (!result.ok) return ctx.fail("errors.actionFailed", { details: "نسبة الضريبة المضبوطة للسيرفر غير صالحة." });

        return ctx.reply({
          embeds: [buildEmbed({
            title: "🧮 حاسبة الضريبة",
            color: ctx.color("primary"),
            fields: [
              { name: "المبلغ الصافي المطلوب", value: svc.format(guildId, net), inline: true },
              { name: "نسبة الضريبة", value: `${result.percent}%`, inline: true },
              { name: "المبلغ الإجمالي المطلوب من العميل", value: `**${svc.format(guildId, result.gross)}**` }
            ]
          })]
        }, { ephemeral: true });
      }

      if (sub === "panel") {
        // نشر لوحة دائمة إجراء إداري — الأمر نفسه متاح للجميع لبقية العمليات
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");

        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel?.isTextBased?.()) return ctx.fail("errors.actionFailed", { details: "اختر قناة نصية." });

        const me = ctx.guild.members.me;
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        const payload = containerPayload({
          text:
            "## 🏦 النظام البنكي\n\n" +
            "مرحبًا بك في نظام البنك، يمكنك من خلاله إدارة حسابك البنكي والاستفادة من جميع الخدمات المتاحة.\n\n" +
            "👤 فتح حساب بنكي\n" +
            "💵 معرفة الرصيد\n" +
            "💲 تحويل المبالغ\n" +
            "📋 متابعة العمليات البنكية\n" +
            "📋 إدارة الحساب والخدمات",
          color: ctx.color("primary"),
          rows: bankPanelRows()
        });

        const message = await channel.send(payload).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });

        return ctx.success(`تم نشر اللوحة البنكية في <#${channel.id}>.`);
      }

      if (sub === "statement") {
        const target = ctx.interaction.options.getUser("user");
        // كشف حساب الغير للإدارة فقط، حفاظًا على خصوصية الأعضاء
        if (target && target.id !== ctx.user.id && ctx.app.permissions.resolveLevel(ctx.member) < Level.MODERATOR) {
          return ctx.fail("errors.noPermission");
        }
        const user = target || ctx.user;
        const rows = ctx.app.economy.statement(guildId, user.id, 10);
        return ctx.reply({ embeds: [svc.statementEmbed(guildId, user, rows)] }, { ephemeral: true });
      }

      const amount = amountOf(ctx, "amount");
      if (!amount) return ctx.fail("errors.invalidNumber");

      if (sub === "deposit") {
        const result = svc.deposit(guildId, ctx.user.id, amount);
        if (!result.ok) {
          if (result.reason === "frozen") return ctx.fail("errors.actionFailed", { details: frozenMessage(result.account) });
          const account = svc.account(guildId, ctx.user.id);
          return ctx.fail("errors.actionFailed", {
            details: `رصيدك النقدي غير كافٍ. المتاح: ${svc.format(guildId, account.wallet)}`
          });
        }
        return ctx.success(`تم إيداع **${svc.format(guildId, amount)}** في حسابك المصرفي.\n🏦 الرصيد المصرفي: ${svc.format(guildId, result.account.bank)}`);
      }

      if (sub === "withdraw") {
        const result = svc.withdraw(guildId, ctx.user.id, amount);
        if (!result.ok) {
          if (result.reason === "frozen") return ctx.fail("errors.actionFailed", { details: frozenMessage(result.account) });
          const account = svc.account(guildId, ctx.user.id);
          return ctx.fail("errors.actionFailed", {
            details: `رصيدك المصرفي غير كافٍ. المتاح: ${svc.format(guildId, account.bank)}`
          });
        }
        return ctx.success(`تم سحب **${svc.format(guildId, amount)}**.\n💵 النقدي: ${svc.format(guildId, result.account.wallet)}`);
      }

      // transfer
      const target = ctx.interaction.options.getUser("user");
      if (!target) return ctx.fail("errors.userNotFound");
      if (target.bot) return ctx.fail("errors.actionFailed", { details: "لا يمكن التحويل إلى بوت." });

      const result = svc.transfer(guildId, ctx.user.id, target.id, amount, ctx.interaction.options.getString("reason"));

      if (!result.ok) {
        if (result.reason === "frozen") return ctx.fail("errors.actionFailed", { details: frozenMessage(result.account) });
        const messages = {
          self: "ما تقدر تحوّل لنفسك.",
          overLimit: `الحد الأقصى للتحويل الواحد: ${svc.format(guildId, result.limit)}`,
          insufficient: `رصيدك المصرفي غير كافٍ. المتاح: ${svc.format(guildId, svc.account(guildId, ctx.user.id).bank)}`
        };
        return ctx.fail("errors.actionFailed", { details: messages[result.reason] || "فشل التحويل." });
      }

      const feeNote = result.fee ? `\nالرسوم: ${svc.format(guildId, result.fee)}` : "";
      return ctx.success(
        `تم تحويل **${svc.format(guildId, amount)}** إلى <@${target.id}>${feeNote}\n🏦 رصيدك: ${svc.format(guildId, result.sender.bank)}`
      );
    }
  },

  {
    name: "ادارة_بنك",
    aliases: ["bank-admin", "ادارة_البنك"],
    description: "إدارة أرصدة الأعضاء: إضافة، سحب، تصفير، إيقاف/تفعيل الخدمات، وإحصائيات.",
    usage: "/bank-admin add user:<عضو> amount:<مبلغ>",
    arguments: [
      { name: "add", required: false, description: "إضافة رصيد لعضو" },
      { name: "remove", required: false, description: "سحب رصيد من عضو" },
      { name: "set", required: false, description: "تحديد رصيد عضو بالضبط" },
      { name: "freeze", required: false, description: "إيقاف الخدمات البنكية لعضو" },
      { name: "unfreeze", required: false, description: "إعادة تفعيل الخدمات البنكية" },
      { name: "stats", required: false, description: "إحصائيات اقتصاد السيرفر" }
    ],
    examples: [
      "/bank-admin add user:@أحمد amount:50000",
      "/bank-admin set user:@أحمد wallet:0 bank:1000",
      "/bank-admin freeze user:@أحمد reason:اشتباه غسيل أموال"
    ],
    category: "economy",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("ادارة_بنك")
      .setDescription("إدارة أرصدة الأعضاء")
      .addSubcommand((s) =>
        s.setName("add").setDescription("إضافة رصيد")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("المبلغ").setRequired(true).setMinValue(1))
          .addStringOption((o) =>
            o.setName("target").setDescription("لأي رصيد")
              .addChoices({ name: "مصرفي", value: "bank" }, { name: "نقدي", value: "wallet" })
          )
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200))
      )
      .addSubcommand((s) =>
        s.setName("remove").setDescription("سحب رصيد")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("المبلغ").setRequired(true).setMinValue(1))
          .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(200))
      )
      .addSubcommand((s) =>
        s.setName("set").setDescription("تحديد الرصيد بالضبط")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addIntegerOption((o) => o.setName("wallet").setDescription("النقدي").setRequired(true).setMinValue(0))
          .addIntegerOption((o) => o.setName("bank").setDescription("المصرفي").setRequired(true).setMinValue(0))
      )
      .addSubcommand((s) =>
        s.setName("freeze").setDescription("إيقاف الخدمات البنكية لعضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("reason").setDescription("سبب الإيقاف").setMaxLength(300))
      )
      .addSubcommand((s) =>
        s.setName("unfreeze").setDescription("إعادة تفعيل الخدمات البنكية")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      )
      .addSubcommand((s) => s.setName("stats").setDescription("إحصائيات الاقتصاد"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const svc = ctx.app.economyService;
      const guildId = ctx.guild.id;

      if (sub === "stats") {
        const totals = ctx.app.economy.totalMoney(guildId);
        const violations = ctx.app.violations.stats(guildId);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📊 إحصائيات الاقتصاد",
            color: ctx.color("primary"),
            fields: [
              { name: "الحسابات", value: `\`${totals.accounts}\``, inline: true },
              { name: "إجمالي السيولة", value: svc.format(guildId, totals.total), inline: true },
              { name: "المخالفات غير المسددة", value: `\`${violations.unpaid}\``, inline: true },
              { name: "المستحق على الأعضاء", value: svc.format(guildId, violations.outstanding), inline: true },
              { name: "الرحلات المفتوحة", value: `\`${ctx.app.flights.listOpen(guildId).length}\``, inline: true },
              { name: "قروض بانتظار الموافقة", value: `\`${ctx.app.economy.pendingLoans(guildId).length}\``, inline: true }
            ]
          })]
        }, { ephemeral: true });
      }

      const user = ctx.interaction.options.getUser("user");
      if (!user) return ctx.fail("errors.userNotFound");
      if (user.bot) return ctx.fail("errors.actionFailed", { details: "البوتات ما لها حسابات." });

      if (sub === "freeze") {
        const reason = ctx.interaction.options.getString("reason");
        const account = ctx.app.economy.freeze({ guildId, userId: user.id, reason, actorId: ctx.user.id });

        // إشعار العضو في الخاص، بلا كسر تنفيذ الأمر لو الخاص مقفل
        await user.send({
          embeds: [buildEmbed({
            title: "⛔ إيقاف الخدمات البنكية",
            description: `تم إيقاف خدماتك البنكية في **${ctx.guild.name}**.${reason ? `\nالسبب: ${reason}` : ""}`,
            color: ctx.color("danger")
          })]
        }).catch(() => {});

        return ctx.success(
          `تم إيقاف الخدمات البنكية لـ <@${user.id}>.\n` +
          `الرصيد الحالي محفوظ (💵 ${svc.format(guildId, account.wallet)} • 🏦 ${svc.format(guildId, account.bank)}) لكنه لا يقدر يحوّل أو يودع أو يسحب حتى تُعاد التفعيل.`
        );
      }

      if (sub === "unfreeze") {
        const changed = ctx.app.economy.unfreeze({ guildId, userId: user.id });
        if (!changed) return ctx.fail("errors.actionFailed", { details: "حساب هذا العضو غير موقوف أصلًا." });

        await user.send({
          embeds: [buildEmbed({
            title: "✅ إعادة تفعيل الخدمات البنكية",
            description: `تم إعادة تفعيل خدماتك البنكية في **${ctx.guild.name}**.`,
            color: ctx.color("success")
          })]
        }).catch(() => {});

        return ctx.success(`تم إعادة تفعيل الخدمات البنكية لـ <@${user.id}>.`);
      }

      if (sub === "set") {
        const wallet = ctx.interaction.options.getInteger("wallet");
        const bank = ctx.interaction.options.getInteger("bank");
        const account = ctx.app.economy.setBalance({ guildId, userId: user.id, wallet, bank, actorId: ctx.user.id });
        return ctx.success(
          `تم تحديد رصيد <@${user.id}>\n💵 نقدي: ${svc.format(guildId, account.wallet)}\n🏦 مصرفي: ${svc.format(guildId, account.bank)}`
        );
      }

      const amount = amountOf(ctx, "amount");
      if (!amount) return ctx.fail("errors.invalidNumber");
      const reason = ctx.interaction.options.getString("reason");

      if (sub === "add") {
        const target = ctx.interaction.options.getString("target") || "bank";
        const account = svc.add(guildId, user.id, amount, { target, actorId: ctx.user.id, reason });
        return ctx.success(
          `تمت إضافة **${svc.format(guildId, amount)}** إلى <@${user.id}>\n📊 الإجمالي: ${svc.format(guildId, svc.total(account))}`
        );
      }

      const result = svc.remove(guildId, user.id, amount, { actorId: ctx.user.id, reason });
      if (!result.ok) {
        return ctx.fail("errors.actionFailed", { details: "رصيد العضو غير كافٍ للخصم المطلوب." });
      }
      return ctx.success(
        `تم خصم **${svc.format(guildId, amount)}** من <@${user.id}>\n📊 الإجمالي: ${svc.format(guildId, svc.total(result.account))}`
      );
    }
  }
];
