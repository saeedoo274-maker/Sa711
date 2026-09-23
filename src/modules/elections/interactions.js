const { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات الانتخابات. البادئة `election:`.
 * الفحص يتم عند كل تفاعل (بلا اعتماد على حالة اللوحة المعروضة)،
 * لأن حالة الانتخاب قد تتغيّر بين نشر اللوحة وضغط العضو عليها.
 */
module.exports = {
  prefix: "election",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const action = parts[1];
    const electionId = parseInt(parts[2], 10);

    const election = app.elections.getById(electionId);
    if (!election || election.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذا الانتخاب لم يعد موجودًا.`, flags: 64 });
    }

    if (action === "register") return registerModal(interaction, app, election);
    if (action === "registersubmit") return registerSubmit(interaction, app, election);
    if (action === "candidates") return showCandidates(interaction, app, election);
    if (action === "vote") return voteMenu(interaction, app, election);
    if (action === "votesubmit") return voteSubmit(interaction, app, election, parts[3]);
    if (action === "results") return showResults(interaction, app, election);

    // مراجعة المرشحين (للطاقم فقط)
    if (action === "approve" || action === "reject") return decideCandidate(interaction, app, election, action, parseInt(parts[3], 10));

    return null;
  }
};

async function registerModal(interaction, app, election) {
  if (election.status !== "registration") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} التسجيل مغلق لهذا الانتخاب.`, flags: 64 });
  }
  const existing = app.elections.getCandidacy(election.id, interaction.user.id);
  if (existing) {
    const messages = { pending: "طلبك قيد المراجعة بالفعل.", approved: "أنت مسجّل كمرشح بالفعل.", rejected: "طلبك السابق رُفض ولا يمكنك التسجيل مجددًا في هذا الانتخاب." };
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ${messages[existing.status]}`, flags: 64 });
  }

  const modal = new ModalBuilder().setCustomId(`election:registersubmit:${election.id}`).setTitle("تسجيل كمرشح");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("platform")
        .setLabel("برنامجك الانتخابي")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setPlaceholder("عرّف بنفسك ووضّح وعودك الانتخابية...")
    )
  );
  return safeModal(interaction, modal);
}

async function registerSubmit(interaction, app, election) {
  // إعادة الفحص عند الإرسال: قد تتغيّر حالة الانتخاب بين فتح النافذة وإرسالها
  if (election.status !== "registration") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} التسجيل مغلق لهذا الانتخاب.`, flags: 64 });
  }
  const existing = app.elections.getCandidacy(election.id, interaction.user.id);
  if (existing) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} أنت مسجّل بالفعل في هذا الانتخاب.`, flags: 64 });
  }

  const platform = interaction.fields.getTextInputValue("platform");
  const candidate = app.elections.registerCandidate({ electionId: election.id, userId: interaction.user.id, platform });

  // إشعار قناة المراجعة إن وُجدت، بأزرار قبول/رفض
  const cfg = app.electionService.config(interaction.guild.id);
  if (cfg.reviewChannelId) {
    const channel = await app.client.channels.fetch(cfg.reviewChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const embed = app.electionService.candidateEmbed(interaction.guild, candidate, interaction.user);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`election:approve:${election.id}:${candidate.id}`).setLabel("قبول").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`election:reject:${election.id}:${candidate.id}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Danger)
      );
      await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
    }
  }

  return safeReply(interaction, {
    content: `${app.config.emoji("success")} تم إرسال طلب ترشّحك للمراجعة.`,
    flags: 64
  });
}

