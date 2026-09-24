const { ChannelType, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { buildEmbed, timestamp, truncate } = require("../../core/utils/helpers");
const { Level } = require("../../core/permissions/PermissionService");

/**
 * نظام التذاكر.
 *
 * مبدآن أساسيان:
 *  1) الخصوصية تُفرض عبر Permission Overwrites على القناة نفسها، لا بإخفاء الواجهة.
 *  2) الاستلام والإغلاق عمليتان ذرّيتان في قاعدة البيانات، فيستحيل الاستلام المزدوج
 *     حتى لو ضغط عدة إداريين في نفس اللحظة.
 */
class TicketService {
  constructor(app) {
    this.app = app;
  }

  // ---------------- بناء الأزرار ----------------
  buildButtons(ticket) {
    const rows = [];
    if (ticket.status === "open") {
      rows.push(
        new ActionRowBuilder().addComponents(
          ticket.claimed_by
            ? new ButtonBuilder().setCustomId("ticket:unclaim").setLabel("إلغاء الاستلام").setEmoji("↩️").setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder().setCustomId("ticket:claim").setLabel("استلام التذكرة").setEmoji("🙋").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket:close").setLabel("إغلاق").setEmoji("🔒").setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(ticket.attachments_allowed ? "ticket:denyfiles" : "ticket:allowfiles")
            .setLabel(ticket.attachments_allowed ? "منع الملفات" : "السماح بالملفات")
            .setEmoji("📎")
            .setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket:add").setLabel("إضافة عضو").setEmoji("➕").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket:remove").setLabel("إزالة عضو").setEmoji("➖").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket:rename").setLabel("إعادة تسمية").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket:transcript").setLabel("نسخة المحادثة").setEmoji("📄").setStyle(ButtonStyle.Secondary)
        )
      );
    } else {
      // زر الحذف لا يظهر إلا بعد الإغلاق
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("ticket:reopen").setLabel("إعادة فتح").setEmoji("🔓").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("ticket:transcript").setLabel("نسخة المحادثة").setEmoji("📄").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("ticket:delete").setLabel("حذف نهائي").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        )
      );
    }
    return rows;
  }

  header(ticket, guild, panelConfig = {}, type = null) {
    const fields = [
      { name: "صاحب التذكرة", value: `<@${ticket.owner_id}>`, inline: true },
      { name: "الحالة", value: ticket.status === "open" ? "🟢 مفتوحة" : "🔴 مغلقة", inline: true },
      { name: "المستلم", value: ticket.claimed_by ? `<@${ticket.claimed_by}>` : "لم تُستلم بعد", inline: true },
      { name: "أُنشئت", value: timestamp(ticket.created_at, "R"), inline: true },
      { name: "الملفات", value: ticket.attachments_allowed ? "مسموحة" : "ممنوعة", inline: true }
    ];
    if (ticket.number) fields.push({ name: "رقم التذكرة", value: `#${String(ticket.number).padStart(4, "0")}`, inline: true });
    return buildEmbed({
      title: type?.label || panelConfig.welcomeTitle || `${this.app.config.emoji("ticket")} تذكرة دعم`,
      description:
        type?.description ||
        panelConfig.welcomeMessage ||
        "شكرًا لتواصلك مع الإدارة. اشرح طلبك بالتفصيل وسيتم الرد عليك في أقرب وقت.",
      color: this.app.config.color(ticket.status === "open" ? "primary" : "neutral"),
      fields,
      thumbnail: panelConfig.thumbnail || undefined,
      image: panelConfig.banner || undefined,
      footer: panelConfig.footer || guild.name
    });
  }

  /** الصلاحيات الأساسية لقناة التذكرة. */
  _overwrites(guild, ownerId, staffRoleId) {
    const list = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: ownerId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks]
      },
      {
        id: guild.members.me.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory]
      }
    ];
    if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
      list.push({
        id: staffRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles
        ]
      });
    }
    return list;
  }

  /**
   * فتح تذكرة.
   * `type` نوع تذكرة له كاتيغوري ورتبة دعم ونموذج أسئلة خاصة به،
   * وإعداداته تتقدم على إعدادات السيرفر العامة.
   */
  async open({ guild, member, panelId = null, type = null, answers = null }) {
    const cfg = this.app.guildConfig.get(guild.id);
    if (!cfg.tickets.enabled) return { ok: false, reason: "systemDisabled" };

    // تبريد فتح التذاكر (0 = معطّل، وهو الافتراضي فلا يتغير سلوك السيرفرات الحالية)
    const cooldownMs = cfg.tickets.cooldownMs || 0;
    if (cooldownMs > 0) {
      const last = this.app.tickets.lastCreatedBy(guild.id, member.id);
      if (last && Date.now() - last < cooldownMs) return { ok: false, reason: "cooldown", remainingMs: cooldownMs - (Date.now() - last) };
    }

    // حد التذاكر يُحسب داخل النوع الواحد، فيقدر العضو يفتح تذكرة لكل خدمة
    if (type) {
      const open = this.app.ticketTypes.openCountForType(guild.id, type.id, member.id);
      if (open >= (type.max_open || 1)) return { ok: false, reason: "duplicate" };
    } else if (this.app.tickets.openCountForUser(guild.id, member.id) >= 1) {
      return { ok: false, reason: "duplicate" };
    }

    const panel = panelId ? this.app.tickets.getPanel(panelId) : null;
    const panelConfig = panel?.config || {};

    const categoryId = type?.category_id || panelConfig.categoryId || cfg.tickets.categoryId;
    const staffRoleId = type?.staff_role_id || cfg.staff.baseRoleId;

    // رقم متسلسل لكل سيرفر، يُستخدم في اسم القناة وفي الأرشيف والتقييم
    const number = this.app.tickets.nextNumber(guild.id);
    const padded = String(number).padStart(4, "0");

    const nameTemplate =
      type?.name_template || panelConfig.channelNameTemplate || cfg.tickets.channelNameTemplate || "ticket-{number}";
    const channelName = nameTemplate
      .replaceAll("{username}", member.user.username)
      .replaceAll("{id}", member.id)
      .replaceAll("{number}", padded)
      .replaceAll("{type}", type?.name || "ticket")
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF\-_]/g, "-")
      .slice(0, 90);

    let channel;
    try {
      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: categoryId || null,
        permissionOverwrites: this._overwrites(guild, member.id, staffRoleId)
      });
    } catch (err) {
      return { ok: false, reason: "actionFailed", details: err.message };
    }

    const ticket = this.app.tickets.create({
      guildId: guild.id,
      channelId: channel.id,
      ownerId: member.id,
      panelId,
      typeId: type?.id || null,
      answers,
      number,
      attachmentsAllowed: cfg.tickets.attachmentsByDefault
    });

    if (cfg.tickets.attachmentsByDefault) await this.setAttachments(channel, member.id, true);

    // رسالة ترحيب مخصصة إن رُبط النوع بإمبيد مبني يدويًا
    const welcome = type?.welcome_embed_id ? this.app.embeds.get(type.welcome_embed_id) : null;
    const headerEmbed = welcome
      ? this.app.embedService.build(welcome, { member, guild })
      : this.header(ticket, guild, panelConfig, type);

    const staffMention = staffRoleId ? `<@&${staffRoleId}>` : "";
    await channel
      .send({
        content: `<@${member.id}> ${staffMention}`,
        embeds: [headerEmbed],
        components: this.buildButtons(ticket),
        allowedMentions: { parse: ["users", "roles"] }
      })
      .catch(() => {});

    // إجابات النموذج تُنشر في القناة حتى يراها الطاقم فورًا
    if (answers && Object.keys(answers).length) {
      await channel.send({ embeds: [this.answersEmbed(answers, member)] }).catch(() => {});
    }

    this.app.bus.emitSafe("ticket:created", { guild, ticket, member, type });
    return { ok: true, ticket, channel };
  }

  /**
   * الإغلاق الموحّد (زر الإغلاق، الإغلاق المجدول، الأدوات الإضافية).
   * الإغلاق ذرّي في قاعدة البيانات: `WHERE status = 'open'` — لا يُغلق مرتين.
   */
  async closeBy(guild, channel, ticket, member) {
    const success = this.app.tickets.close(ticket.channel_id, member.id);
    if (!success) return { ok: false, reason: "alreadyClosed" };
    if (channel) await this.closeChannel(channel, ticket);
    this.app.activity.increment(guild.id, member.id, "tickets_closed");
    this.app.bus.emitSafe("ticket:closed", { guild, ticket, member });
    return { ok: true, ticket: this.app.tickets.getByChannel(ticket.channel_id) };
  }

  /** يعرض إجابات نموذج التذكرة في إمبيد منظم. */
  answersEmbed(answers, member) {
    return buildEmbed({
      title: "📋 بيانات الطلب",
      description: `مقدّم الطلب: <@${member.id}>`,
      color: this.app.config.color("info"),
      fields: Object.entries(answers)
        .slice(0, 25)
        .map(([question, answer]) => ({
          name: truncate(question, 256),
          value: truncate(answer || "—", 1024)
        }))
    });
  }

  /** يحدّد من يملك التصرف في التذكرة. يُستدعى من الخادم عند كل ضغطة زر. */
  canManage(member, ticket) {
    const level = this.app.permissions.resolveLevel(member);
    if (level >= Level.ADMIN) return true;
    if (member.id === ticket.claimed_by) return true;
    const staffRoleId = this.app.guildConfig.value(member.guild.id, "staff.baseRoleId");
    if (staffRoleId && member.roles.cache.has(staffRoleId)) return true;
    return level >= Level.MODERATOR;
  }

  async setAttachments(channel, ownerId, allowed) {
    await channel.permissionOverwrites.edit(ownerId, {
      AttachFiles: allowed ? true : false,
      EmbedLinks: allowed ? true : false
    });
    this.app.tickets.setAttachments(channel.id, allowed);
  }

  async closeChannel(channel, ticket) {
    // منع صاحب التذكرة من الكتابة مع إبقاء القناة مرئية له
    await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: false }).catch(() => {});
  }

  async reopenChannel(channel, ticket) {
    await channel.permissionOverwrites.edit(ticket.owner_id, { SendMessages: true }).catch(() => {});
  }

  /** يبني نسخة نصية من المحادثة (حتى 500 رسالة). */
  async transcript(channel, ticket) {
    const messages = [];
    let lastId = null;
    for (let i = 0; i < 5; i++) {
      const batch = await channel.messages.fetch({ limit: 100, ...(lastId ? { before: lastId } : {}) }).catch(() => null);
      if (!batch || batch.size === 0) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }

    const lines = messages
      .reverse()
      .map((m) => {
        const time = new Date(m.createdTimestamp).toISOString().replace("T", " ").slice(0, 19);
        const attachments = m.attachments.size ? ` [مرفقات: ${m.attachments.map((a) => a.url).join(" ")}]` : "";
        const embeds = m.embeds.length ? ` [${m.embeds.length} إمبيد]` : "";
        return `[${time}] ${m.author.tag}: ${m.content || ""}${attachments}${embeds}`;
      });

    const header = [
      "=".repeat(60),
      `نسخة محادثة التذكرة`,
      `القناة: #${channel.name} (${channel.id})`,
      `صاحب التذكرة: ${ticket.owner_id}`,
      `المستلم: ${ticket.claimed_by || "لا يوجد"}`,
      `تاريخ الإنشاء: ${new Date(ticket.created_at).toISOString()}`,
      `عدد الرسائل: ${lines.length}`,
      "=".repeat(60),
      ""
    ].join("\n");

    const buffer = Buffer.from(header + lines.join("\n"), "utf8");
    return new AttachmentBuilder(buffer, { name: `transcript-${channel.name}-${Date.now()}.txt` });
  }
}

module.exports = TicketService;
