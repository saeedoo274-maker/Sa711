const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, StringSelectMenuBuilder, ChannelSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, PermissionFlagsBits, ChannelType
} = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed, truncate, formatDuration, timestamp } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * لوحة نظام الإدارة — رسالة **دائمة** تُنشر في قناة ويستخدمها كل الطاقم.
 *
 * تختلف عن `/لوحة` الخاصة: تلك مؤقتة لشخص واحد، وهذه تبقى منشورة
 * ويضغطها الجميع، وكل رد يعود **مخفيًا لصاحبه وحده** فلا يتعارض اثنان
 * على نفس الرسالة.
 *
 * كل زر يُعيد فحص الصلاحية عند الضغط لا عند النشر، لأن الرسالة تبقى
 * شهورًا وقد تتغيّر رتب الأعضاء بعدها.
 */
module.exports = {
  prefix: "adm",

  async handle(interaction, app) {
    const [, action, arg] = interaction.customId.split(":");
    const level = app.permissions.resolveLevel(interaction.member);

    // الإجراءات التي تغيّر رتبًا للأدمن وحده
    const ADMIN_ONLY = new Set([
      "promote", "demote", "dismiss", "run", "logo", "logosave", "refresh", "link", "linksave",
      "absence", "abstoggle", "abstext", "abstextsave", "absdays", "absdayssave", "abschan", "abschanset"
    ]);
    if (ADMIN_ONLY.has(action) && level < Level.ADMIN) {
      return safeReply(interaction, {
        content: `${app.config.emoji("error")} هذا الإجراء للإدارة العليا فقط.`,
        flags: 64
      });
    }

    switch (action) {
      case "me": return profile(interaction, app);
      case "ladder": return ladder(interaction, app);
      case "top": return top(interaction, app, arg);
      case "stats": return stats(interaction, app);
      case "help": return help(interaction, app);
      case "promote": return pick(interaction, app, "up");
      case "demote": return pick(interaction, app, "down");
      case "dismiss": return pick(interaction, app, "dismiss");
      case "run": return run(interaction, app, arg);
      case "logo": return logoModal(interaction, app);
      case "logosave": return logoSave(interaction, app);
      case "refresh": return refresh(interaction, app);
      case "checkin": return checkIn(interaction, app);
      case "attend": return attendance(interaction, app);
      case "absence": return absencePanel(interaction, app);
      case "abstoggle": return absenceToggle(interaction, app);
      case "abstext": return absenceTextModal(interaction, app);
      case "abstextsave": return absenceTextSave(interaction, app);
      case "absdays": return absenceDaysModal(interaction, app);
      case "absdayssave": return absenceDaysSave(interaction, app);
      case "abschan": return absenceChannelPick(interaction, app);
      case "abschanset": return absenceChannelSet(interaction, app);
      case "link": return linkModal(interaction, app);
      case "linksave": return linkSave(interaction, app);
      default: return null;
    }
  },

  /** يبني اللوحة المنشورة. تُستدعى عند النشر وعند التحديث. */
  build(app, guild) {
    const ranks = app.staff.list(guild.id);
    const cfg = app.guildConfig.get(guild.id);
    const logo = app.guildConfig.value(guild.id, "staff.panelLogo") || guild.iconURL?.() || null;

    // عدد الطاقم الفعلي: من يحمل أي رتبة من السلم
    const roleIds = new Set(ranks.map((r) => r.role_id));
    let count = 0;
    for (const role of guild.roles.cache.values()) {
      if (roleIds.has(role.id)) count += role.members?.size || 0;
    }

    const highest = ranks.length ? ranks[ranks.length - 1] : null;
    const lowest = ranks.length ? ranks[0] : null;
    const checkinCfg = app.staffCheckin.config(guild.id);
    const todayCount = checkinCfg.enabled ? app.activity.todayCheckIns(guild.id).length : 0;
    const link = app.guildConfig.value(guild.id, "staff.panelLink");

    const text =
      "## 🛡️ لوحة نظام الإدارة\n\n" +
      "مرحبًا بك في لوحة الإدارة. استخدم الأزرار بالأسفل للتفاعل.\n\n" +
      `**📊 إجمالي الإدارة**\n${count}\n\n` +
      `**📈 أعلى رتبة**\n${highest ? `<@&${highest.role_id}>` : "—"}\n\n` +
      `**📉 أدنى رتبة**\n${lowest ? `<@&${lowest.role_id}>` : "—"}\n\n` +
      `**🎖️ رتبة الإدارة المشتركة**\n${cfg.staff?.baseRoleId ? `<@&${cfg.staff.baseRoleId}>` : "غير محددة"}\n\n` +
      (checkinCfg.enabled
        ? `**✅ تسجيل الدخول اليومي**\nمفعّل — حضور اليوم: ${todayCount} من ${count}\n\n`
        : "") +
      (link ? `**🔗 الرابط**\n${link}\n\n` : "") +
      `-# عدد الرتب: ${ranks.length} • آخر تحديث ${timestamp(Date.now(), "R")}`;

    return containerPayload({
      text,
      color: app.config.color("primary"),
      images: logo ? [logo] : [],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("adm:me").setLabel("عرض ملفي").setEmoji("👤").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("adm:ladder").setLabel("سلم الرتب").setEmoji("🪜").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("adm:top:points").setLabel("توب النقاط").setEmoji("🏆").setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("adm:promote").setLabel("ترقية").setEmoji("📈").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("adm:demote").setLabel("تنزيل").setEmoji("📉").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("adm:dismiss").setLabel("سحب").setEmoji("🗑️").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("adm:me").setLabel("احصائياتي").setEmoji("📊").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("adm:top:messages").setLabel("توب الرسائل").setEmoji("💬").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("adm:stats").setLabel("إحصائيات عامة").setEmoji("📋").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("adm:checkin").setLabel("تسجيل دخول").setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId("adm:attend").setLabel("حضور اليوم").setEmoji("📅").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("adm:absence").setLabel("إعدادات الغياب").setEmoji("⚠️").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId("adm:refresh").setLabel("تحديث اللوحة").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId("adm:logo").setLabel("وضع شعار").setEmoji("🖼️").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("adm:link").setLabel("رابط اللوحة").setEmoji("🔗").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId("adm:help").setLabel("مساعدة").setEmoji("❓").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }
};

// ---------------- الشاشات ----------------

async function profile(interaction, app) {
  const guild = interaction.guild;
  const member = interaction.member;
  const weights = app.guildConfig.value(guild.id, "staff.points") || {};
  const pts = app.activity.points(guild.id, member.id, 30, weights);
  const act = app.activity.summary(guild.id, member.id, 30);
  const rank = app.staffService.currentRank(member);
  const b = pts.breakdown;

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "👤 ملفي الإداري",
      color: app.config.color("primary"),
      thumbnail: member.user?.displayAvatarURL?.() || undefined,
      fields: [
        { name: "الاسم", value: truncate(member.nickname || member.displayName || member.user?.username || "—", 60), inline: true },
        { name: "الرتبة", value: rank ? `**${rank.name}**\n<@&${rank.role_id}>` : "لست ضمن الطاقم", inline: true },
        { name: "⭐ النقاط (30 يوم)", value: `**${pts.total}**`, inline: true },
        { name: "الرسائل", value: `\`${act.messages}\``, inline: true },
        { name: "الوقت الصوتي", value: formatDuration((act.voice_seconds || 0) * 1000), inline: true },
        { name: "متوسط التقييم", value: pts.raw.ratingCount ? `${pts.raw.averageStars} من 5` : "—", inline: true },
        { name: "تذاكر مستلمة", value: `\`${act.tickets_claimed}\``, inline: true },
        { name: "تذاكر مغلقة", value: `\`${act.tickets_closed}\``, inline: true },
        { name: "عدد التقييمات", value: `\`${pts.raw.ratingCount}\``, inline: true },
        {
          name: "توزيع النقاط",
          value: `رسائل \`${b.messages}\` • استلام \`${b.claims}\` • إغلاق \`${b.closes}\` • صوت \`${b.voice}\` • تقييم \`${b.ratings}\``
        }
      ]
    })],
    flags: 64
  });
}

