const {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, extractId } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * الجسر بين لوحات الإمبيد المبنية يدويًا وأنظمة الاقتصاد.
 *
 * يسمح بأن يكون زر داخل لوحة `BanK PaneL` منفّذًا حقيقيًا لعملية بنكية،
 * بدل أن يعرض إمبيدًا شكليًا فقط.
 *
 * كل إجراء يعيد فحص تفعيل النظام وصلاحية العضو من الخادم عند كل ضغطة.
 */

const ACTIONS = {
  "bank:open": { label: "فتح حساب بنكي", system: "economy", level: Level.EVERYONE },
  "bank:balance": { label: "كشف حساب", system: "economy", level: Level.EVERYONE },
  "bank:transfer": { label: "تحويل مبلغ", system: "economy", level: Level.EVERYONE },
  "bank:deposit": { label: "إيداع مبلغ", system: "economy", level: Level.EVERYONE },
  "bank:withdraw": { label: "سحب مبلغ", system: "economy", level: Level.EVERYONE },
  "bank:statement": { label: "سجل الحركات", system: "economy", level: Level.EVERYONE },
  "bank:top": { label: "أغنى الأعضاء", system: "economy", level: Level.EVERYONE },
  "violation:my": { label: "مخالفاتي", system: "violations", level: Level.EVERYONE },
  "violation:pay": { label: "سداد مخالفة", system: "violations", level: Level.EVERYONE },
  "violation:issue": { label: "تسجيل مخالفة", system: "violations", level: Level.STAFF },
  "violation:lookup": { label: "استعلام عن مخالفات عضو", system: "violations", level: Level.STAFF },
  "flight:list": { label: "الرحلات المتاحة", system: "flights", level: Level.EVERYONE },
  "flight:book": { label: "حجز تذكرة (باختيار الرحلة من قائمة)", system: "flights", level: Level.EVERYONE },
  "flight:join": { label: "الانضمام لرحلة محددة مباشرة", system: "flights", level: Level.EVERYONE, arg: "رمز الرحلة" },
  "flight:mine": { label: "حجوزاتي", system: "flights", level: Level.EVERYONE }
};

const SYSTEM_FLAGS = { economy: "economy.enabled", violations: "violations.enabled", flights: "flights.enabled" };

/**
 * صفوف أزرار اللوحة البنكية الدائمة (تُستخدم في `/بنك panel` وفي محرّر الإمبيد
 * عبر الإجراء `sys:bank:*`). كل زر customId مطابق تمامًا لمفتاح في ACTIONS أعلاه،
 * فتشتغل بنفس منطق `_dispatch` بلا أي تكرار للكود.
 */
function bankPanelRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sys:bank:open").setLabel("فتح حساب").setEmoji("💳").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("sys:bank:withdraw").setLabel("سحب مبلغ").setEmoji("💸").setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sys:bank:deposit").setLabel("إيداع مبلغ").setEmoji("💰").setStyle(ButtonStyle.Primary)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("sys:bank:balance").setLabel("كشف حساب").setEmoji("📄").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("sys:bank:transfer").setLabel("تحويل مبلغ").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function modalInput(id, label, style = TextInputStyle.Short, { required = true, placeholder, max } = {}) {
  const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required);
  if (placeholder) input.setPlaceholder(placeholder);
  if (max) input.setMaxLength(max);
  return new ActionRowBuilder().addComponents(input);
}

function deny(interaction, app, key = "errors.noPermission") {
  return safeReply(interaction, { content: app.i18n.t(key, { emoji: app.config.emoji("error") }), flags: 64 });
}

