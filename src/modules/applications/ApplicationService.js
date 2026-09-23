const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../core/utils/helpers");

const STATUS = {
  pending: { label: "بانتظار المراجعة", color: "warning", icon: "⏳" },
  accepted: { label: "تم قبول الطلب", color: "success", icon: "✅" },
  rejected: { label: "تم رفض الطلب", color: "danger", icon: "❌" }
};

/**
 * نظام التقديمات.
 *
 * الدورة: العضو يعبّي النموذج → يُنشر طلب مرقّم في قناة المراجعة بأزرار قبول ورفض
 * → الإداري يقرر → تُعدَّل رسالة الطلب لتعرض القرار واسم المراجع
 * → تُعطى الرتبة ويُبلَّغ العضو في الخاص.
 *
 * القرار ذرّي في قاعدة البيانات، فلا يمكن قبول ورفض نفس الطلب معًا.
 */
class ApplicationService {
  constructor(app) {
    this.app = app;
  }

  /** يتحقق من أهلية العضو للتقديم قبل عرض النموذج. */
  eligibility(guildId, type, userId) {
    if (!type.enabled) return { ok: false, reason: "disabled" };

    const pending = this.app.applications.pendingForUser(guildId, type.id, userId);
    if (pending) return { ok: false, reason: "pending", record: pending };

    if (type.cooldown_ms) {
      const last = this.app.applications.lastForUser(guildId, type.id, userId);
      if (last && last.status === "rejected") {
        const elapsed = Date.now() - (last.reviewed_at || last.created_at);
        if (elapsed < type.cooldown_ms) {
          return { ok: false, reason: "cooldown", remaining: type.cooldown_ms - elapsed };
        }
      }
    }
    return { ok: true };
  }

  /** يبني إمبيد الطلب مع احترام الزخرفة المحفوظة للنوع. */
  buildEmbed(guild, type, record, user) {
    const state = STATUS[record.status] || STATUS.pending;
    const style = type.style || {};
    const emoji = style.fieldEmoji ?? "👤";
    const prefix = emoji ? `${emoji} ` : "";

    const fill = (text) =>
      String(text || "")
        .replaceAll("{type}", type.label)
        .replaceAll("{number}", `#${record.number}`)
        .replaceAll("{user}", user?.tag || record.user_id)
        .replaceAll("{server}", guild.name);

    const fields = [
      { name: `${prefix}العضو`, value: `<@${record.user_id}>`, inline: false },
      ...Object.entries(record.answers)
        .slice(0, 20)
        .map(([question, answer]) => ({ name: truncate(`${prefix}${question}`, 250), value: truncate(answer, 1024) }))
    ];

    fields.push({
      name: "الحالة",
      value:
        `${state.icon} ${state.label}` +
        (record.reviewer_id ? `\n<@${record.reviewer_id}> • ${timestamp(record.reviewed_at, "f")}` : "") +
        (record.note ? `\n📝 ${truncate(record.note, 500)}` : "")
    });

    // لون الانتظار قابل للتخصيص، أما القبول والرفض فيبقيان دلاليين حتى يُقرآ بلمحة
    const color =
      record.status === "pending" && typeof style.color === "number"
        ? style.color
        : this.app.config.color(state.color);

    return buildEmbed({
      title: truncate(fill(style.title || `طلب تقديم — {type}`), 256),
      description: style.description ? fill(style.description) : undefined,
      color,
      fields,
      thumbnail: style.thumbnail || record.image_url || user?.displayAvatarURL?.() || undefined,
      image: style.image || undefined,
      footer: fill(style.footer || `طلب رقم {number}`)
    });
  }

  /** نص المنشن المرافق لرسالة الطلب. */
  mentionText(type) {
    const list = type.mentions || [];
    if (!list.length) return undefined;
    return list
      .map((m) => {
        if (m === "everyone") return "@everyone";
        if (m === "here") return "@here";
        if (m.startsWith("u")) return `<@${m.slice(1)}>`;
        return `<@&${m}>`;
      })
      .join(" ");
  }

