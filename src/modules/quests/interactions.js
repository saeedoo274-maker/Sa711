const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate, timestamp, formatDuration } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات مهام الإدارة. البادئة `qs`.
 *
 * الاستلام والإنجاز يُعاد فحص حالتهما من القاعدة عند كل ضغطة — الرسالة
 * تبقى منشورة ساعات وقد تمتلئ المقاعد أو تُغلق الدورة بين العرض والضغط.
 */
module.exports = {
  prefix: "qs",

  async handle(interaction, app) {
    const [, action, arg] = interaction.customId.split(":");

    if (!app.questService.config(interaction.guild.id).enabled) {
      return safeReply(interaction, {
        content: `${app.config.emoji("error")} نظام المهام معطّل حاليًا.`,
        flags: 64
      });
    }

    switch (action) {
      case "claim": return claim(interaction, app, parseInt(arg, 10));
      case "done": return done(interaction, app, parseInt(arg, 10));
      case "drop": return drop(interaction, app, parseInt(arg, 10));
      case "approve": return approve(interaction, app, parseInt(arg, 10));
      case "reject": return reject(interaction, app, parseInt(arg, 10));
      case "mine": return mine(interaction, app);
      default: return null;
    }
  }
};

async function claim(interaction, app, cycleId) {
  const guild = interaction.guild;
  const userId = interaction.user.id;

  const cycle = app.quests.getCycle(cycleId);
  if (!cycle) return safeReply(interaction, { content: `${app.config.emoji("error")} هذه المهمة لم تعد موجودة.`, flags: 64 });

  const quest = app.quests.getById(cycle.quest_id);
  if (!quest) return safeReply(interaction, { content: `${app.config.emoji("error")} تعريف المهمة محذوف.`, flags: 64 });

  const svc = app.questService;
  const timeout = quest.timeout_ms ?? svc.config(guild.id).defaultTimeoutMs;

  const result = app.quests.claim({
    cycleId,
    questId: quest.id,
    guildId: guild.id,
    userId,
    baseline: svc.baselineFor(quest, guild.id, userId),
    deadlineAt: timeout ? Date.now() + timeout : null,
    maxClaims: quest.max_claims
  });

  if (!result.ok) {
    const messages = {
      closed: "الدورة مغلقة — انتظر النشر القادم.",
      full: `اكتملت المقاعد (**${quest.max_claims}**). جرّب مهمة أخرى.`,
      alreadyClaimed: "أنت مستلم هذه المهمة بالفعل — أنجزها ثم اضغط **تم الإنجاز**.",
      alreadyDone: "أنجزت هذه المهمة من قبل.",
      noCycle: "هذه المهمة لم تعد موجودة."
    };
    return safeReply(interaction, {
      content: `${app.config.emoji("warning")} ${messages[result.reason] || "تعذّر الاستلام."}`,
      flags: 64
    });
  }

  await svc.refreshCycle(cycleId).catch(() => {});

  const v = svc.verifier(quest.verify_type);
  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "🙋 استلمت المهمة",
      description: `**${quest.title}**\n${quest.description || ""}`,
      color: app.config.color("success"),
      fields: [
        {
          name: "شرط الإنجاز",
          value: v.measurable
            ? `${v.label}: **${quest.verify_target}** ${v.unit}\n-# يُحتسب ما تنجزه **من الآن** فقط.`
            : "تصديق إداري بعد ضغطك على **تم الإنجاز**."
        },
        ...(result.claim.deadline_at
          ? [{ name: "المهلة", value: `تنتهي ${timestamp(result.claim.deadline_at, "R")}`, inline: true }]
          : []),
        ...(quest.reward_points ? [{ name: "المكافأة", value: `⭐ ${quest.reward_points} نقطة`, inline: true }] : [])
      ]
    })],
    flags: 64
  });
}

