const { PermissionFlagsBits, ChannelType } = require("discord.js");
const { buildEmbed, timestamp } = require("../../core/utils/helpers");

const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

/**
 * الإغلاق الطارئ ضد هجمات الإغراق.
 *
 * يمنع الكتابة في كل القنوات مؤقتًا حتى تهدأ الأمور.
 *
 * المبدأ الحاكم: **قابل للعكس تمامًا**.
 * حالة كل قناة قبل القفل تُحفظ في قاعدة البيانات، فتُستعاد بدقة —
 * القناة التي كانت مقفلة أصلًا تبقى مقفلة، والمفتوحة ترجع مفتوحة،
 * والموروثة ترجع موروثة. لا نفترض أن الجميع كان مفتوحًا.
 */
class LockdownService {
  constructor(app) {
    this.app = app;
  }

  active(guildId) {
    return this.app.oversight.getLockdown(guildId);
  }

  /** يقرأ حالة القناة الحالية لـ @everyone: مسموح، ممنوع، أو موروث. */
  static currentState(channel, everyoneId) {
    const overwrite = channel.permissionOverwrites.cache.get(everyoneId);
    if (!overwrite) return null;
    if (overwrite.deny.has(PermissionFlagsBits.SendMessages)) return false;
    if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) return true;
    return null;
  }

  async start({ guild, actor, reason, exclude = [] }) {
    if (this.active(guild.id)) return { ok: false, reason: "already" };

    const me = guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return { ok: false, reason: "missingPermission" };
    }

    const everyoneId = guild.roles.everyone.id;
    const saved = [];
    let locked = 0;
    let skipped = 0;

    for (const channel of guild.channels.cache.values()) {
      if (!LOCKABLE.includes(channel.type)) continue;
      if (exclude.includes(channel.id)) continue;
      if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageChannels)) {
        skipped++;
        continue;
      }

      const previous = LockdownService.currentState(channel, everyoneId);
      if (previous === false) continue; // مقفلة أصلًا — لا نلمسها ولا نسجّلها

      saved.push({ id: channel.id, previous });
      const ok = await channel.permissionOverwrites
        .edit(everyoneId, { SendMessages: false }, { reason: `إغلاق طارئ بواسطة ${actor.user.tag}` })
        .then(() => true)
        .catch(() => false);

      if (ok) locked++;
      else {
        skipped++;
        saved.pop();
      }
    }

    this.app.oversight.saveLockdown({ guildId: guild.id, startedBy: actor.id, reason, channels: saved });
    await this._log(guild, "🔒 بدء الإغلاق الطارئ", actor.id, { locked, skipped, reason });

    return { ok: true, locked, skipped };
  }

  /** يستعيد الحالة السابقة لكل قناة بدقة. */
  async end({ guild, actor }) {
    const record = this.active(guild.id);
    if (!record) return { ok: false, reason: "notActive" };

    const everyoneId = guild.roles.everyone.id;
    let restored = 0;
    let missing = 0;

    for (const entry of record.channels) {
      const channel = guild.channels.cache.get(entry.id);
      if (!channel) {
        missing++;
        continue;
      }
      // null يعيد الصلاحية للوضع الموروث بدل فرض السماح
      const ok = await channel.permissionOverwrites
        .edit(everyoneId, { SendMessages: entry.previous }, { reason: `إنهاء الإغلاق الطارئ بواسطة ${actor.user.tag}` })
        .then(() => true)
        .catch(() => false);
      if (ok) restored++;
    }

    this.app.oversight.clearLockdown(guild.id);
    await this._log(guild, "🔓 إنهاء الإغلاق الطارئ", actor.id, {
      restored,
      missing,
      duration: Date.now() - record.started_at
    });

    return { ok: true, restored, missing };
  }

  async _log(guild, title, actorId, extra) {
    const channelId = this.app.guildConfig.value(guild.id, "logs.security") || this.app.guildConfig.value(guild.id, "logs.channels");
    if (!channelId) return;
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const fields = [{ name: "المنفّذ", value: `<@${actorId}>`, inline: true }];
    if (extra.locked !== undefined) fields.push({ name: "قنوات مقفلة", value: `\`${extra.locked}\``, inline: true });
    if (extra.restored !== undefined) fields.push({ name: "قنوات مستعادة", value: `\`${extra.restored}\``, inline: true });
    if (extra.skipped) fields.push({ name: "تُخطّيت", value: `\`${extra.skipped}\``, inline: true });
    if (extra.reason) fields.push({ name: "السبب", value: String(extra.reason).slice(0, 500) });

    await channel
      .send({ embeds: [buildEmbed({ title, color: this.app.config.color("danger"), fields })] })
      .catch(() => {});
  }

  statusEmbed(guild, record) {
    if (!record) {
      return buildEmbed({
        title: "🔓 لا يوجد إغلاق طارئ",
        description: "السيرفر يعمل بشكل طبيعي.",
        color: this.app.config.color("success")
      });
    }
    return buildEmbed({
      title: "🔒 الإغلاق الطارئ نشط",
      color: this.app.config.color("danger"),
      fields: [
        { name: "بدأه", value: `<@${record.started_by}>`, inline: true },
        { name: "منذ", value: timestamp(record.started_at, "R"), inline: true },
        { name: "القنوات المقفلة", value: `\`${record.channels.length}\``, inline: true },
        ...(record.reason ? [{ name: "السبب", value: String(record.reason).slice(0, 1000) }] : [])
      ],
      footer: "أنهه بـ /lockdown end لاستعادة الحالة السابقة بدقة"
    });
  }
}

module.exports = LockdownService;