  buttons(record) {
    if (record.status !== "pending") {
      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`app:reopen:${record.id}`)
            .setLabel("إعادة فتح الطلب")
            .setEmoji("↩️")
            .setStyle(ButtonStyle.Secondary)
        )
      ];
    }
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`app:accept:${record.id}`).setLabel("قبول").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`app:reject:${record.id}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`app:note:${record.id}`).setLabel("رفض بسبب").setEmoji("📝").setStyle(ButtonStyle.Secondary)
      )
    ];
  }

  /** ينشئ الطلب وينشره في قناة المراجعة. */
  async submit({ guild, user, type, answers, imageUrl }) {
    const record = this.app.applications.submit({
      guildId: guild.id,
      typeId: type.id,
      userId: user.id,
      answers,
      imageUrl
    });

    const channelId = type.review_channel_id;
    if (channelId) {
      const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
      if (channel?.isTextBased()) {
        const message = await channel
          .send({
            content: this.mentionText(type),
            embeds: [this.buildEmbed(guild, type, record, user)],
            components: this.buttons(record),
            allowedMentions: { parse: ["users", "roles", "everyone"] }
          })
          .catch(() => null);
        if (message) this.app.applications.setMessage(record.id, channel.id, message.id);
      }
    }

    this.app.bus.emitSafe("application:submitted", { guild, record, type, user });
    return this.app.applications.getByNumber(guild.id, record.number);
  }

  /**
   * تنفيذ القرار.
   * الترتيب مقصود: نغيّر الحالة ذرّيًا أولًا، فإن فشل يعني أن إداريًا آخر سبقنا
   * ولا نلمس الرتب ولا نُرسل إشعارًا مكررًا.
   */
  async decide({ guild, reviewer, record, type, status, note }) {
    const changed = this.app.applications.decide(record.id, status, reviewer.id, note);
    if (!changed) return { ok: false, reason: "alreadyDecided" };

    const fresh = this.app.applications.getByNumber(guild.id, record.number);
    const member = await guild.members.fetch(record.user_id).catch(() => null);

    let roleNote = null;
    if (status === "accepted" && member) {
      roleNote = await this._applyRoles(guild, member, type);
    }

    await this._updateMessage(guild, type, fresh);
    await this._notify(guild, member, type, fresh, status);

    this.app.bus.emitSafe(status === "accepted" ? "application:accepted" : "application:rejected", {
      guild, record: fresh, type, reviewer
    });

    return { ok: true, record: fresh, roleNote };
  }

  /** يعطي رتبة القبول ويسحب رتبة الانتظار إن وُجدت. */
  async _applyRoles(guild, member, type) {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "البوت يفتقد صلاحية إدارة الرتب.";

    const problems = [];

    if (type.accept_role_id) {
      const role = guild.roles.cache.get(type.accept_role_id);
      if (!role) problems.push("رتبة القبول محذوفة.");
      else if (role.managed || role.position >= me.roles.highest.position) {
        problems.push(`رتبة البوت أقل من <@&${role.id}>.`);
      } else {
        await member.roles.add(role, "قبول تقديم").catch(() => problems.push("فشل إعطاء رتبة القبول."));
      }
    }

    if (type.remove_role_id) {
      const role = guild.roles.cache.get(type.remove_role_id);
      if (role && role.position < me.roles.highest.position && member.roles.cache.has(role.id)) {
        await member.roles.remove(role, "قبول تقديم").catch(() => {});
      }
    }

    return problems.length ? problems.join(" ") : null;
  }

  async _updateMessage(guild, type, record) {
    if (!record.message_id || !record.channel_id) return;
    const channel = await this.app.client.channels.fetch(record.channel_id).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(record.message_id).catch(() => null);
    if (!message) return;

    const user = await this.app.client.users.fetch(record.user_id).catch(() => null);
    await message
      .edit({ embeds: [this.buildEmbed(guild, type, record, user)], components: this.buttons(record) })
      .catch(() => {});
  }

  async _notify(guild, member, type, record, status) {
    const user = member?.user || (await this.app.client.users.fetch(record.user_id).catch(() => null));
    if (!user || typeof user.send !== "function") return;

    const custom = status === "accepted" ? type.accept_message : type.reject_message;
    const fallback =
      status === "accepted"
        ? `تشعرك لجنة القبول بقبولك في **${type.label}**.`
        : `نعتذر، لم يتم قبول طلبك في **${type.label}** هذه المرة.`;

    const text = (custom || fallback)
      .replaceAll("{user}", `<@${record.user_id}>`)
      .replaceAll("{server}", guild.name)
      .replaceAll("{type}", type.label);

    const fields = [{ name: "رقم الطلب", value: `#${record.number}`, inline: true }];
    if (record.reviewer_id) fields.push({ name: "مسؤول القبول", value: `<@${record.reviewer_id}>`, inline: true });
    if (record.note) fields.push({ name: "السبب", value: truncate(record.note, 1000) });
    if (status === "rejected" && type.cooldown_ms) {
      fields.push({ name: "إعادة التقديم بعد", value: formatDuration(type.cooldown_ms), inline: true });
    }

    await user
      .send({
        embeds: [
          buildEmbed({
            title: status === "accepted" ? "✅ تم قبول طلبك" : "❌ تم رفض طلبك",
            description: text,
            color: this.app.config.color(status === "accepted" ? "success" : "danger"),
            fields,
            footer: guild.name
          })
        ]
      })
      .catch(() => {});
  }
}

module.exports = ApplicationService;
module.exports.STATUS = STATUS;
