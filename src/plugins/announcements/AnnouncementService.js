const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { nextOccurrence } = require("../../core/utils/time");
const { validateUrl } = require("../../core/utils/safeFetch");
const { truncate } = require("../../core/utils/common");
const { stamp } = require("../../core/interactions/ui");

const COLORS = ["primary", "success", "warning", "danger", "info", "neutral"];
const MENTIONS = ["none", "everyone", "here", "role"];

/**
 * الإعلانات.
 *
 * كل إعلان يمر بحالات صريحة (مسودة → مجدول/إرسال → مُرسل)، وكل انتقال ذرّي
 * في قاعدة البيانات، فلا يُرسل الإعلان مرتين حتى لو ضُغط زر التأكيد مرتين أو
 * تزامن المجدول مع التأكيد. الإرسال للخاص يتم عبر الطابور (بالخلفية مع تقدّم وإلغاء).
 */
class AnnouncementService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
  }

  config(guildId) {
    return { maxScheduled: 50, maxTemplates: 25, dmDelayMs: 1200, draftTtlMs: 900_000, ...(this.app.guildConfig.value(guildId, "announcements") || {}) };
  }

  /** يتحقق من مواصفات الإعلان ويطبّعها. */
  normalize(spec, member) {
    const s = {
      content: spec.content ? String(spec.content).slice(0, 2000) : null,
      title: spec.title ? String(spec.title).slice(0, 256) : null,
      image: spec.image || null,
      color: COLORS.includes(spec.color) ? spec.color : "primary",
      embedId: spec.embedId || null,
      buttons: Array.isArray(spec.buttons) ? spec.buttons.slice(0, 5) : [],
      mention: MENTIONS.includes(spec.mention) ? spec.mention : "none",
      mentionRoleId: spec.mentionRoleId || null,
      asEmbed: !!(spec.asEmbed || spec.title || spec.image)
    };
    if (!s.content && !s.embedId && !s.title) return { ok: false, reason: "empty" };
    if (s.image && !validateUrl(s.image).ok) return { ok: false, reason: "badImage" };
    for (const b of s.buttons) {
      if (!b?.label || !validateUrl(String(b.url || "")).ok) return { ok: false, reason: "badButton" };
    }
    if (s.mention === "role" && !s.mentionRoleId) return { ok: false, reason: "mentionRole" };
    // منشن الجميع/here أو رتبة غير قابلة للمنشن يحتاج صلاحية ديسكورد نفسها عند المُنشئ
    if (member && s.mention !== "none") {
      const role = s.mention === "role" ? member.guild.roles.cache.get(s.mentionRoleId) : null;
      const needs = s.mention !== "role" || (role && !role.mentionable);
      if (needs && !member.permissions.has(PermissionFlagsBits.MentionEveryone)) return { ok: false, reason: "mentionPermission" };
    }
    if (s.embedId && !this.app.embeds.get(s.embedId)) return { ok: false, reason: "embedMissing" };
    return { ok: true, spec: s };
  }

  /** يبني رسالة الإعلان النهائية. */
  build(guild, spec, member = null) {
    const fill = (text) => (text ? this.app.embedService.replaceVariables(text, { member, guild }) : text);
    const mention = spec.mention === "everyone" ? "@everyone" : spec.mention === "here" ? "@here" : spec.mention === "role" ? `<@&${spec.mentionRoleId}>` : "";
    const allowedMentions = spec.mention === "everyone" || spec.mention === "here"
      ? { parse: ["everyone"] }
      : spec.mention === "role" ? { parse: [], roles: [spec.mentionRoleId] } : { parse: [] };

    let payload;
    if (spec.embedId) {
      const record = this.app.embeds.get(spec.embedId);
      payload = record ? this.app.embedService.payload(record, { member, guild, allowMentions: false }) : { content: "—" };
      if (spec.content) payload.content = truncate(fill(spec.content), 2000);
    } else if (spec.asEmbed) {
      payload = {
        embeds: [this.app.theme.embed(guild.id, {
          title: fill(spec.title) || undefined,
          description: spec.content ? truncate(fill(spec.content), 4000) : undefined,
          image: spec.image || undefined,
          color: spec.color,
          footer: guild.name
        })]
      };
    } else {
      payload = { content: truncate(fill(spec.content), 2000 - mention.length - 1) };
    }
    if (mention) payload.content = `${mention}${payload.content ? `\n${payload.content}` : ""}`;
    if (spec.buttons.length) {
      payload.components = [...(payload.components || []), new ActionRowBuilder().addComponents(
        spec.buttons.map((b) => {
          const btn = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(truncate(b.label, 80)).setURL(b.url);
          if (b.emoji) btn.setEmoji(b.emoji);
          return btn;
        })
      )].slice(0, 5);
    }
    payload.allowedMentions = allowedMentions;
    return payload;
  }

  /** ينشئ مسودة للمعاينة ويرجع رسالة المعاينة مع أزرار التأكيد. */
  draft(member, { spec, target, channel, dmRole, runAt = null, repeat = null }) {
    const guild = member.guild;
    const norm = this.normalize(spec, member);
    if (!norm.ok) return norm;
    if (target === "dm" && !dmRole) return { ok: false, reason: "dmRole" };
    if (target === "channel") {
      if (!channel?.isTextBased?.()) return { ok: false, reason: "channel" };
      const perms = channel.permissionsFor?.(guild.members.me);
      if (perms && !perms.has(PermissionFlagsBits.SendMessages)) return { ok: false, reason: "noSend" };
    }
    if (runAt && this.repo.count(guild.id, "scheduled") >= this.config(guild.id).maxScheduled) return { ok: false, reason: "maxScheduled" };
    this.repo.purgeDrafts(Date.now() - this.config(guild.id).draftTtlMs);
    const record = this.repo.create({
      guildId: guild.id, status: "draft", target, channelId: channel?.id || null, dmRoleId: dmRole?.id || null,
      spec: norm.spec, runAt, repeat, createdBy: member.id
    });
    return { ok: true, record, preview: this.previewPayload(guild, record, member) };
  }

  previewPayload(guild, record, member) {
    const t = this.app.i18n.forGuild(guild.id);
    const built = this.build(guild, record.spec, member);
    const where = record.target === "dm" ? `✉️ ${t("ann.dmTo", { role: `<@&${record.dm_role_id}>` })}` : `#️⃣ <#${record.channel_id}>`;
    const when = record.run_at ? `⏰ <t:${Math.floor(record.run_at / 1000)}:F>${record.repeat ? ` 🔁 ${record.repeat.kind}` : ""}` : `⚡ ${t("ann.now")}`;
    const s = stamp();
    return {
      content: `👁️ **${t("ann.preview")}** — ${where} • ${when}\n${built.content ? `\n${built.content}` : ""}`.slice(0, 2000),
      embeds: built.embeds || [],
      components: [
        ...(built.components || []).slice(0, 4),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`ann:confirm:${record.id}:${s}`).setLabel(t(record.run_at ? "ann.confirmSchedule" : "ann.confirmSend")).setEmoji("✅").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`ann:cancel:${record.id}:${s}`).setLabel(t("ann.cancel")).setEmoji("✖️").setStyle(ButtonStyle.Secondary)
        )
      ],
      allowedMentions: { parse: [] }
    };
  }

  /** تأكيد المسودة: إرسال فوري أو تحويلها لمجدولة. */
  async confirm(member, id) {
    const record = this.repo.get(id);
    if (!record || record.guild_id !== member.guild.id || record.status !== "draft") return { ok: false, reason: "expired" };
    if (record.created_by !== member.id) return { ok: false, reason: "notOwner" };
    if (Date.now() - record.created_at > this.config(member.guild.id).draftTtlMs) return { ok: false, reason: "expired" };
    if (record.run_at) {
      if (!this.repo.transition(id, "draft", "scheduled")) return { ok: false, reason: "expired" };
      this.app.scheduler.schedule({ type: "announce:send", guildId: record.guild_id, uniqueKey: `announce:${id}`, runAt: record.run_at, payload: { id } });
      return { ok: true, scheduled: true, runAt: record.run_at };
    }
    if (!this.repo.transition(id, "draft", "sending")) return { ok: false, reason: "expired" };
    return this.deliver(this.repo.get(id), member);
  }

  cancelDraft(member, id) {
    const record = this.repo.get(id);
    if (!record || record.guild_id !== member.guild.id) return { ok: false, reason: "expired" };
    if (record.created_by !== member.id) return { ok: false, reason: "notOwner" };
    return this.repo.transition(id, "draft", "cancelled") ? { ok: true } : { ok: false, reason: "expired" };
  }

  cancelScheduled(guildId, id) {
    const record = this.repo.get(id);
    if (!record || record.guild_id !== guildId) return { ok: false, reason: "notFound" };
    if (!this.repo.transition(id, "scheduled", "cancelled")) return { ok: false, reason: "notScheduled" };
    this.app.scheduler.cancelByKey(`announce:${id}`);
    return { ok: true };
  }

  /** مهمة المجدول. */
  async runScheduled(id) {
    if (!this.repo.transition(id, "scheduled", "sending")) return;
    await this.deliver(this.repo.get(id), null);
  }

  async deliver(record, member) {
    const guild = this.app.client.guilds?.cache?.get(record.guild_id);
    if (!guild) {
      this.repo.setResult(record.id, { error: "guildMissing" }, "failed");
      return { ok: false, reason: "guildMissing" };
    }
    const payload = this.build(guild, record.spec, member);

    if (record.target === "dm") {
      const job = this.app.queue.add("announce:dm", { id: record.id, guildId: guild.id, roleId: record.dm_role_id }, { guildId: guild.id, createdBy: record.created_by, maxAttempts: 1 });
      this._afterSend(record, { queued: job.id });
      return { ok: true, queued: true, jobId: job.id };
    }

    const channel = guild.channels.cache.get(record.channel_id) || (await this.app.client.channels.fetch(record.channel_id).catch(() => null));
    if (!channel?.send) {
      this.repo.setResult(record.id, { error: "channelMissing" }, "failed");
      return { ok: false, reason: "channel" };
    }
    const sent = await channel.send(payload).catch((err) => {
      this.app.logger.warn(`إرسال إعلان #${record.id} فشل: ${err.message}`);
      return null;
    });
    if (!sent) {
      this.repo.setResult(record.id, { error: "sendFailed" }, record.repeat ? "scheduled" : "failed");
      if (record.repeat) this._scheduleNext(record);
      return { ok: false, reason: "sendFailed" };
    }
    this._afterSend(record, { messageId: sent.id });
    this.app.bus.emitSafe("announcement:sent", { guildId: guild.id, guild, id: record.id, channelId: channel.id });
    return { ok: true, messageId: sent.id, channelId: channel.id };
  }

  /** الموعد التالي يُحسب من الموعد المقرر لا من لحظة التنفيذ فقط، فلا يتكرر الإرسال لو تأخر المجدول أو سبق. */
  static nextRun(record) {
    return record.repeat ? nextOccurrence(record.repeat, Math.max(Date.now(), record.run_at || 0)) : null;
  }

  _scheduleNext(record) {
    const next = AnnouncementService.nextRun(record);
    if (!next) return null;
    this.app.scheduler.schedule({ type: "announce:send", guildId: record.guild_id, uniqueKey: `announce:${record.id}`, runAt: next, payload: { id: record.id } });
    return next;
  }

  _afterSend(record, result) {
    const next = AnnouncementService.nextRun(record);
    this.repo.recordSend(record.id, { messageId: result.messageId || null, result, nextRunAt: next, status: next ? "scheduled" : "sent" });
    if (next) this.app.scheduler.schedule({ type: "announce:send", guildId: record.guild_id, uniqueKey: `announce:${record.id}`, runAt: next, payload: { id: record.id } });
  }

  /** عامل الطابور: إرسال للخاص مع تقدّم وإلغاء واحترام حدود ديسكورد. */
  async dmWorker(job, tools) {
    const { id, guildId, roleId } = job.payload;
    const record = this.repo.get(id);
    const guild = this.app.client.guilds?.cache?.get(guildId);
    if (!record || !guild) return { sent: 0, failed: 0 };
    await guild.members.fetch().catch(() => null);
    const role = guild.roles.cache.get(roleId);
    const targets = [...(role?.members?.values?.() || [])].filter((m) => !m.user.bot);
    const payload = this.build(guild, record.spec, null);
    let sent = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      if (tools.isCancelled()) break;
      const ok = await targets[i].send(payload).then(() => true).catch(() => false);
      ok ? sent++ : failed++;
      tools.progress(i + 1, targets.length);
      if (i < targets.length - 1) await tools.sleep(this.config(guildId).dmDelayMs);
    }
    const result = { sent, failed, total: targets.length };
    this.repo.setResult(id, result, this.repo.get(id).status === "scheduled" ? "scheduled" : "sent");
    this.app.bus.emitSafe("broadcast:finished", { guild, executor: guild.members.cache.get(record.created_by) || null, details: `إعلان #${id}: تم الإرسال إلى ${sent} عضو، وفشل ${failed}.` });
    return result;
  }

  // ---------------- القوالب ----------------

  saveTemplate(member, name, spec) {
    const key = String(name || "").trim().toLowerCase();
    if (!/^[\p{L}\p{N}_-]{1,32}$/u.test(key)) return { ok: false, reason: "badName" };
    const norm = this.normalize(spec, member);
    if (!norm.ok) return norm;
    if (!this.repo.template(member.guild.id, key) && this.repo.count(member.guild.id, "template") >= this.config(member.guild.id).maxTemplates) return { ok: false, reason: "maxTemplates" };
    this.repo.saveTemplate(member.guild.id, key, norm.spec, member.id);
    return { ok: true, name: key };
  }

  listPayload(guild) {
    const t = this.app.i18n.forGuild(guild.id);
    const scheduled = this.repo.list(guild.id, ["scheduled", "sending"]);
    const templates = this.repo.list(guild.id, ["template"]);
    const line = (r) => `\`#${r.id}\` ${r.target === "dm" ? `✉️ <@&${r.dm_role_id}>` : `<#${r.channel_id}>`} — <t:${Math.floor((r.run_at || r.created_at) / 1000)}:R>${r.repeat ? ` 🔁 ${r.repeat.kind}` : ""} — ${truncate(r.spec.title || r.spec.content || "—", 60)}`;
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `📢 ${t("ann.listTitle")}`,
        color: "info",
        fields: [
          { name: t("ann.scheduled"), value: scheduled.map(line).join("\n").slice(0, 1024) || "—" },
          { name: t("ann.templates"), value: templates.map((r) => `\`${r.name}\``).join(" ").slice(0, 1024) || "—" }
        ]
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = AnnouncementService;