async function decideCandidate(interaction, app, election, action, candidateId) {
  if (app.permissions.resolveLevel(interaction.member) < Level.STAFF) {
    return safeReply(interaction, { content: app.i18n.t("errors.noPermission", { emoji: app.config.emoji("error") }), flags: 64 });
  }

  const status = action === "approve" ? "approved" : "rejected";
  const changed = app.elections.decideCandidate(candidateId, status, interaction.user.id, null);
  if (!changed) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تم البت في هذا الطلب من إداري آخر.`, flags: 64 });
  }

  const candidate = app.elections.getCandidate(candidateId);
  const user = await app.client.users.fetch(candidate.user_id).catch(() => null);

  await user
    ?.send({
      content:
        status === "approved"
          ? `${app.config.emoji("success")} تم قبول ترشّحك في **${election.title}**.`
          : `${app.config.emoji("error")} تم رفض ترشّحك في **${election.title}**.`
    })
    .catch(() => {});

  await app.electionService.refreshPanel(app.elections.getById(election.id));

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم ${status === "approved" ? "قبول" : "رفض"} المرشح.`, flags: 64 });
}

async function showCandidates(interaction, app, election) {
  const candidates = app.elections.listCandidates(election.id, { approvedOnly: true });
  return safeReply(interaction, {
    embeds: [app.electionService.candidatesListEmbed(election, candidates)],
    flags: 64
  });
}

async function voteMenu(interaction, app, election) {
  if (election.status !== "voting") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} التصويت غير مفتوح حاليًا.`, flags: 64 });
  }
  if (!election.multiple_votes && app.elections.hasVoted(election.id, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} صوّتّ بالفعل في هذا الانتخاب.`, flags: 64 });
  }

  const candidates = app.elections.listCandidates(election.id, { approvedOnly: true });
  if (!candidates.length) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} لا يوجد مرشحون معتمدون بعد.`, flags: 64 });
  }

  const votedFor = election.multiple_votes ? app.elections.votedFor(election.id, interaction.user.id) : [];
  const rows = [];
  let row = new ActionRowBuilder();
  for (const c of candidates.slice(0, 25)) {
    if (row.components.length === 5) {
      rows.push(row);
      row = new ActionRowBuilder();
    }
    const already = votedFor.includes(c.id);
    // نجلب اسم العضو الحقيقي لأن نص الزر لا يفسّر منشنات ديسكورد
    const member = await interaction.guild.members.fetch(c.user_id).catch(() => null);
    const label = member?.displayName || member?.user?.username || `مرشح #${c.id}`;
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`election:votesubmit:${election.id}:${c.id}`)
        .setLabel(label.slice(0, 80))
        .setStyle(already ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(already)
    );
  }
  if (row.components.length) rows.push(row);

  return safeReply(interaction, {
    content: "اختر المرشح اللي تبي تصوّت له:",
    components: rows.slice(0, 5),
    flags: 64
  });
}

async function voteSubmit(interaction, app, election, candidateIdRaw) {
  const candidateId = parseInt(candidateIdRaw, 10);

  // إعادة الفحص من الصفر عند الضغط الفعلي، لا الاعتماد على حالة الزر المعروضة
  if (election.status !== "voting") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} التصويت غير مفتوح حاليًا.`, flags: 64 });
  }
  const candidate = app.elections.getCandidate(candidateId);
  if (!candidate || candidate.election_id !== election.id || candidate.status !== "approved") {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا المرشح لم يعد متاحًا.`, flags: 64 });
  }

  const result = election.multiple_votes
    ? app.elections.voteMultiple({ electionId: election.id, candidateId, voterId: interaction.user.id })
    : app.elections.voteSingle({ electionId: election.id, candidateId, voterId: interaction.user.id });

  if (!result.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} صوّتّ بالفعل في هذا الانتخاب.`, flags: 64 });
  }

  await app.electionService.refreshPanel(election);

  return safeReply(interaction, { content: `${app.config.emoji("success")} تم تسجيل صوتك، شكرًا لمشاركتك.`, flags: 64 });
}

async function showResults(interaction, app, election) {
  const results = app.elections.results(election.id);
  return safeReply(interaction, { embeds: [app.electionService.resultsEmbed(election, results)], flags: 64 });
}