async function ladder(interaction, app) {
  const guild = interaction.guild;
  const ranks = app.staff.list(guild.id);
  const mine = app.staffService.currentRank(interaction.member);

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "🪜 سلم الرتب الإدارية",
      description: ranks.length
        ? ranks
            .slice()
            .reverse()
            .map((r) => {
              const here = mine && r.role_id === mine.role_id;
              return `${here ? "➤" : "\u3000"} \`${r.position}.\` **${r.name}** — <@&${r.role_id}>`;
            })
            .join("\n")
        : "لم يُضبط السلم بعد.",
      color: app.config.color("primary"),
      footer: mine ? `رتبتك: ${mine.name}` : "لست ضمن الطاقم"
    })],
    flags: 64
  });
}

async function top(interaction, app, kind) {
  const guild = interaction.guild;
  const medals = ["🥇", "🥈", "🥉"];

  if (kind === "points") {
    const weights = app.guildConfig.value(guild.id, "staff.points") || {};
    const rows = app.activity.pointsLeaderboard(guild.id, 30, 10, weights);
    return safeReply(interaction, {
      embeds: [buildEmbed({
        title: "🏆 توب النقاط — آخر 30 يومًا",
        description: rows.length
          ? rows.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.userId}> — **${r.total}** نقطة`).join("\n")
          : "لا توجد بيانات بعد.",
        color: app.config.color("success")
      })],
      flags: 64
    });
  }

  const rows = app.activity.leaderboard(guild.id, "messages", 30, 10);
  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "💬 توب الرسائل — آخر 30 يومًا",
      description: rows.length
        ? rows.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — \`${r.total}\``).join("\n")
        : "لا توجد بيانات بعد.",
      color: app.config.color("primary")
    })],
    flags: 64
  });
}

