const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * أزرار تقييم التذكرة.
 *
 * تصل الأزرار للعضو في **الخاص**، فلا يوجد `interaction.guild` إطلاقًا.
 * والأهم: التذكرة تُحذف من القاعدة فور إغلاقها (حذف صلب)، والعضو قد يضغط
 * الزر بعد ساعات — لذلك تُضمَّن كل البيانات اللازمة في معرّف الزر نفسه:
 *
 *   trate:<ticketId>:<action>:<guildId>:<staffId>:<ticketNumber>
 *
 * القراءة من القاعدة تبقى خطة بديلة للأزرار القديمة المُرسلة قبل هذا التغيير.
 */
module.exports = {
  prefix: "trate",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const [, ticketIdRaw, action, ctxGuildId, ctxStaffId, ctxNumber] = parts;
    const ticketId = parseInt(ticketIdRaw, 10);

    const ctx = resolveContext(app, ticketId, {
      guildId: ctxGuildId,
      staffId: ctxStaffId,
      ticketNumber: ctxNumber
    });

    if (!ctx.guildId) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} انتهت صلاحية هذا التقييم.`, flags: 64 });
    }

    if (action === "note") return noteModal(interaction, app, ticketId, ctx);
    if (action === "notesave") return saveNote(interaction, app, ticketId, ctx);

    const stars = parseInt(action, 10);
    if (isNaN(stars) || stars < 1 || stars > 5) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} تقييم غير صالح.`, flags: 64 });
    }

    const saved = app.tickets.addRating({
      guildId: ctx.guildId,
      ticketId,
      ticketNumber: ctx.ticketNumber,
      userId: interaction.user.id,
      staffId: ctx.staffId,
      stars
    });

    if (!saved) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} قيّمت هذه التذكرة من قبل.`, flags: 64 });
    }

    await publish(app, ctx.guildId, {
      userId: interaction.user.id,
      staffId: ctx.staffId,
      stars,
      note: null,
      ticketNumber: ctx.ticketNumber
    });

    // نمرّر نفس السياق لزر الملاحظة حتى يبقى شغّالًا بعد حذف التذكرة
    const noteId = `trate:${ticketId}:note:${ctx.guildId}:${ctx.staffId || 0}:${ctx.ticketNumber || 0}`;

    return safeUpdate(interaction, {
      embeds: [
        buildEmbed({
          title: "⭐ شكرًا لتقييمك",
          description: `${"⭐".repeat(stars)}${"☆".repeat(5 - stars)}\nتم تسجيل تقييمك (**${stars}/5**).`,
          color: app.config.color(stars >= 4 ? "success" : stars === 3 ? "warning" : "danger")
        })
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(noteId)
            .setLabel("إضافة ملاحظة")
            .setEmoji("📝")
            .setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
};

/**
 * يحدّد السيرفر والإداري ورقم التذكرة.
 * الأولوية لما جاء في الزر، ثم صف التذكرة إن كان لا يزال موجودًا،
 * ثم أي تقييم سابق لنفس التذكرة.
 */
function resolveContext(app, ticketId, fromButton) {
  const clean = (v) => (v && v !== "0" ? v : null);

  let guildId = clean(fromButton.guildId);
  let staffId = clean(fromButton.staffId);
  let ticketNumber = fromButton.ticketNumber && fromButton.ticketNumber !== "0"
    ? parseInt(fromButton.ticketNumber, 10)
    : null;

  if (!guildId || !staffId || !ticketNumber) {
    const row = app.tickets.db.prepare("SELECT * FROM tickets WHERE id = ?").get(ticketId);
    if (row) {
      guildId = guildId || row.guild_id;
      staffId = staffId || row.claimed_by;
      ticketNumber = ticketNumber || row.number;
    }
  }

  if (!guildId || !staffId || !ticketNumber) {
    const prev = app.tickets.db
      .prepare("SELECT * FROM ticket_ratings WHERE ticket_id = ? LIMIT 1")
      .get(ticketId);
    if (prev) {
      guildId = guildId || prev.guild_id;
      staffId = staffId || prev.staff_id;
      ticketNumber = ticketNumber || prev.ticket_number;
    }
  }

  return { guildId, staffId, ticketNumber };
}

async function noteModal(interaction, app, ticketId, ctx) {
  const modal = new ModalBuilder()
    .setCustomId(`trate:${ticketId}:notesave:${ctx.guildId}:${ctx.staffId || 0}:${ctx.ticketNumber || 0}`)
    .setTitle("ملاحظة على الخدمة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("note")
        .setLabel("ملاحظتك")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(500)
    )
  );
  return safeModal(interaction, modal);
}

async function saveNote(interaction, app, ticketId, ctx) {
  const note = interaction.fields.getTextInputValue("note");
  const updated = app.tickets.updateRatingNote(ctx.guildId, ticketId, interaction.user.id, note);
  if (!updated) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} ما لقيت تقييمك.`, flags: 64 });
  }

  const rating = app.tickets.db
    .prepare("SELECT * FROM ticket_ratings WHERE guild_id = ? AND ticket_id = ? AND user_id = ?")
    .get(ctx.guildId, ticketId, interaction.user.id);

  await publish(app, ctx.guildId, {
    userId: interaction.user.id,
    staffId: rating?.staff_id || ctx.staffId,
    stars: rating?.stars || 0,
    note,
    ticketNumber: rating?.ticket_number || ctx.ticketNumber
  });

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم حفظ ملاحظتك. شكرًا لك.`, flags: 64 });
}

async function publish(app, guildId, data) {
  const channelId = app.guildConfig.value(guildId, "tickets.ratingChannelId");
  if (!channelId) return;

  const channel = await app.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  // اسم السيرفر للعرض فقط — لا يصح أن يمنع غيابه من الكاش نشرَ التقييم
  const guild = app.client.guilds.cache.get(guildId) || { id: guildId, name: "السيرفر" };

  await channel
    .send({
      embeds: [app.ticketAutomation.ratingEmbed(guild, data)],
      allowedMentions: { parse: [] }
    })
    .catch(() => {});
}
