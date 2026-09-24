const crypto = require("node:crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, timestamp } = require("../../core/utils/helpers");

/**
 * نظام السحوبات.
 * سحب الفائزين محمي بعملية `markEnded` الذرّية: مهما تعدد المستدعون
 * (المؤقّت الدوري + زر الإنهاء اليدوي)، ينجح واحد فقط ولا يتكرر السحب.
 */
class GiveawayService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    // فحص دوري بدل مؤقّت لكل سحب، ليبقى العدد ثابتًا مهما كثرت السحوبات
    this.timer = setInterval(() => this.tick().catch(() => {}), 15000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    for (const giveaway of this.app.giveaways.listDue()) {
      await this.end(giveaway.id).catch((err) =>
        this.app.errors.capture(err, { system: "giveaways", guildId: giveaway.guild_id })
      );
    }
  }

  buildEmbed(giveaway, { ended = false, winners = [] } = {}) {
    const entries = this.app.giveaways.entryCount(giveaway.id);
    const fields = [
      { name: "عدد الفائزين", value: `\`${giveaway.winners_count}\``, inline: true },
      { name: "المشاركون", value: `\`${entries}\``, inline: true },
      { name: ended ? "انتهى" : "ينتهي", value: timestamp(giveaway.ends_at, "R"), inline: true },
      { name: "المُنظِّم", value: `<@${giveaway.host_id}>`, inline: true }
    ];
    if (giveaway.required_role_id) fields.push({ name: "شرط الدخول", value: `<@&${giveaway.required_role_id}>`, inline: true });
    if (giveaway.bonus_role_id) fields.push({ name: "فرص إضافية", value: `<@&${giveaway.bonus_role_id}> ×${giveaway.bonus_entries}`, inline: true });
    // شروط وفرص إضافية من إضافة السحوبات المتقدمة (إن وُجدت)
    if (this.app.giveawaysPlus) fields.push(...this.app.giveawaysPlus.extraFields(giveaway));
    if (ended) {
      fields.push({
        name: "الفائزون",
        value: winners.length ? winners.map((id) => `<@${id}>`).join("\n") : "لا يوجد مشاركون مؤهلون."
      });
    }

    return buildEmbed({
      title: `🎁 ${giveaway.prize}`,
      description: `${giveaway.description ? `${giveaway.description}\n\n` : ""}${ended ? "**انتهى السحب**" : "اضغط الزر أدناه للمشاركة!"}`,
      color: this.app.config.color(ended ? "neutral" : "success"),
      fields
    });
  }

  buttons(giveaway, ended = false) {
    if (ended) {
      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`giveaway:reroll:${giveaway.id}`).setLabel("إعادة السحب").setEmoji("🔄").setStyle(ButtonStyle.Secondary)
        )
      ];
    }
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`giveaway:enter:${giveaway.id}`).setLabel("مشاركة").setEmoji("🎉").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`giveaway:end:${giveaway.id}`).setLabel("إنهاء الآن").setEmoji("⏹️").setStyle(ButtonStyle.Danger)
      )
    ];
  }

  /** يتحقق من أهلية العضو للدخول. */
  eligibility(giveaway, member) {
    if (giveaway.required_role_id && !member.roles.cache.has(giveaway.required_role_id)) {
      return { ok: false, message: `يجب أن تملك <@&${giveaway.required_role_id}> للمشاركة.` };
    }
    if (giveaway.min_account_age_ms) {
      const age = Date.now() - member.user.createdTimestamp;
      if (age < giveaway.min_account_age_ms) {
        return { ok: false, message: "حسابك جديد جدًا للمشاركة في هذا السحب." };
      }
    }
    if (this.app.giveawaysPlus) return this.app.giveawaysPlus.eligibility(giveaway, member);
    return { ok: true };
  }

  entryWeight(giveaway, member) {
    let weight = 1;
    if (giveaway.bonus_role_id && member.roles.cache.has(giveaway.bonus_role_id)) {
      weight = Math.max(1, giveaway.bonus_entries || 1);
    }
    if (this.app.giveawaysPlus) weight = Math.max(weight, this.app.giveawaysPlus.weight(giveaway, member));
    return weight;
  }

  /** اختيار عشوائي مرجّح بعدد الفرص، بدون تكرار الفائز نفسه. */
  draw(entries, count) {
    const pool = [];
    for (const entry of entries) {
      for (let i = 0; i < Math.max(1, entry.entries); i++) pool.push(entry.user_id);
    }
    const winners = [];
    const chosen = new Set();
    while (winners.length < count && pool.length > 0) {
      const index = crypto.randomInt(0, pool.length);
      const userId = pool[index];
      if (!chosen.has(userId)) {
        chosen.add(userId);
        winners.push(userId);
      }
      // إزالة كل فرص هذا الشخص حتى لا يُختار مرتين
      for (let i = pool.length - 1; i >= 0; i--) if (pool[i] === userId) pool.splice(i, 1);
    }
    return winners;
  }

  async end(giveawayId, { rerolledBy = null } = {}) {
    const giveaway = this.app.giveaways.getById(giveawayId);
    if (!giveaway) return { ok: false, reason: "notFound" };

    if (!rerolledBy) {
      // البوابة الذرّية: تنجح مرة واحدة فقط في عمر السحب
      if (!this.app.giveaways.markEnded(giveawayId)) return { ok: false, reason: "alreadyEnded" };
    }

    const entries = this.app.giveaways.entries(giveawayId);
    const winners = this.draw(entries, giveaway.winners_count);
    if (winners.length) this.app.giveaways.saveWinners(giveawayId, winners);

    const channel = await this.app.client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (channel?.isTextBased() && giveaway.message_id) {
      const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
      if (message) {
        await message.edit({ embeds: [this.buildEmbed(giveaway, { ended: true, winners })], components: this.buttons(giveaway, true) }).catch(() => {});
      }
      const announcement = winners.length
        ? `🎉 مبروك ${winners.map((id) => `<@${id}>`).join(" ")} — فزتم بـ **${giveaway.prize}**!`
        : `😔 انتهى السحب على **${giveaway.prize}** بدون مشاركين مؤهلين.`;
      await channel.send({ content: announcement }).catch(() => {});
    }

    this.app.bus.emitSafe("giveaway:ended", { giveaway, winners, rerolledBy });
    return { ok: true, winners };
  }
}

module.exports = GiveawayService;