async function stats(interaction, app) {
  const guild = interaction.guild;
  const ranks = app.staff.list(guild.id);
  const weights = app.guildConfig.value(guild.id, "staff.points") || {};
  const board = app.activity.pointsLeaderboard(guild.id, 30, 100, weights);

  const totalPoints = board.reduce((s, r) => s + r.total, 0);
  const active = board.length;

  // توزيع الطاقم على الرتب
  const perRank = ranks
    .slice()
    .reverse()
    .map((r) => {
      const role = guild.roles.cache.get(r.role_id);
      return `**${r.name}** — \`${role?.members?.size ?? 0}\``;
    })
    .join("\n") || "—";

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "📋 إحصائيات الإدارة العامة",
      color: app.config.color("primary"),
      thumbnail: guild.iconURL?.() || undefined,
      fields: [
        { name: "عدد الرتب", value: `\`${ranks.length}\``, inline: true },
        { name: "إداريون نشطون (30 يوم)", value: `\`${active}\``, inline: true },
        { name: "مجموع النقاط", value: `\`${Math.round(totalPoints * 100) / 100}\``, inline: true },
        { name: "متوسط النقاط", value: `\`${active ? Math.round((totalPoints / active) * 100) / 100 : 0}\``, inline: true },
        { name: "التوزيع على الرتب", value: truncate(perRank, 1000) }
      ]
    })],
    flags: 64
  });
}