module.exports = {
  prefix: "sys",
  ACTIONS,
  bankPanelRows,

  /** يتحقق أن الإجراء معروف والنظام مفعّل والعضو مخوّل. */
  guard(interaction, app, key) {
    const meta = ACTIONS[key];
    if (!meta) return { ok: false, message: `${app.config.emoji("error")} إجراء غير معروف: \`${key}\`` };

    const enabled = app.guildConfig.value(interaction.guild.id, SYSTEM_FLAGS[meta.system]);
    if (!enabled) {
      return { ok: false, message: `${app.config.emoji("error")} نظام **${meta.label}** معطّل في هذا السيرفر.` };
    }
    if (app.permissions.resolveLevel(interaction.member) < meta.level) {
      return { ok: false, message: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }) };
    }
    return { ok: true, meta };
  },

  /** يُستدعى من EmbedService عند ضغط زر إجراؤه من نوع system. */
  async run(interaction, app, key) {
    // الإجراء قد يحمل وسيطًا (flight:join:MT-101) — نفصل المفتاح عن الوسيط
    const segments = String(key).split(":");
    const baseKey = segments.slice(0, 2).join(":");
    const argument = segments.slice(2).join(":") || undefined;

    const check = this.guard(interaction, app, baseKey);
    if (!check.ok) return safeReply(interaction, { content: check.message, flags: 64 });
    return this._dispatch(interaction, app, baseKey, argument);
  },

  /** يستقبل ردود المودالات والقوائم التي فتحتها الأزرار. */
  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    // sys:<نظام>:<إجراء>:<مرحلة>
    const key = `${parts[1]}:${parts[2]}`;
    const stage = parts[3];

    const check = this.guard(interaction, app, key);
    if (!check.ok) return safeReply(interaction, { content: check.message, flags: 64 });

    return this._dispatch(interaction, app, key, stage);
  },

  async _dispatch(interaction, app, key, stage) {
    const guild = interaction.guild;
    const member = interaction.member;
    const eco = app.economyService;

    switch (key) {
      // ---------------- البنك ----------------
      case "bank:open": {
        const existed = app.economy.exists(guild.id, member.id);
        const account = eco.account(guild.id, member.id);
        return safeReply(interaction, {
          content: existed
            ? `${app.config.emoji("success")} عندك حساب بنكي مفعّل بالفعل.`
            : `${app.config.emoji("success")} تم فتح حسابك البنكي بنجاح!`,
          embeds: [eco.balanceEmbed(guild.id, member.user, account)],
          flags: 64
        });
      }

      case "bank:balance": {
        const account = eco.account(guild.id, member.id);
        return safeReply(interaction, { embeds: [eco.balanceEmbed(guild.id, member.user, account)], flags: 64 });
      }

      case "bank:statement": {
        const rows = app.economy.statement(guild.id, member.id, 10);
        return safeReply(interaction, { embeds: [eco.statementEmbed(guild.id, member.user, rows)], flags: 64 });
      }

      case "bank:top": {
        const rows = app.economy.top(guild.id, 10);
        if (!rows.length) return safeReply(interaction, { content: "لا توجد حسابات بعد.", flags: 64 });
        return safeReply(interaction, {
          embeds: [buildEmbed({
            title: "🏆 أغنى الأعضاء",
            description: rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${eco.format(guild.id, r.total)}`).join("\n"),
            color: app.config.color("primary")
          })],
          flags: 64
        });
      }

      case "bank:transfer": {
        if (stage !== "submit") {
          const modal = new ModalBuilder().setCustomId("sys:bank:transfer:submit").setTitle("تحويل مبلغ");
          modal.addComponents(
            modalInput("user", "آيدي المستلم أو منشن", TextInputStyle.Short, { placeholder: "123456789012345678" }),
            modalInput("amount", "المبلغ", TextInputStyle.Short, { placeholder: "5000", max: 12 }),
            modalInput("reason", "سبب التحويل", TextInputStyle.Short, { required: false, max: 200 })
          );
          return safeModal(interaction, modal);
        }

        const targetId = extractId(interaction.fields.getTextInputValue("user"));
        const amount = parseInt(interaction.fields.getTextInputValue("amount").replace(/[^\d]/g, ""), 10);
        if (!targetId) return safeReply(interaction, { content: `${app.config.emoji("error")} آيدي المستلم غير صالح.`, flags: 64 });
        if (!amount || amount <= 0) return safeReply(interaction, { content: `${app.config.emoji("error")} المبلغ غير صالح.`, flags: 64 });

        const target = await guild.members.fetch(targetId).catch(() => null);
        if (!target) return safeReply(interaction, { content: app.i18n.t("errors.memberNotFound", { emoji: app.config.emoji("error") }), flags: 64 });
        if (target.user.bot) return safeReply(interaction, { content: `${app.config.emoji("error")} ما ينفع تحويل لبوت.`, flags: 64 });

        const result = eco.transfer(guild.id, member.id, targetId, amount, interaction.fields.getTextInputValue("reason") || null);
        if (!result.ok) {
          if (result.reason === "frozen") {
            const reasonNote = result.account?.frozen_reason ? `\nالسبب: ${result.account.frozen_reason}` : "";
            return safeReply(interaction, { content: `⛔ خدماتك البنكية موقوفة حاليًا.${reasonNote}`, flags: 64 });
          }
          const messages = {
            self: "ما تقدر تحوّل لنفسك.",
            overLimit: `الحد الأقصى للتحويل: ${eco.format(guild.id, result.limit)}`,
            insufficient: `رصيدك المصرفي ما يكفي. المتاح: ${eco.format(guild.id, eco.account(guild.id, member.id).bank)}`
          };
          return safeReply(interaction, { content: `${app.config.emoji("error")} ${messages[result.reason] || "فشل التحويل."}`, flags: 64 });
        }

        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} تم تحويل **${eco.format(guild.id, amount)}** إلى <@${targetId}>` +
            (result.fee ? `\nالرسوم: ${eco.format(guild.id, result.fee)}` : "") +
            `\n🏦 رصيدك: ${eco.format(guild.id, result.sender.bank)}`,
          flags: 64
        });
      }

      case "bank:deposit":
      case "bank:withdraw": {
        const isDeposit = key === "bank:deposit";
        if (stage !== "submit") {
          const modal = new ModalBuilder()
            .setCustomId(`sys:bank:${isDeposit ? "deposit" : "withdraw"}:submit`)
            .setTitle(isDeposit ? "إيداع مبلغ" : "سحب مبلغ");
          modal.addComponents(modalInput("amount", "المبلغ", TextInputStyle.Short, { placeholder: "1000", max: 12 }));
          return safeModal(interaction, modal);
        }

        const amount = parseInt(interaction.fields.getTextInputValue("amount").replace(/[^\d]/g, ""), 10);
        if (!amount || amount <= 0) return safeReply(interaction, { content: `${app.config.emoji("error")} المبلغ غير صالح.`, flags: 64 });

        const result = isDeposit ? eco.deposit(guild.id, member.id, amount) : eco.withdraw(guild.id, member.id, amount);
        if (!result.ok) {
          if (result.reason === "frozen") {
            const reasonNote = result.account?.frozen_reason ? `\nالسبب: ${result.account.frozen_reason}` : "";
            return safeReply(interaction, { content: `⛔ خدماتك البنكية موقوفة حاليًا.${reasonNote}`, flags: 64 });
          }
          const account = eco.account(guild.id, member.id);
          const available = isDeposit ? account.wallet : account.bank;
          return safeReply(interaction, {
            content: `${app.config.emoji("error")} رصيدك ${isDeposit ? "النقدي" : "المصرفي"} ما يكفي. المتاح: ${eco.format(guild.id, available)}`,
            flags: 64
          });
        }

        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} تم ${isDeposit ? "إيداع" : "سحب"} **${eco.format(guild.id, amount)}**\n` +
            `💵 نقدي: ${eco.format(guild.id, result.account.wallet)} • 🏦 مصرفي: ${eco.format(guild.id, result.account.bank)}`,
          flags: 64
        });
      }

      // ---------------- المخالفات ----------------
      case "violation:my": {
        const rows = app.violations.listByTarget(guild.id, member.id, { limit: 15 });
        return safeReply(interaction, { embeds: [app.violationService.listEmbed(guild, member.user, rows)], flags: 64 });
      }

      case "violation:lookup": {
        if (stage !== "submit") {
          const modal = new ModalBuilder().setCustomId("sys:violation:lookup:submit").setTitle("استعلام عن مخالفات");
          modal.addComponents(modalInput("user", "آيدي العضو أو منشن", TextInputStyle.Short));
          return safeModal(interaction, modal);
        }
        const targetId = extractId(interaction.fields.getTextInputValue("user"));
        if (!targetId) return safeReply(interaction, { content: `${app.config.emoji("error")} آيدي غير صالح.`, flags: 64 });
        const user = await app.client.users.fetch(targetId).catch(() => null);
        const rows = app.violations.listByTarget(guild.id, targetId, { limit: 15 });
        return safeReply(interaction, {
          embeds: [app.violationService.listEmbed(guild, user || { id: targetId }, rows)],
          flags: 64
        });
      }

      case "violation:pay": {
        if (stage !== "submit") {
          const unpaid = app.violations.listByTarget(guild.id, member.id, { unpaidOnly: true, limit: 25 });
          if (!unpaid.length) {
            return safeReply(interaction, { content: `${app.config.emoji("success")} ما عليك أي مخالفات غير مسددة.`, flags: 64 });
          }
          // قائمة بالمخالفات المستحقة بدل مطالبة العضو بحفظ الأرقام
          const menu = new StringSelectMenuBuilder()
            .setCustomId("sys:violation:pay:submit")
            .setPlaceholder("اختر المخالفة المراد سدادها")
            .addOptions(unpaid.map((v) => ({
              label: `#${v.number} • ${String(v.kind).slice(0, 60)}`,
              description: eco.format(guild.id, v.amount),
              value: String(v.number)
            })));
          return safeReply(interaction, {
            embeds: [buildEmbed({
              title: "💳 تسديد مخالفة",
              description: `المستحق عليك: **${eco.format(guild.id, app.violations.unpaidTotal(guild.id, member.id))}**`,
              color: app.config.color("warning")
            })],
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: 64
          });
        }

        const number = parseInt(interaction.values[0], 10);
        const result = await app.violationService.pay({ guild, member, number });
        if (!result.ok) {
          const messages = {
            notFound: "ما لقيت المخالفة.",
            alreadyPaid: "مسددة من قبل.",
            cancelled: "ملغاة.",
            notYours: "هذي المخالفة مو عليك.",
            insufficient: result.needed
              ? `رصيدك ما يكفي. المطلوب ${eco.format(guild.id, result.needed)} والمتاح ${eco.format(guild.id, eco.total(result.account))}`
              : "رصيدك غير كافٍ."
          };
          return safeReply(interaction, { content: `${app.config.emoji("error")} ${messages[result.reason] || "فشل السداد."}`, flags: 64 });
        }

        const remaining = app.violations.unpaidTotal(guild.id, member.id);
        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} تم سداد المخالفة **#${number}** بمبلغ ${eco.format(guild.id, result.record.amount)}\n` +
            `📊 رصيدك: ${eco.format(guild.id, eco.total(result.account))}` +
            (remaining > 0 ? `\n⚠️ باقي عليك: ${eco.format(guild.id, remaining)}` : "\n✅ ما عليك مخالفات"),
          flags: 64
        });
      }

      case "violation:issue": {
        if (stage !== "submit") {
          const modal = new ModalBuilder().setCustomId("sys:violation:issue:submit").setTitle("تسجيل مخالفة");
          modal.addComponents(
            modalInput("user", "آيدي العضو أو منشن", TextInputStyle.Short),
            modalInput("kind", "نوع المخالفة", TextInputStyle.Short, { max: 100 }),
            modalInput("amount", "قيمة المخالفة", TextInputStyle.Short, { placeholder: "500", max: 12 }),
            modalInput("notes", "ملاحظات", TextInputStyle.Paragraph, { required: false, max: 500 })
          );
          return safeModal(interaction, modal);
        }

        const targetId = extractId(interaction.fields.getTextInputValue("user"));
        const amount = parseInt(interaction.fields.getTextInputValue("amount").replace(/[^\d]/g, ""), 10);
        if (!targetId) return safeReply(interaction, { content: `${app.config.emoji("error")} آيدي غير صالح.`, flags: 64 });
        if (!amount || amount <= 0) return safeReply(interaction, { content: `${app.config.emoji("error")} المبلغ غير صالح.`, flags: 64 });

        const target = await guild.members.fetch(targetId).catch(() => null);
        if (!target) return safeReply(interaction, { content: app.i18n.t("errors.memberNotFound", { emoji: app.config.emoji("error") }), flags: 64 });

        const allowed = app.permissions.canActOn(member, target);
        if (!allowed.ok) return deny(interaction, app, `errors.${allowed.reason}`);

        const record = await app.violationService.issue({
          guild,
          officer: member,
          target,
          kind: interaction.fields.getTextInputValue("kind"),
          amount,
          notes: interaction.fields.getTextInputValue("notes") || null
        });

        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} سُجّلت المخالفة **#${record.number}** على <@${targetId}> بمبلغ ${eco.format(guild.id, amount)}\n` +
            `إجمالي المستحق عليه: ${eco.format(guild.id, app.violations.unpaidTotal(guild.id, targetId))}`,
          flags: 64
        });
      }

      // ---------------- الطيران ----------------
      case "flight:list": {
        return safeReply(interaction, { embeds: [app.flightService.listEmbed(guild, app.flights.listOpen(guild.id))], flags: 64 });
      }

      case "flight:mine": {
        const open = app.flights.listAll(guild.id, 50);
        const mine = open.filter((f) => app.flights.booking(f.id, member.id));
        if (!mine.length) return safeReply(interaction, { content: "ما عندك أي حجوزات.", flags: 64 });
        return safeReply(interaction, {
          embeds: [buildEmbed({
            title: "🎫 حجوزاتي",
            description: mine.map((f) => {
              const b = app.flights.booking(f.id, member.id);
              return `\`${f.code}\` → **${f.destination}** • مقعد \`#${b.seat_no}\` ${b.paid ? "✅" : "⏳"}`;
            }).join("\n"),
            color: app.config.color("primary")
          })],
          flags: 64
        });
      }

      case "flight:book": {
        if (stage !== "submit") {
          const open = app.flights.listOpen(guild.id);
          if (!open.length) return safeReply(interaction, { content: "ما فيه رحلات مفتوحة حاليًا.", flags: 64 });

          const menu = new StringSelectMenuBuilder()
            .setCustomId("sys:flight:book:submit")
            .setPlaceholder("اختر الرحلة")
            .addOptions(open.slice(0, 25).map((f) => ({
              label: `${f.code} → ${String(f.destination).slice(0, 50)}`,
              description: `${eco.format(guild.id, f.price)} • ${f.seats_taken}/${f.seats} مقعد`,
              value: String(f.id)
            })));

          return safeReply(interaction, {
            embeds: [buildEmbed({
              title: "✈️ حجز تذكرة",
              description: "اختر الرحلة من القائمة. سيُخصم ثمن التذكرة من رصيدك تلقائيًا.",
              color: app.config.color("primary")
            })],
            components: [new ActionRowBuilder().addComponents(menu)],
            flags: 64
          });
        }

        const flight = app.flights.getById(parseInt(interaction.values[0], 10));
        if (!flight || flight.guild_id !== guild.id) {
          return safeReply(interaction, { content: `${app.config.emoji("error")} الرحلة لم تعد موجودة.`, flags: 64 });
        }

        const result = await app.flightService.book({ guild, member, flight });
        if (!result.ok) {
          const messages = {
            closed: "الحجز مغلق على هذي الرحلة.",
            full: "ما فيه مقاعد متاحة.",
            already: "أنت حاجز في هذي الرحلة من قبل.",
            insufficient: result.needed
              ? `رصيدك ما يكفي. السعر ${eco.format(guild.id, result.needed)} والمتاح ${eco.format(guild.id, eco.total(result.account))}`
              : "رصيدك غير كافٍ."
          };
          return safeReply(interaction, { content: `${app.config.emoji("error")} ${messages[result.reason] || "فشل الحجز."}`, flags: 64 });
        }

        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} تم حجز مقعدك في رحلة \`${flight.code}\` إلى **${flight.destination}**\n` +
            `🎫 المقعد: **#${result.seatNo}**` +
            (flight.price ? `\n💸 خُصم: ${eco.format(guild.id, flight.price)}` : ""),
          flags: 64
        });
      }

      // حجز رحلة محددة مباشرة بلا قائمة اختيار — للأزرار المرتبطة برحلة بعينها
      case "flight:join": {
        // رمز الرحلة يأتي في نفس موضع "المرحلة" من الـ customId: sys:flight:join:<الرمز>
        const code = stage;
        if (!code) return safeReply(interaction, { content: `${app.config.emoji("error")} لم يُحدَّد رمز الرحلة.`, flags: 64 });

        const flight = app.flights.getByCode(guild.id, code);
        if (!flight) {
          return safeReply(interaction, { content: `${app.config.emoji("error")} ما لقيت رحلة برمز \`${code}\`.`, flags: 64 });
        }

        const result = await app.flightService.book({ guild, member, flight });
        if (!result.ok) {
          const messages = {
            closed: "الحجز مغلق على هذي الرحلة.",
            full: "ما فيه مقاعد متاحة.",
            already: "أنت حاجز في هذي الرحلة من قبل.",
            insufficient: result.needed
              ? `رصيدك ما يكفي. السعر ${eco.format(guild.id, result.needed)} والمتاح ${eco.format(guild.id, eco.total(result.account))}`
              : "رصيدك غير كافٍ."
          };
          return safeReply(interaction, { content: `${app.config.emoji("error")} ${messages[result.reason] || "فشل الحجز."}`, flags: 64 });
        }

        return safeReply(interaction, {
          content:
            `${app.config.emoji("success")} تم حجز مقعدك في رحلة \`${flight.code}\` إلى **${flight.destination}**\n` +
            `🎫 المقعد: **#${result.seatNo}**` +
            (flight.price ? `\n💸 خُصم: ${eco.format(guild.id, flight.price)}` : ""),
          flags: 64
        });
      }

      default:
        return safeReply(interaction, { content: `${app.config.emoji("error")} إجراء غير مدعوم.`, flags: 64 });
    }
  }
};
