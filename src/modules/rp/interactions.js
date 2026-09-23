const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { buildEmbed, formatDuration, timestamp, truncate } = require("../../core/utils/helpers");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * تفاعلات أنظمة RP. البادئة `rp:`.
 *
 * كل إجراء يُعيد قراءة الحالة من القاعدة عند الضغط — لا يثق ببيانات الرسالة
 * المعروضة، فضغطتان متزامنتان لا تُنتجان مكافأتين ولا شراءين.
 */
module.exports = {
  prefix: "rp",

  async handle(interaction, app) {
    const parts = interaction.customId.split(":");
    const group = parts[1];

    if (!app.rpService.enabled(interaction.guild.id)) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} أنظمة المدينة معطّلة حاليًا.`, flags: 64 });
    }

    if (group === "inv") return paginate(interaction, app, parts[2], parseInt(parts[3], 10));
    if (group === "job") return job(interaction, app, parts[2], parts[3]);
    if (group === "market") return market(interaction, app);
    if (group === "rob") return robbery(interaction, app, parts[2], parts[3]);
    if (group === "prop") return property(interaction, app, parts[3]);
    return null;
  }
};

/** التنقّل في الحقيبة — لصاحبها فقط. */
async function paginate(interaction, app, ownerId, page) {
  if (interaction.user.id !== ownerId) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذه حقيبة عضو آخر.`, flags: 64 });
  }
  const rows = app.rp.inventory(interaction.guild.id, ownerId);
  const payload = app.rpService.inventoryPayload(interaction.guild, interaction.user, rows, page);
  return safeUpdate(interaction, { flags: payload.flags, components: payload.components });
}

// ---------------- الوظائف ----------------

async function job(interaction, app, action, jobKey) {
  const guild = interaction.guild;
  const member = interaction.member;
  const svc = app.rpService;

  const jobRecord = app.rp.getJob(guild.id, jobKey);
  if (!jobRecord || !jobRecord.enabled) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذه الوظيفة لم تعد متاحة.`, flags: 64 });
  }

  const blocked = svc.restrictionOf(guild.id, member.id);
  if (blocked) return safeReply(interaction, { content: `${app.config.emoji("error")} ${blocked}`, flags: 64 });

  if (action === "take") {
    const result = await svc.assignJobRole(guild, member, jobRecord);
    if (!result.ok) {
      const messages = {
        hasOtherJob: `عندك وظيفة أخرى (**${result.job?.label}**). اسحبها أولًا قبل أخذ وظيفة جديدة.`,
        already: "أنت تحمل هذه الوظيفة بالفعل.",
        roleMissing: "رتبة الوظيفة محذوفة — راجع الإدارة.",
        roleTooHigh: "رتبة البوت أقل من رتبة الوظيفة — راجع الإدارة.",
        missingPermission: "البوت يفتقد صلاحية إدارة الرتب."
      };
      return safeReply(interaction, { content: `${app.config.emoji("error")} ${messages[result.reason] || "تعذّر منحك الوظيفة."}`, flags: 64 });
    }

    await svc.log(guild.id, "rpJobs", buildEmbed({
      title: "💼 وظيفة جديدة",
      color: app.config.color("success"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الوظيفة", value: jobRecord.label, inline: true }
      ]
    }));

    return safeReply(interaction, { content: `${app.config.emoji("success")} حصلت على وظيفة **${jobRecord.label}**!`, flags: 64 });
  }

  if (action === "start") {
    // لا بد أن يحمل رتبة الوظيفة إن كانت محددة
    if (jobRecord.role_id && !member.roles.cache.has(jobRecord.role_id)) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} تحتاج وظيفة **${jobRecord.label}** أولًا.`, flags: 64 });
    }

    const cooldownLeft = jobRecord.cooldown_ms
      ? app.rp.lastSessionEnd(guild.id, member.id, jobKey) + jobRecord.cooldown_ms - Date.now()
      : 0;
    if (cooldownLeft > 0) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} انتظر ${formatDuration(cooldownLeft)} قبل العمل مجددًا.`, flags: 64 });
    }

    const session = app.rp.startSession({ guildId: guild.id, userId: member.id, jobKey, durationMs: jobRecord.duration_ms });
    if (!session) {
      const open = app.rp.openSession(guild.id, member.id);
      const ready = open && open.ends_at <= Date.now();
      return safeReply(interaction, {
        content: ready
          ? `${app.config.emoji("warning")} عندك عمل جاهز للاستلام — اضغط **استلام المكافأة**.`
          : `${app.config.emoji("warning")} أنت تعمل بالفعل، ينتهي ${timestamp(open.ends_at, "R")}.`,
        flags: 64
      });
    }

    await svc.log(guild.id, "rpJobs", buildEmbed({
      title: "▶️ بدء عمل",
      color: app.config.color("info"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الوظيفة", value: jobRecord.label, inline: true }
      ]
    }));

    return safeReply(interaction, {
      content: `${app.config.emoji("success")} بدأت العمل في **${jobRecord.label}**.\nينتهي ${timestamp(session.ends_at, "R")} — بعدها اضغط **استلام المكافأة**.`,
      flags: 64
    });
  }

  if (action === "collect") {
    const session = app.rp.openSession(guild.id, member.id);
    if (!session) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} ما عندك عمل جارٍ. اضغط **ابدأ** أولًا.`, flags: 64 });
    }
    if (session.ends_at > Date.now()) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} العمل ما خلص بعد، ينتهي ${timestamp(session.ends_at, "R")}.`, flags: 64 });
    }

    const sessionJob = app.rp.getJob(guild.id, session.job_key) || jobRecord;
    const min = Math.max(0, sessionJob.reward_min);
    const max = Math.max(min, sessionJob.reward_max);
    const qty = Math.floor(Math.random() * (max - min + 1)) + min;

    // الجمع ذرّي: أول ضغطة فقط تنجح، فلا تتكرر المكافأة
    if (!app.rp.collectSession(session.id, sessionJob.reward_item, qty)) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} استلمت هذه المكافأة بالفعل.`, flags: 64 });
    }

    let text = `${app.config.emoji("success")} انتهى العمل!`;
    if (sessionJob.reward_item && qty > 0) {
      app.rp.give({ guildId: guild.id, userId: member.id, itemKey: sessionJob.reward_item, amount: qty, reason: `عمل: ${sessionJob.label}` });
      const item = app.rp.getItem(guild.id, sessionJob.reward_item);
      text += `\n📦 حصلت على **${qty}** × ${item?.label || sessionJob.reward_item}`;
    }

    await svc.log(guild.id, "rpJobs", buildEmbed({
      title: "📦 استلام مكافأة عمل",
      color: app.config.color("success"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الوظيفة", value: sessionJob.label, inline: true },
        { name: "المكافأة", value: `${qty} × ${sessionJob.reward_item || "—"}`, inline: true }
      ]
    }));

    return safeReply(interaction, { content: text, flags: 64 });
  }

  return null;
}