async function help(interaction, app) {
  const level = app.permissions.resolveLevel(interaction.member);
  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "❓ دليل لوحة الإدارة",
      color: app.config.color("info"),
      fields: [
        { name: "👤 عرض ملفي / احصائياتي", value: "رتبتك ونقاطك وكل أرقام نشاطك خلال 30 يومًا." },
        { name: "🪜 سلم الرتب", value: "ترتيب الرتب من الأعلى للأدنى، ومؤشر ➤ أمام رتبتك." },
        { name: "🏆 توب النقاط / 💬 توب الرسائل", value: "ترتيب الطاقم. النقاط تجمع الرسائل والتذاكر والصوت والتقييمات." },
        { name: "📋 إحصائيات عامة", value: "أرقام الإدارة كلها وتوزيع الأعضاء على الرتب." },
        {
          name: level >= Level.ADMIN ? "📈 ترقية / 📉 تنزيل / 🗑️ سحب" : "🔒 إجراءات الإدارة العليا",
          value: level >= Level.ADMIN
            ? "ترقية تنقل رتبة للأعلى، والتنزيل للأسفل، والسحب يزيل **كل** رتب السلم دفعة واحدة."
            : "متاحة للإدارة العليا فقط."
        },
        { name: "🔄 تحديث / 🖼️ شعار", value: level >= Level.ADMIN ? "تحديث أرقام اللوحة، أو تغيير صورتها." : "للإدارة العليا فقط." }
      ],
      footer: "كل ردود اللوحة تظهر لك وحدك."
    })],
    flags: 64
  });
}

// ---------------- الإجراءات الإدارية ----------------

const ACTIONS = {
  up: { label: "ترقية", emoji: "📈", color: "success" },
  down: { label: "تنزيل", emoji: "📉", color: "warning" },
  dismiss: { label: "سحب من الطاقم", emoji: "🗑️", color: "danger" }
};

async function pick(interaction, app, action) {
  const meta = ACTIONS[action];
  const select = new UserSelectMenuBuilder()
    .setCustomId(`adm:run:${action}`)
    .setPlaceholder(`اختر العضو المراد ${meta.label}`);

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: `${meta.emoji} ${meta.label}`,
      description:
        action === "dismiss"
          ? "تُزال **كل** رتب السلم الإداري من العضو ومعها رتبة الإدارة المشتركة."
          : action === "up"
            ? "يُنقل العضو رتبة واحدة للأعلى. من ليس بالطاقم يدخل أول رتبة."
            : "يُنقل العضو رتبة واحدة للأسفل. من في أدنى رتبة يخرج من الطاقم.",
      color: app.config.color(meta.color)
    })],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64
  });
}

async function run(interaction, app, action) {
  const meta = ACTIONS[action];
  if (!meta) return safeReply(interaction, { content: `${app.config.emoji("error")} إجراء غير معروف.`, flags: 64 });

  const userId = interaction.values?.[0];
  if (!userId) return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر عضوًا.`, flags: 64 });

  const target = await interaction.guild.members.fetch(userId).catch(() => null);
  if (!target) return safeReply(interaction, { content: `${app.config.emoji("error")} العضو لم يعد في السيرفر.`, flags: 64 });

  const result = action === "dismiss"
    ? await app.staffService.dismiss(interaction.member, target)
    : await app.staffService.move(interaction.member, target, action);

  if (!result.ok) {
    const messages = {
      noPermission: "ما عندك صلاحية لهذا الإجراء.",
      notStaff: "هذا العضو ليس ضمن الطاقم.",
      atTop: "العضو في أعلى رتبة بالسلم.",
      noRanks: "السلم الإداري فارغ.",
      roleNotFound: "رتبة السلم محذوفة من السيرفر.",
      botHierarchy: "رتبة البوت أقل من الرتبة المطلوبة — ارفعها.",
      hierarchy: "ما تقدر تتصرّف بعضو رتبته مثلك أو أعلى.",
      selfTarget: "ما تقدر تطبّق هذا على نفسك.",
      botTarget: "لا يمكن تطبيق هذا على بوت.",
      actionFailed: `فشل التنفيذ: ${truncate(result.details || "", 150)}`
    };
    return safeUpdate(interaction, {
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} ${messages[result.reason] || "تعذّر التنفيذ."}`,
        color: app.config.color("danger")
      })],
      components: []
    });
  }

  // نحدّث اللوحة المنشورة فالأرقام تغيّرت
  await refreshPublished(app, interaction.guild).catch(() => {});

  const summary = action === "dismiss"
    ? `سُحب <@${userId}> من الطاقم.\nكان: **${result.from.name}** • أُزيلت \`${result.removed}\` رتبة.`
    : `<@${userId}>\n**${result.from?.name || "خارج الطاقم"}** ← **${result.to?.name || "خارج الطاقم"}**`;

  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      title: `${meta.emoji} تم ${meta.label}`,
      description: summary,
      color: app.config.color(meta.color)
    })],
    components: []
  });
}