async function done(interaction, app, cycleId) {
  const guild = interaction.guild;
  const userId = interaction.user.id;
  const svc = app.questService;

  const cycle = app.quests.getCycle(cycleId);
  if (!cycle) return safeReply(interaction, { content: `${app.config.emoji("error")} هذه المهمة لم تعد موجودة.`, flags: 64 });

  const claim = app.quests.getClaim(cycleId, userId);
  if (!claim) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} لم تستلم هذه المهمة. اضغط **استلام المهمة** أولًا.`, flags: 64 });
  }
  if (claim.status === "completed") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} أنجزتها بالفعل.`, flags: 64 });
  }
  if (claim.status !== "claimed") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} انتهت مهلة استلامك — استلمها من جديد.`, flags: 64 });
  }

  const quest = app.quests.getById(cycle.quest_id);
  const m = svc.measure(quest, claim);

  // المهام غير القابلة للقياس تُحوَّل لطلب تصديق إداري
  if (!m.measurable) {
    return requestApproval(interaction, app, quest, claim);
  }

  app.quests.setProgress(claim.id, m.done);

  if (!m.ok) {
    return safeReply(interaction, {
      embeds: [buildEmbed({
        title: "⏳ لم تكتمل بعد",
        description: `**${quest.title}**`,
        color: app.config.color("warning"),
        fields: [
          { name: "تقدّمك", value: `**${m.done}** من **${m.target}** ${m.unit}`, inline: true },
          { name: "المتبقي", value: `**${Math.max(0, m.target - m.done)}** ${m.unit}`, inline: true },
          { name: "الشريط", value: bar(m.done, m.target) }
        ],
        footer: "يُحتسب ما أنجزته بعد الاستلام فقط."
      })],
      flags: 64
    });
  }

  const res = app.quests.complete({ claimId: claim.id, progress: m.done, verifiedBy: null });
  if (!res.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} حُسم هذا الاستلام بالفعل.`, flags: 64 });
  }

  await svc.grantReward(guild.id, userId, quest);
  await svc.refreshCycle(cycleId).catch(() => {});
  await svc.log(guild.id, buildEmbed({
    title: "✅ إنجاز مهمة",
    color: app.config.color("success"),
    fields: [
      { name: "العضو", value: `<@${userId}>`, inline: true },
      { name: "المهمة", value: quest.title, inline: true },
      { name: "التحقق", value: `آلي — ${m.done}/${m.target} ${m.unit}`, inline: true }
    ]
  }));

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "🎉 أُنجزت المهمة",
      description: `**${quest.title}**\n\nتحقّق البوت آليًا: **${m.done}** من **${m.target}** ${m.unit} ✅`,
      color: app.config.color("success"),
      fields: quest.reward_points || quest.reward_money
        ? [{
            name: "مكافأتك",
            value: `${quest.reward_points ? `⭐ ${quest.reward_points} نقطة` : ""}${quest.reward_points && quest.reward_money ? " • " : ""}${quest.reward_money ? `💰 ${quest.reward_money}` : ""}`
          }]
        : []
    })],
    flags: 64
  });
}

/** المهام اليدوية: تُرسل للإدارة لتصديقها بدليل من المنفّذ. */
async function requestApproval(interaction, app, quest, claim) {
  const modal = new ModalBuilder()
    .setCustomId(`qs:approve:${claim.id}`)
    .setTitle(truncate(`إثبات: ${quest.title}`, 45));
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("proof")
        .setLabel("وصف ما أنجزته (أو رابط دليل)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(800)
    )
  );
  return safeModal(interaction, modal);
}