// ---------------- السوق السوداء ----------------

async function market(interaction, app) {
  const guild = interaction.guild;
  const member = interaction.member;
  const svc = app.rpService;
  const key = interaction.values[0];

  const blocked = svc.restrictionOf(guild.id, member.id);
  if (blocked) return safeReply(interaction, { content: `${app.config.emoji("error")} ${blocked}`, flags: 64 });

  const item = app.rp.getItem(guild.id, key);
  if (!item || !item.enabled || item.buy_price === null) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا المنتج لم يعد متاحًا.`, flags: 64 });
  }

  // الخصم أولًا (ذرّي)، ثم المخزون، ثم التسليم — وأي فشل يُعيد ما قبله
  const charged = app.economyService.charge(guild.id, member.id, item.buy_price, {
    reason: `شراء ${item.label}`, refType: "blackmarket", refId: item.key
  });
  if (!charged.ok) {
    const account = app.economyService.account(guild.id, member.id);
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} رصيدك ما يكفي. السعر ${svc.money(guild.id, item.buy_price)} والمتاح ${svc.money(guild.id, app.economyService.total(account))}`,
      flags: 64
    });
  }

  const stock = app.rp.consumeStock(guild.id, key, 1);
  if (!stock.ok) {
    // نُعيد المبلغ فورًا لأن السلعة نفدت بعد الخصم
    app.economyService.add(guild.id, member.id, item.buy_price, { reason: "إرجاع: نفاد المخزون" });
    return safeReply(interaction, { content: `${app.config.emoji("error")} نفدت الكمية من هذا المنتج.`, flags: 64 });
  }

  app.rp.give({ guildId: guild.id, userId: member.id, itemKey: key, amount: 1, reason: "شراء من السوق السوداء" });

  await svc.log(guild.id, "rpMarket", buildEmbed({
    title: "☠️ شراء من السوق السوداء",
    color: app.config.color("warning"),
    fields: [
      { name: "المشتري", value: `<@${member.id}>`, inline: true },
      { name: "المنتج", value: item.label, inline: true },
      { name: "السعر", value: svc.money(guild.id, item.buy_price), inline: true }
    ]
  }));

  return safeReply(interaction, {
    content: `${app.config.emoji("success")} اشتريت **${item.label}** مقابل ${svc.money(guild.id, item.buy_price)}.\n🎒 صار عندك: \`${app.rp.amountOf(guild.id, member.id, key)}\``,
    flags: 64
  });
}