// ---------------- الشعار والتحديث ----------------

async function logoModal(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "staff.panelLogo") || "";
  const modal = new ModalBuilder().setCustomId("adm:logosave").setTitle("شعار لوحة الإدارة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url")
        .setLabel("رابط الصورة (https) — فارغ لشعار السيرفر")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue(current)
    )
  );
  return safeModal(interaction, modal);
}

async function logoSave(interaction, app) {
  const raw = interaction.fields.getTextInputValue("url").trim();
  if (raw && !/^https:\/\/\S+$/i.test(raw)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} الرابط لازم يبدأ بـ https://`, flags: 64 });
  }

  app.guildConfig.set(interaction.guild.id, "staff.panelLogo", raw || null);
  await refreshPublished(app, interaction.guild).catch(() => {});

  return safeReply(interaction, {
    content: `${app.config.emoji("success")} ${raw ? "تم ضبط الشعار وتحديث اللوحة." : "أُلغي الشعار المخصص، ستُستخدم صورة السيرفر."}`,
    flags: 64
  });
}

async function refresh(interaction, app) {
  await ackComponent(interaction);
  const payload = module.exports.build(app, interaction.guild);
  const done = await safeUpdate(interaction, { flags: payload.flags, components: payload.components });
  if (!done) return null;
  return safeReply(interaction, { content: `${app.config.emoji("success")} حُدِّثت اللوحة.`, flags: 64 });
}

/** يحدّث الرسالة المنشورة بعد أي تغيير يمس الأرقام. */
async function refreshPublished(app, guild) {
  const channelId = app.guildConfig.value(guild.id, "staff.panelChannelId");
  const messageId = app.guildConfig.value(guild.id, "staff.panelMessageId");
  if (!channelId || !messageId) return;

  const channel = await app.client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) return;

  const payload = module.exports.build(app, guild);
  await message.edit({ flags: payload.flags, components: payload.components }).catch(() => {});
}

module.exports.refreshPublished = refreshPublished;

// ---------------- تسجيل الدخول اليومي ----------------

async function checkIn(interaction, app) {
  const guild = interaction.guild;
  const member = interaction.member;
  const svc = app.staffCheckin;

  if (!svc.config(guild.id).enabled) {
    return safeReply(interaction, {
      content: `${app.config.emoji("warning")} نظام تسجيل الدخول غير مفعّل في هذا السيرفر.`,
      flags: 64
    });
  }

  if (!svc.isStaff(guild.id, member)) {
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} تسجيل الدخول مخصص للطاقم الإداري.`,
      flags: 64
    });
  }

  const fresh = app.activity.checkIn(guild.id, member.id, "button");
  const st = svc.status(guild.id, member.id);

  await refreshPublished(app, guild).catch(() => {});

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: fresh ? "✅ تم تسجيل دخولك" : "☑️ مسجّل بالفعل اليوم",
      description: fresh
        ? "سُجّل حضورك لهذا اليوم. شكرًا لالتزامك."
        : "سبق أن سُجّل حضورك اليوم — أول رسالة تكتبها تُسجّلك تلقائيًا.",
      color: app.config.color(fresh ? "success" : "info"),
      fields: [
        { name: "أيام متتالية", value: `\`${st.streak}\``, inline: true },
        { name: "حضور آخر 30 يومًا", value: `\`${st.last30}\``, inline: true }
      ]
    })],
    flags: 64
  });
}