/** استقبال الإثبات وإرساله للإدارة. */
async function approve(interaction, app, claimId) {
  const guild = interaction.guild;
  const svc = app.questService;

  // المودال: صاحب المهمة يرسل إثباته
  if (interaction.fields) {
    const proof = interaction.fields.getTextInputValue("proof");
    const claim = app.quests.db.prepare("SELECT * FROM quest_claims WHERE id = ?").get(claimId);
    if (!claim || claim.status !== "claimed") {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} لم يعد هذا الاستلام صالحًا.`, flags: 64 });
    }

    const quest = app.quests.getById(claim.quest_id);
    app.quests.db.prepare("UPDATE quest_claims SET note = ? WHERE id = ?").run(proof, claimId);

    const cfg = svc.config(guild.id);
    const target = cfg.logChannelId;
    let sent = false;

    if (target) {
      const channel = await app.client.channels.fetch(target).catch(() => null);
      if (channel?.isTextBased()) {
        const msg = await channel.send({
          embeds: [buildEmbed({
            title: "📝 طلب تصديق مهمة",
            description: `**${quest.title}**`,
            color: app.config.color("warning"),
            fields: [
              { name: "المنفّذ", value: `<@${claim.user_id}>`, inline: true },
              { name: "استُلمت", value: timestamp(claim.claimed_at, "R"), inline: true },
              { name: "الإثبات", value: truncate(proof, 1000) }
            ]
          })],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId(`qs:approve:${claimId}`).setLabel("تصديق").setEmoji("✅").setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId(`qs:reject:${claimId}`).setLabel("رفض").setEmoji("❌").setStyle(ButtonStyle.Danger)
            )
          ]
        }).catch(() => null);
        sent = !!msg;
      }
    }

    return safeReply(interaction, {
      content: sent
        ? `${app.config.emoji("success")} أُرسل إثباتك للإدارة. ستُصدَّق المهمة بعد المراجعة.`
        : `${app.config.emoji("warning")} حُفظ إثباتك، لكن لم تُضبط قناة مراجعة المهام بعد — راجع الإدارة.`,
      flags: 64
    });
  }

  // الزر: إداري يصدّق
  if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} التصديق للإدارة العليا فقط.`, flags: 64 });
  }

  const res = app.quests.complete({ claimId, progress: 1, verifiedBy: interaction.user.id });
  if (!res.ok) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} حُسم هذا الطلب بالفعل.`, flags: 64 });
  }

  await svc.grantReward(guild.id, res.claim.user_id, res.quest);
  await svc.refreshCycle(res.claim.cycle_id).catch(() => {});

  const user = await app.client.users.fetch(res.claim.user_id).catch(() => null);
  await user?.send({
    embeds: [buildEmbed({
      title: "🎉 صُدِّقت مهمتك",
      description: `**${res.quest.title}** في **${guild.name}**`,
      color: app.config.color("success")
    })]
  }).catch(() => {});

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: "✅ صُدِّقت المهمة",
      description: `**${res.quest.title}**\nالمنفّذ: <@${res.claim.user_id}>\nصدّقها: <@${interaction.user.id}>`,
      color: app.config.color("success")
    })],
    components: []
  });
}

async function reject(interaction, app, claimId) {
  if (app.permissions.resolveLevel(interaction.member) < Level.ADMIN) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} الرفض للإدارة العليا فقط.`, flags: 64 });
  }

  const claim = app.quests.db.prepare("SELECT * FROM quest_claims WHERE id = ?").get(claimId);
  if (!claim || claim.status !== "claimed") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} حُسم هذا الطلب بالفعل.`, flags: 64 });
  }

  app.quests.db.prepare("UPDATE quest_claims SET status = 'abandoned' WHERE id = ?").run(claimId);
  await app.questService.refreshCycle(claim.cycle_id).catch(() => {});

  const quest = app.quests.getById(claim.quest_id);
  const user = await app.client.users.fetch(claim.user_id).catch(() => null);
  await user?.send({
    content: `${app.config.emoji("error")} لم تُصدَّق مهمتك **${quest?.title || ""}** — يمكنك استلامها من جديد.`
  }).catch(() => {});

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: "❌ رُفض الطلب",
      description: `المنفّذ: <@${claim.user_id}>\nرفضها: <@${interaction.user.id}>`,
      color: app.config.color("danger")
    })],
    components: []
  });
}

async function drop(interaction, app, cycleId) {
  const claim = app.quests.getClaim(cycleId, interaction.user.id);
  if (!claim || claim.status !== "claimed") {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} ما عندك استلام نشط لهذه المهمة.`, flags: 64 });
  }

  if (!app.quests.abandon(claim.id, interaction.user.id)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تعذّر التخلّي.`, flags: 64 });
  }

  await app.questService.refreshCycle(cycleId).catch(() => {});
  return safeReply(interaction, {
    content: `${app.config.emoji("success")} تخلّيت عن المهمة، وصار المقعد متاحًا لغيرك.`,
    flags: 64
  });
}

async function mine(interaction, app) {
  const guild = interaction.guild;
  const rows = app.quests.activeClaims(guild.id, interaction.user.id);
  const stats = app.quests.userStats(guild.id, interaction.user.id, 30);
  const svc = app.questService;

  const list = rows.length
    ? rows
        .map((c) => {
          const quest = app.quests.getById(c.quest_id);
          const m = svc.measure(quest, c);
          const progress = m.measurable ? `${m.done}/${m.target} ${m.unit} ${bar(m.done, m.target)}` : "بانتظار التصديق";
          return `${c.emoji || "•"} **${c.title}**\n-# ${progress}` +
            (c.deadline_at ? ` • تنتهي ${timestamp(c.deadline_at, "R")}` : "");
        })
        .join("\n\n")
    : "ما عندك مهام مستلمة حاليًا.";

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "📋 مهامي",
      description: list,
      color: app.config.color("primary"),
      fields: [
        { name: "أُنجزت (30 يوم)", value: `\`${stats.completed}\``, inline: true },
        { name: "نقاط المهام", value: `\`${stats.points}\``, inline: true }
      ]
    })],
    flags: 64
  });
}

/** شريط تقدّم نصي مضغوط. */
function bar(done, target) {
  const ratio = target > 0 ? Math.min(1, done / target) : 0;
  const filled = Math.round(ratio * 10);
  return `\`${"█".repeat(filled)}${"░".repeat(10 - filled)}\` ${Math.round(ratio * 100)}%`;
}