// ---------------- السرقات ----------------

async function robbery(interaction, app, action, key) {
  const guild = interaction.guild;
  const member = interaction.member;
  const svc = app.rpService;

  const rob = app.rp.getRobbery(guild.id, key);
  if (!rob || !rob.enabled) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذه السرقة لم تعد متاحة.`, flags: 64 });
  }

  const blocked = svc.restrictionOf(guild.id, member.id);
  if (blocked) return safeReply(interaction, { content: `${app.config.emoji("error")} ${blocked}`, flags: 64 });

  if (action === "start") {
    if (rob.min_police > 0) {
      const police = svc.onlinePolice(guild.id);
      if (police < rob.min_police) {
        return safeReply(interaction, {
          content: `${app.config.emoji("warning")} تحتاج **${rob.min_police}** شرطي مباشر على الأقل. المتاح الآن: **${police}**.`,
          flags: 64
        });
      }
    }

    if (rob.required_item && app.rp.amountOf(guild.id, member.id, rob.required_item) < 1) {
      const item = app.rp.getItem(guild.id, rob.required_item);
      return safeReply(interaction, { content: `${app.config.emoji("error")} لا تملك **${item?.label || rob.required_item}**.`, flags: 64 });
    }

    const cooldownLeft = rob.cooldown_ms
      ? app.rp.lastRobberyEnd(guild.id, member.id, key) + rob.cooldown_ms - Date.now()
      : 0;
    if (cooldownLeft > 0) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} انتظر ${formatDuration(cooldownLeft)} قبل سرقة أخرى.`, flags: 64 });
    }

    const session = app.rp.startRobbery({ guildId: guild.id, userId: member.id, robberyKey: key, durationMs: rob.duration_ms });
    if (!session) {
      const open = app.rp.openRobbery(guild.id, member.id);
      return safeReply(interaction, {
        content: open.ends_at <= Date.now()
          ? `${app.config.emoji("warning")} عندك سرقة جاهزة — اضغط **إنهاء السرقة**.`
          : `${app.config.emoji("warning")} أنت في سرقة جارية، تنتهي ${timestamp(open.ends_at, "R")}.`,
        flags: 64
      });
    }

    await svc.log(guild.id, "rpRobbery", buildEmbed({
      title: "🚨 بدء سرقة",
      color: app.config.color("warning"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الهدف", value: rob.label, inline: true }
      ]
    }));

    return safeReply(interaction, {
      content: `${app.config.emoji("success")} بدأت **${rob.label}**!\nتنتهي ${timestamp(session.ends_at, "R")} — بعدها اضغط **إنهاء السرقة**.`,
      flags: 64
    });
  }

  if (action === "claim") {
    const session = app.rp.openRobbery(guild.id, member.id);
    if (!session) return safeReply(interaction, { content: `${app.config.emoji("warning")} ما عندك سرقة جارية.`, flags: 64 });
    if (session.ends_at > Date.now()) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} ما خلصت بعد، تنتهي ${timestamp(session.ends_at, "R")}.`, flags: 64 });
    }

    const sessionRob = app.rp.getRobbery(guild.id, session.robbery_key) || rob;
    const success = Math.random() * 100 < sessionRob.success_percent;
    const reward = success
      ? Math.floor(Math.random() * (sessionRob.reward_max - sessionRob.reward_min + 1)) + sessionRob.reward_min
      : 0;

    // الحسم ذرّي: أول ضغطة فقط تحدد النتيجة وتصرف المكافأة
    if (!app.rp.resolveRobbery(session.id, success, reward)) {
      return safeReply(interaction, { content: `${app.config.emoji("warning")} حُسمت هذه السرقة بالفعل.`, flags: 64 });
    }

    if (sessionRob.consume_item && sessionRob.required_item) {
      app.rp.take({ guildId: guild.id, userId: member.id, itemKey: sessionRob.required_item, amount: 1, reason: "استُهلك في السرقة" });
    }

    let text;
    if (success) {
      app.economyService.add(guild.id, member.id, reward, { target: "wallet", reason: `سرقة: ${sessionRob.label}` });
      text = `${app.config.emoji("success")} نجحت السرقة!\n💰 حصلت على ${svc.money(guild.id, reward)}`;

      // النجاح يجعله مطلوبًا — يربط السرقة بنظام المطلوبين
      if (svc.config(guild.id).wantedOnRobbery) {
        app.rp.addWanted({ guildId: guild.id, userId: member.id, level: 1, reason: `سرقة ${sessionRob.label}`, addedBy: app.client.user.id });
        text += "\n🚔 صرت **مطلوبًا** للشرطة.";
      }
    } else {
      text = `${app.config.emoji("error")} فشلت السرقة! لم تحصل على شيء.`;
    }

    await svc.log(guild.id, "rpRobbery", buildEmbed({
      title: success ? "💰 سرقة ناجحة" : "🚫 سرقة فاشلة",
      color: app.config.color(success ? "success" : "danger"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "الهدف", value: sessionRob.label, inline: true },
        { name: "الغنيمة", value: success ? svc.money(guild.id, reward) : "لا شيء", inline: true }
      ]
    }));

    return safeReply(interaction, { content: text, flags: 64 });
  }

  return null;
}

// ---------------- الممتلكات ----------------

async function property(interaction, app, kind) {
  const guild = interaction.guild;
  const member = interaction.member;
  const svc = app.rpService;

  const blocked = svc.restrictionOf(guild.id, member.id);
  if (blocked) return safeReply(interaction, { content: `${app.config.emoji("error")} ${blocked}`, flags: 64 });

  const key = interaction.values[0];
  const prop = app.rp.getProperty(guild.id, key);
  if (!prop || !prop.enabled) {
    return safeReply(interaction, { content: `${app.config.emoji("error")} هذا المعروض لم يعد متاحًا.`, flags: 64 });
  }

  // الممتلكات تُنسب للشخصية النشطة، فلكل شخصية أملاكها
  const slot = app.rp.activeSlot(guild.id, member.id);

  if (app.rp.ownsProperty(guild.id, member.id, slot, key)) {
    return safeReply(interaction, { content: `${app.config.emoji("warning")} تملك **${prop.label}** بالفعل بهذه الشخصية.`, flags: 64 });
  }

  // الخصم أولًا وذرّيًا، ثم المخزون، وأي فشل بعده يُعيد المبلغ
  const charged = app.economyService.charge(guild.id, member.id, prop.price, {
    reason: `شراء ${prop.label}`, refType: "property", refId: prop.key
  });
  if (!charged.ok) {
    const account = app.economyService.account(guild.id, member.id);
    return safeReply(interaction, {
      content: `${app.config.emoji("error")} رصيدك ما يكفي. السعر ${svc.money(guild.id, prop.price)} والمتاح ${svc.money(guild.id, app.economyService.total(account))}`,
      flags: 64
    });
  }

  const stock = app.rp.consumePropertyStock(guild.id, key);
  if (!stock.ok) {
    app.economyService.add(guild.id, member.id, prop.price, { reason: "إرجاع: نفدت الكمية" });
    return safeReply(interaction, { content: `${app.config.emoji("error")} نفدت الكمية من **${prop.label}**.`, flags: 64 });
  }

  // لوحة عشوائية للمركبات فقط، لتمييزها في الروليبلاي
  const plate = prop.kind === "vehicle"
    ? `${Math.random().toString(36).slice(2, 5).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`
    : null;

  const owned = app.rp.addOwnership({
    guildId: guild.id, userId: member.id, slot, propertyKey: key, plate, price: prop.price
  });

  await svc.log(guild.id, "rpMarket", buildEmbed({
    title: prop.kind === "house" ? "🏠 شراء عقار" : "🚗 شراء مركبة",
    color: app.config.color("success"),
    fields: [
      { name: "المشتري", value: `<@${member.id}> (شخصية ${slot})`, inline: true },
      { name: "الممتلك", value: prop.label, inline: true },
      { name: "السعر", value: svc.money(guild.id, prop.price), inline: true },
      ...(plate ? [{ name: "اللوحة", value: `\`${plate}\``, inline: true }] : [])
    ]
  }));

  return safeReply(interaction, {
    content:
      `${app.config.emoji("success")} اشتريت **${prop.label}** مقابل ${svc.money(guild.id, prop.price)}.` +
      (plate ? `\n🔖 لوحة المركبة: \`${plate}\`` : "") +
      `\n🔑 شوف ممتلكاتك بـ \`/ممتلكاتي\``,
    flags: 64
  });
}