async function attendance(interaction, app) {
  const guild = interaction.guild;
  const svc = app.staffCheckin;

  if (!svc.config(guild.id).enabled) {
    return safeReply(interaction, {
      content: `${app.config.emoji("warning")} نظام تسجيل الدخول غير مفعّل.`,
      flags: 64
    });
  }

  const rep = svc.todayReport(guild);
  const absentList = rep.absent
    .sort((a, b) => (b.days ?? 999) - (a.days ?? 999))
    .slice(0, 20)
    .map((a) => `<@${a.id}> — ${a.days === null ? "لم يسجّل قط" : `غائب ${a.days} يوم`}`)
    .join("\n");

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "📅 حضور اليوم",
      color: app.config.color(rep.absent.length ? "warning" : "success"),
      fields: [
        { name: "إجمالي الطاقم", value: `\`${rep.total}\``, inline: true },
        { name: "✅ حاضر", value: `\`${rep.present.length}\``, inline: true },
        { name: "❌ غائب", value: `\`${rep.absent.length}\``, inline: true },
        {
          name: "الحاضرون",
          value: truncate(rep.present.map((id) => `<@${id}>`).join(" • ") || "—", 1000)
        },
        { name: "الغائبون", value: truncate(absentList || "لا أحد 🎉", 1000) }
      ]
    })],
    flags: 64
  });
}

// ---------------- إعدادات الغياب ----------------

async function absencePanel(interaction, app) {
  const guild = interaction.guild;
  const cfg = app.staffCheckin.config(guild.id);
  const { DEFAULT_WARNING } = require("./StaffCheckinService");
  const custom = cfg.warningText && cfg.warningText !== DEFAULT_WARNING;

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "⚠️ إعدادات تسجيل الدخول والغياب",
      description:
        "الإداري يسجّل دخوله تلقائيًا بأول رسالة يكتبها في أي روم، أو بزر **تسجيل دخول**.\n" +
        "ومن يغيب أكثر من الحد يصله تحذير **مرة واحدة يوميًا**.",
      color: app.config.color(cfg.enabled ? "primary" : "neutral"),
      fields: [
        { name: "الحالة", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
        { name: "التحذير بعد", value: `\`${cfg.warnAfterDays}\` يوم غياب`, inline: true },
        { name: "إرسال بالخاص", value: cfg.dmWarning ? "نعم" : "لا", inline: true },
        { name: "قناة التحذير", value: cfg.warnChannelId ? `<#${cfg.warnChannelId}>` : "غير محددة (الخاص فقط)", inline: true },
        { name: "نص التحذير", value: custom ? "✏️ مخصّص" : "افتراضي", inline: true },
        { name: "معاينة النص", value: truncate(cfg.warningText, 900) }
      ],
      footer: "المتغيرات: {user} {username} {server} {days} {date}"
    })],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("adm:abstoggle").setLabel(cfg.enabled ? "إيقاف النظام" : "تفعيل النظام")
          .setEmoji("🔀").setStyle(cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId("adm:abstext").setLabel("تعديل نص التحذير").setEmoji("✏️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("adm:absdays").setLabel("مدة الغياب").setEmoji("📆").setStyle(ButtonStyle.Primary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("adm:abschan").setLabel("قناة التحذير").setEmoji("📢").setStyle(ButtonStyle.Secondary)
      )
    ],
    flags: 64
  });
}

async function absenceToggle(interaction, app) {
  const cfg = app.staffCheckin.config(interaction.guild.id);
  app.guildConfig.set(interaction.guild.id, "staff.checkin.enabled", !cfg.enabled);
  await refreshPublished(app, interaction.guild).catch(() => {});
  return absencePanel(interaction, app);
}

async function absenceTextModal(interaction, app) {
  const cfg = app.staffCheckin.config(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId("adm:abstextsave").setTitle("نص تحذير الغياب");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("text")
        .setLabel("النص — {user} {server} {days} {date}")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1500)
        .setValue(truncate(cfg.warningText, 1500))
    )
  );
  return safeModal(interaction, modal);
}

