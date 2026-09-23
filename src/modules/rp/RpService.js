const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, PermissionFlagsBits } = require("discord.js");
const { buildEmbed, timestamp, truncate, formatDuration } = require("../../core/utils/helpers");
const { containerPayload } = require("../../core/utils/componentsV2");

/**
 * أنظمة الحياة الواقعية (RP).
 *
 * تُبنى فوق نظام الاقتصاد الموجود: كل حركة مال تمر عبر `economyService`
 * لا عبر جدول منفصل، فيبقى الرصيد مصدرًا واحدًا للحقيقة.
 *
 * حالة السجن محفوظة في القاعدة لا في الذاكرة، ويُفحص المستحقون عند الإقلاع
 * وكل دقيقة — فتنجو من إعادة تشغيل البوت كما طُلب.
 */
class RpService {
  constructor(app) {
    this.app = app;
    this.timer = null;
  }

  start() {
    this.timer = setInterval(() => this.tick().catch(() => {}), 60_000);
    if (this.timer.unref) this.timer.unref();
    // فحص فوري عند الإقلاع: سجناء انتهت مدتهم أثناء توقف البوت
    this.tick().catch(() => {});
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  config(guildId) {
    return this.app.guildConfig.value(guildId, "rp") || {};
  }

  enabled(guildId) {
    return !!this.config(guildId).enabled;
  }

  money(guildId, amount) {
    return this.app.economyService.format(guildId, amount);
  }

  async log(guildId, key, embed) {
    const channelId = this.app.guildConfig.value(guildId, `logs.${key}`);
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
  }

  // ---------------- الفحص الدوري ----------------

  async tick() {
    for (const record of this.app.rp.dueJails()) {
      const guild = this.app.client.guilds.cache.get(record.guild_id);
      if (!guild) continue;
      await this.releaseJail(guild, record, null, true).catch((err) =>
        this.app.errors.capture(err, { system: "rp/jailRelease", guildId: record.guild_id })
      );
    }
  }

  // ---------------- الوظائف ----------------

  jobsPanelPayload(guild) {
    const jobs = this.app.rp.listJobs(guild.id);
    const cfg = this.config(guild.id);

    if (!jobs.length) {
      return containerPayload({
        text: "## 💼 مكتب التوظيف\n\nما فيه وظائف معرّفة بعد. أضِفها بـ `/وظيفة انشاء`.",
        color: 0x808080
      });
    }

    const rows = [];
    let row = new ActionRowBuilder();
    for (const job of jobs.slice(0, 25)) {
      if (row.components.length === 5) { rows.push(row); row = new ActionRowBuilder(); }
      const button = new ButtonBuilder()
        .setCustomId(`rp:job:take:${job.key}`)
        .setLabel(truncate(job.label, 80))
        .setStyle(ButtonStyle.Primary);
      try { if (job.emoji) button.setEmoji(job.emoji); } catch { /* إيموجي غير صالح */ }
      row.addComponents(button);
    }
    if (row.components.length) rows.push(row);

    return containerPayload({
      text:
        "## 💼 اختر وظيفتك المدنية\n\n" +
        "اضغط على زر للحصول على الدور الوظيفي.\n" +
        "**يمكنك شغل دور وظيفي واحد فقط في كل مرة.**",
      color: 0x5865F2,
      images: cfg.jobsImageUrl ? [cfg.jobsImageUrl] : [],
      rows: rows.slice(0, 5)
    });
  }

  jobStartPanelPayload(guild, job) {
    return containerPayload({
      text:
        `## ${job.emoji || "💼"} وظيفة ${job.label}\n\n` +
        `اضغط الزر بالأسفل لبدء العمل.\n\n` +
        `-# المدة: ${formatDuration(job.duration_ms)}` +
        (job.cooldown_ms ? ` • التبريد: ${formatDuration(job.cooldown_ms)}` : ""),
      color: 0x5865F2,
      images: job.image_url ? [job.image_url] : [],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rp:job:start:${job.key}`).setLabel(`ابدأ ${job.label}`).setEmoji("▶️").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`rp:job:collect:${job.key}`).setLabel("استلام المكافأة").setEmoji("📦").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  /** يمنح رتبة الوظيفة ويسحب رتب الوظائف الأخرى — وظيفة واحدة في كل مرة. */
  async assignJobRole(guild, member, job) {
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: "missingPermission" };
    if (!job.role_id) return { ok: true, skipped: true };

    const role = guild.roles.cache.get(job.role_id);
    if (!role) return { ok: false, reason: "roleMissing" };
    if (role.managed || role.position >= me.roles.highest.position) return { ok: false, reason: "roleTooHigh" };

    // نمنع تعدد الوظائف: أي رتبة وظيفة أخرى تُسحب أولًا
    const others = this.app.rp.listJobs(guild.id).filter((j) => j.key !== job.key && j.role_id);
    const conflicting = others.filter((j) => member.roles.cache.has(j.role_id));
    if (conflicting.length) {
      return { ok: false, reason: "hasOtherJob", job: conflicting[0] };
    }

    if (member.roles.cache.has(role.id)) return { ok: false, reason: "already" };
    await member.roles.add(role, "اختيار وظيفة مدنية").catch(() => {});
    return { ok: true };
  }

  currentJob(guild, member) {
    return this.app.rp.listJobs(guild.id).find((j) => j.role_id && member.roles.cache.has(j.role_id)) || null;
  }

  locationsEmbed(guild, job, locations) {
    if (!locations.length) {
      return buildEmbed({ description: "ما فيه مواقع مسجّلة لهذه الوظيفة.", color: this.app.config.color("neutral") });
    }
    return buildEmbed({
      title: `${job.emoji || "📍"} مواقع ${job.label}`,
      description: locations.map((l, i) => `**${i + 1}. ${l.name}**${l.note ? `\n${truncate(l.note, 150)}` : ""}`).join("\n\n"),
      color: this.app.config.color("primary"),
      image: locations[0].image_url || undefined,
      footer: locations.length > 1 ? `${locations.length} موقع — الصورة للموقع الأول` : undefined
    });
  }

  // ---------------- الحقيبة ----------------

  inventoryPayload(guild, user, rows, page = 0, perPage = 5) {
    const pages = Math.max(1, Math.ceil(rows.length / perPage));
    const safePage = Math.min(Math.max(0, page), pages - 1);
    const slice = rows.slice(safePage * perPage, safePage * perPage + perPage);

    const body = slice.length
      ? slice
          .map((r, i) => {
            const n = safePage * perPage + i + 1;
            const label = r.label || r.item_key;
            return `**${n} | ${r.emoji ? `${r.emoji} ` : ""}${label}**\n• الكمية | \`${r.amount}\`${r.sell_price ? ` • سعر البيع | ${this.money(guild.id, r.sell_price)}` : ""}`;
          })
          .join("\n\n")
      : "الحقيبة فارغة.";

    return containerPayload({
      text:
        `## 🎒 الحقيبة الشخصية\n\n` +
        `**الحامل:** <@${user.id}>\n\n` +
        `${body}\n\n` +
        `-# صفحة ${safePage + 1} من ${pages} • ${rows.length} عنصر`,
      color: 0xC9A227,
      rows: pages > 1
        ? [
            new ActionRowBuilder().addComponents(
              // معرّف المالك داخل الزر: لا يقدر غيره يتنقّل في حقيبته
              new ButtonBuilder().setCustomId(`rp:inv:${user.id}:${safePage - 1}`).setLabel("السابق").setEmoji("⬅️").setStyle(ButtonStyle.Danger).setDisabled(safePage === 0),
              new ButtonBuilder().setCustomId(`rp:inv:${user.id}:${safePage + 1}`).setLabel("التالي").setEmoji("➡️").setStyle(ButtonStyle.Danger).setDisabled(safePage >= pages - 1)
            )
          ]
        : []
    });
  }

  // ---------------- السوق السوداء ----------------

  blackMarketPayload(guild) {
    const items = this.app.rp.listItems(guild.id, { illegal: true, buyable: true });
    const cfg = this.config(guild.id);

    if (!items.length) {
      return containerPayload({
        text: "## ☠️ السوق السوداء\n\nما فيه بضاعة معروضة حاليًا.",
        color: 0x2B2D31
      });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId("rp:market:buy")
      .setPlaceholder("اختر المنتج")
      .addOptions(
        items.slice(0, 25).map((it) => {
          const option = {
            label: truncate(it.label, 100),
            description: `السعر | ${it.buy_price}${it.stock !== null ? ` • المتبقي: ${it.stock}` : ""}`,
            value: it.key
          };
          if (it.emoji) { try { option.emoji = it.emoji; } catch { /* تجاهل */ } }
          return option;
        })
      );

    return containerPayload({
      text:
        "## ☠️ أهلاً بك في السوق السوداء\n\n" +
        "❗ خذ ما تريد واخرج سريعًا قبل أن يدركك أحد.",
      color: 0x2B2D31,
      images: cfg.blackMarketImageUrl ? [cfg.blackMarketImageUrl] : [],
      rows: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  // ---------------- السرقات ----------------

  robberyPanelPayload(guild, robbery) {
    return containerPayload({
      text:
        `## ${robbery.emoji || "🏪"} ${robbery.label}\n\n` +
        "اضغط على الزر بالأسفل لبدء السرقة.\n\n" +
        `-# المدة: ${formatDuration(robbery.duration_ms)} • فرصة النجاح: ${robbery.success_percent}%` +
        (robbery.required_item ? `\n-# يتطلب: ${robbery.required_item}` : "") +
        (robbery.min_police ? `\n-# يتطلب وجود ${robbery.min_police} شرطي على الأقل` : ""),
      color: 0xE74C3C,
      images: robbery.image_url ? [robbery.image_url] : [],
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`rp:rob:start:${robbery.key}`).setLabel("ابدأ السرقة").setEmoji("🚨").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`rp:rob:claim:${robbery.key}`).setLabel("إنهاء السرقة").setEmoji("💰").setStyle(ButtonStyle.Secondary)
        )
      ]
    });
  }

  /** عدد الشرطة المباشرين — يعيد استخدام نظام الدوام العسكري الموجود. */
  onlinePolice(guildId) {
    try {
      return this.app.military.activeShifts(guildId).length;
    } catch {
      return 0;
    }
  }

  // ---------------- السجن ----------------

  /**
   * يسجن عضوًا: يحفظ رتبه القابلة للسحب ثم يسحبها، ويمنح رتبة السجن.
   * الرتب المحفوظة تُستعاد بدقة عند الإفراج — بنفس منطق نظام الإجازات.
   */
  async jail(guild, member, { reason, durationMs, jailedBy }) {
    const cfg = this.config(guild.id);
    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return { ok: false, reason: "missingPermission" };

    const exempt = new Set(cfg.jailExemptRoles || []);
    const removable = [...member.roles.cache.keys()].filter((id) => {
      if (id === guild.id) return false;
      if (exempt.has(id)) return false;
      const role = guild.roles.cache.get(id);
      return role && !role.managed && role.position < me.roles.highest.position;
    });

    const record = this.app.rp.jail({
      guildId: guild.id, userId: member.id, reason, durationMs, savedRoles: removable, jailedBy
    });
    if (!record) return { ok: false, reason: "alreadyJailed" };

    for (const roleId of removable) {
      await member.roles.remove(roleId, "سجن").catch(() => {});
    }
    if (cfg.jailRoleId) {
      const role = guild.roles.cache.get(cfg.jailRoleId);
      if (role && !role.managed && role.position < me.roles.highest.position) {
        await member.roles.add(role, "سجن").catch(() => {});
      }
    }

    await this.log(guild.id, "rpJail", buildEmbed({
      title: "🔒 سجن",
      color: this.app.config.color("danger"),
      fields: [
        { name: "العضو", value: `<@${member.id}>`, inline: true },
        { name: "المدة", value: formatDuration(durationMs), inline: true },
        { name: "بواسطة", value: `<@${jailedBy}>`, inline: true },
        ...(reason ? [{ name: "السبب", value: truncate(reason, 500) }] : []),
        { name: "الرتب المسحوبة", value: `\`${removable.length}\``, inline: true }
      ]
    }));

    await member.user.send({
      embeds: [buildEmbed({
        title: "🔒 تم سجنك",
        description: `تم سجنك في **${guild.name}**.${reason ? `\nالسبب: ${reason}` : ""}\nالمدة: ${formatDuration(durationMs)}\nينتهي ${timestamp(record.ends_at, "R")}`,
        color: this.app.config.color("danger")
      })]
    }).catch(() => {});

    return { ok: true, record, removed: removable.length };
  }

  /** يُفرج ويعيد الرتب المحفوظة بدقة. ذرّي: لا يُفرج مرتين. */
  async releaseJail(guild, record, releasedBy, automatic = false) {
    if (!this.app.rp.release(record.id, releasedBy)) return { ok: false, reason: "notJailed" };

    const cfg = this.config(guild.id);
    const member = await guild.members.fetch(record.user_id).catch(() => null);

    if (member) {
      const me = guild.members.me;
      for (const roleId of record.saved_roles || []) {
        const role = guild.roles.cache.get(roleId);
        if (role && !role.managed && role.position < me.roles.highest.position) {
          await member.roles.add(role, "انتهاء السجن").catch(() => {});
        }
      }
      if (cfg.jailRoleId && member.roles.cache.has(cfg.jailRoleId)) {
        await member.roles.remove(cfg.jailRoleId, "انتهاء السجن").catch(() => {});
      }

      await member.user.send({
        embeds: [buildEmbed({
          title: "🔓 انتهى سجنك",
          description: `أُطلق سراحك في **${guild.name}** واستُعيدت رتبك.`,
          color: this.app.config.color("success")
        })]
      }).catch(() => {});
    }

    await this.log(guild.id, "rpJail", buildEmbed({
      title: automatic ? "🔓 إفراج تلقائي" : "🔓 إفراج",
      color: this.app.config.color("success"),
      fields: [
        { name: "العضو", value: `<@${record.user_id}>`, inline: true },
        { name: "الرتب المستعادة", value: `\`${(record.saved_roles || []).length}\``, inline: true },
        ...(releasedBy ? [{ name: "بواسطة", value: `<@${releasedBy}>`, inline: true }] : [])
      ]
    }));

    return { ok: true, restored: (record.saved_roles || []).length };
  }

  jailEmbed(guild, record) {
    return buildEmbed({
      title: "🔒 حالة السجن",
      color: this.app.config.color("danger"),
      fields: [
        { name: "السجين", value: `<@${record.user_id}>`, inline: true },
        { name: "المدة", value: formatDuration(record.duration_ms), inline: true },
        { name: "ينتهي", value: timestamp(record.ends_at, "R"), inline: true },
        ...(record.reason ? [{ name: "السبب", value: truncate(record.reason, 500) }] : []),
        { name: "سجنه", value: `<@${record.jailed_by}>`, inline: true }
      ]
    });
  }

  /** هل العضو مسجون؟ تُستخدم لمنع تنفيذ أوامر RP أثناء السجن. */
  isJailed(guildId, userId) {
    return !!this.app.rp.activeJail(guildId, userId);
  }

  /**
   * يهيّئ صلاحيات رتبة السجن على كل قنوات السيرفر:
   * منع الرؤية في كل مكان، وسماح في قنوات السجن المحددة فقط.
   *
   * هذا ما يجعل الرومات "تختفي" فعليًا للمسجون — لأن سحب رتبه وحده
   * لا يكفي إن كانت القنوات مرئية لـ @everyone.
   *
   * تُستدعى مرة عند الإعداد، وتُعاد عند إضافة قنوات جديدة للسيرفر.
   */
  async setupJailPermissions(guild) {
    const cfg = this.config(guild.id);
    if (!cfg.jailRoleId) return { ok: false, reason: "noRole" };

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return { ok: false, reason: "missingPermission" };

    const role = guild.roles.cache.get(cfg.jailRoleId);
    if (!role) return { ok: false, reason: "roleMissing" };

    const visible = new Set(cfg.jailVisibleChannels || []);
    let hidden = 0, shown = 0, failed = 0;

    for (const channel of guild.channels.cache.values()) {
      // القنوات داخل كاتيغوري ترث منها، لكن نضبطها صراحة ليعمل النظام
      // حتى لو كان للقناة تجاوزات خاصة تكسر الوراثة
      if (!channel.permissionOverwrites?.edit) continue;

      const allow = visible.has(channel.id) || visible.has(channel.parentId);
      const done = await channel.permissionOverwrites
        .edit(role, {
          ViewChannel: allow,
          SendMessages: allow,
          AddReactions: allow,
          Connect: allow,
          Speak: allow
        }, { reason: "تهيئة صلاحيات السجن" })
        .then(() => true)
        .catch(() => false);

      if (!done) failed++;
      else if (allow) shown++;
      else hidden++;
    }

    return { ok: true, hidden, shown, failed, visibleCount: visible.size };
  }

  /** عفو جماعي: يُفرج عن كل المسجونين دفعة واحدة. */
  async amnesty(guild, actorId) {
    const records = this.app.rp.listJailed(guild.id);
    let released = 0, failed = 0;

    for (const record of records) {
      const result = await this.releaseJail(guild, record, actorId).catch(() => ({ ok: false }));
      if (result.ok) released++;
      else failed++;
    }

    if (released) {
      await this.log(guild.id, "rpJail", buildEmbed({
        title: "🕊️ عفو عام",
        description: `أُفرج عن **${released}** سجين دفعة واحدة.`,
        color: this.app.config.color("success"),
        fields: [{ name: "بأمر", value: `<@${actorId}>`, inline: true }]
      }));
    }

    return { released, failed, total: records.length };
  }

  // ---------------- الاعتقال (الكلبشة) ----------------

  isCuffed(guildId, userId) {
    return !!this.app.rp.activeCuff(guildId, userId);
  }

  /**
   * يمنع التصرّف إن كان مسجونًا أو مكلبشًا.
   * الكلبشة أخف من السجن: مؤقتة ولا تسحب رتبًا، لكنها تُجمّد أوامر RP.
   * @returns {null|string} رسالة المنع، أو null إن كان حرًا
   */
  restrictionOf(guildId, userId) {
    if (this.isJailed(guildId, userId)) return "أنت مسجون حاليًا.";
    if (this.isCuffed(guildId, userId)) return "أنت مكلبش — لا يمكنك التصرّف حتى يفكّك أحد رجال الأمن.";
    return null;
  }

  // ---------------- الممتلكات ----------------

  /** لوحة معرض الممتلكات بقائمة اختيار. */
  propertiesPayload(guild, kind) {
    const items = this.app.rp.listProperties(guild.id, kind);
    const title = kind === "house" ? "🏠 معرض العقارات" : "🚗 معرض المركبات";

    if (!items.length) {
      return containerPayload({ text: `## ${title}\n\nما فيه معروضات حاليًا.`, color: 0x808080 });
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(`rp:prop:buy:${kind}`)
      .setPlaceholder("اختر ما تريد شراءه")
      .addOptions(
        items.slice(0, 25).map((p) => {
          const option = {
            label: truncate(p.label, 100),
            description: `السعر | ${p.price}${p.location ? ` • ${p.location}` : ""}${p.stock !== null ? ` • المتبقي: ${p.stock}` : ""}`,
            value: p.key
          };
          if (p.emoji) { try { option.emoji = p.emoji; } catch { /* إيموجي غير صالح */ } }
          return option;
        })
      );

    return containerPayload({
      text: `## ${title}\n\nاختر من القائمة بالأسفل للشراء.\nالمبلغ يُخصم من رصيدك مباشرة.`,
      color: 0xC9A227,
      rows: [new ActionRowBuilder().addComponents(menu)]
    });
  }

  ownedEmbed(guild, user, rows, slot) {
    if (!rows.length) {
      return buildEmbed({
        description: `الشخصية ${slot}: لا تملك أي ممتلكات بعد.`,
        color: this.app.config.color("neutral")
      });
    }
    const cars = rows.filter((r) => r.kind === "vehicle");
    const houses = rows.filter((r) => r.kind === "house");
    const fields = [];
    if (cars.length) {
      fields.push({
        name: `🚗 المركبات (${cars.length})`,
        value: cars.map((c) => `${c.emoji || "•"} **${c.label || c.property_key}**${c.plate ? ` — لوحة \`${c.plate}\`` : ""}`).join("\n")
      });
    }
    if (houses.length) {
      fields.push({
        name: `🏠 العقارات (${houses.length})`,
        value: houses.map((h) => `${h.emoji || "•"} **${h.label || h.property_key}**${h.location ? ` — ${h.location}` : ""}`).join("\n")
      });
    }
    return buildEmbed({
      title: "🔑 ممتلكاتي",
      description: `<@${user.id}> — الشخصية **${slot}**`,
      color: this.app.config.color("primary"),
      fields
    });
  }
}

module.exports = RpService;