async function absenceTextSave(interaction, app) {
  const text = interaction.fields.getTextInputValue("text").trim();
  if (!text) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} النص لا يصح فارغًا.`, flags: 64 });
  }
  app.guildConfig.set(interaction.guild.id, "staff.checkin.warningText", text);

  // معاينة فورية بنفس آلية الإرسال الحقيقية
  const preview = app.staffCheckin.renderWarning(text, {
    member: interaction.member,
    guild: interaction.guild,
    days: app.staffCheckin.config(interaction.guild.id).warnAfterDays
  });

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: `${app.config.emoji("success")} حُفظ نص التحذير`,
      description: `**هكذا سيظهر:**\n\n${truncate(preview, 3500)}`,
      color: app.config.color("success")
    })],
    flags: 64
  });
}

async function absenceDaysModal(interaction, app) {
  const cfg = app.staffCheckin.config(interaction.guild.id);
  const modal = new ModalBuilder().setCustomId("adm:absdayssave").setTitle("مدة الغياب قبل التحذير");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("days")
        .setLabel("عدد أيام الغياب (1-30)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(2)
        .setValue(String(cfg.warnAfterDays))
    )
  );
  return safeModal(interaction, modal);
}

async function absenceDaysSave(interaction, app) {
  const raw = parseInt(interaction.fields.getTextInputValue("days"), 10);
  if (isNaN(raw) || raw < 1 || raw > 30) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} أدخل رقمًا بين 1 و 30.`, flags: 64 });
  }
  app.guildConfig.set(interaction.guild.id, "staff.checkin.warnAfterDays", raw);
  return safeReply(interaction, {
    content: `${app.config.emoji("success")} سيُحذَّر الإداري بعد **${raw}** يوم غياب.`,
    flags: 64
  });
}

async function absenceChannelPick(interaction, app) {
  const select = new ChannelSelectMenuBuilder()
    .setCustomId("adm:abschanset")
    .setPlaceholder("اختر قناة التحذير (أو تجاهل للخاص فقط)")
    .setChannelTypes(ChannelType.GuildText);

  return safeReply(interaction, {
    embeds: [buildEmbed({
      title: "📢 قناة تحذير الغياب",
      description: "التحذير يُرسل في الخاص دائمًا. اختيار قناة يضيف نسخة عامة فيها.",
      color: app.config.color("primary")
    })],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: 64
  });
}

async function absenceChannelSet(interaction, app) {
  const channelId = interaction.values?.[0];
  if (!channelId) return safeReply(interaction, { content: `${app.config.emoji("error")} لم تختر قناة.`, flags: 64 });

  const channel = interaction.guild.channels.cache.get(channelId);
  const me = interaction.guild.members.me;
  if (channel?.permissionsFor && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
    return safeUpdate(interaction, {
      embeds: [buildEmbed({
        description: `${app.config.emoji("error")} لا أملك صلاحية الإرسال في <#${channelId}>.`,
        color: app.config.color("danger")
      })],
      components: []
    });
  }

  app.guildConfig.set(interaction.guild.id, "staff.checkin.warnChannelId", channelId);
  return safeUpdate(interaction, {
    embeds: [buildEmbed({
      description: `${app.config.emoji("success")} ستُنشر التحذيرات في <#${channelId}> إضافةً للخاص.`,
      color: app.config.color("success")
    })],
    components: []
  });
}

// ---------------- رابط اللوحة ----------------

async function linkModal(interaction, app) {
  const current = app.guildConfig.value(interaction.guild.id, "staff.panelLink") || "";
  const modal = new ModalBuilder().setCustomId("adm:linksave").setTitle("رابط اللوحة");
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url")
        .setLabel("الرابط (https) — فارغ للإلغاء")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue(current)
    )
  );
  return safeModal(interaction, modal);
}

async function linkSave(interaction, app) {
  const raw = interaction.fields.getTextInputValue("url").trim();
  if (raw && !/^https?:\/\/\S+$/i.test(raw)) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} الرابط لازم يبدأ بـ http:// أو https://`, flags: 64 });
  }

  app.guildConfig.set(interaction.guild.id, "staff.panelLink", raw || null);
  await refreshPublished(app, interaction.guild).catch(() => {});

  return safeReply(interaction, {
    content: raw
      ? `${app.config.emoji("success")} تم ضبط الرابط وتحديث اللوحة.`
      : `${app.config.emoji("success")} أُلغي الرابط من اللوحة.`,
    flags: 64
  });
}
