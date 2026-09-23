const { Level } = require("../../core/permissions/PermissionService");
const { truncate } = require("../../core/utils/common");

/**
 * تشغيل الأوامر المخصصة.
 *
 * تُقرأ من قاعدة البيانات مرة واحدة لكل سيرفر وتُخزَّن مؤقتًا،
 * فلا يوجد استعلام قاعدة بيانات على كل رسالة تُكتب في السيرفر.
 * الكاش يُبطَل فورًا عند أي تعديل من `/command`.
 */
class CustomCommandService {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // guildId -> { commands, expiresAt }
    this.ttlMs = 300000;
  }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  list(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached.commands;

    const commands = this.app.customCommands.list(guildId);
    this.cache.set(guildId, { commands, expiresAt: Date.now() + this.ttlMs });
    return commands;
  }

  /**
   * يطابق نص الرسالة مع الأوامر المخصصة.
   * كل أمر قد يملك بريفكس خاصًا به، وإلا يستخدم بريفكس السيرفر.
   */
  match(guildId, content, guildPrefix) {
    const commands = this.list(guildId);
    if (!commands.length) return null;

    const trimmed = content.trim();
    let best = null;

    for (const command of commands) {
      const prefix = command.prefix || guildPrefix;
      if (!trimmed.startsWith(prefix)) continue;

      const rest = trimmed.slice(prefix.length);
      if (!rest.startsWith(command.name)) continue;

      // لازم ينتهي اسم الأمر عند مسافة أو نهاية الرسالة، حتى لا يطابق "تفعيلات" أمرَ "تفعيل"
      const after = rest.slice(command.name.length);
      if (after && !/^\s/.test(after)) continue;

      // عند تعدد المطابقات نأخذ الأطول اسمًا (الأكثر تحديدًا)
      if (!best || command.name.length > best.command.name.length) {
        best = { command, args: after.trim() };
      }
    }

    return best;
  }

  async run(message, command) {
    const level = this.app.permissions.resolveLevel(message.member);
    if (level < (command.min_level || 0)) return false;

    let payload;
    if (command.embed_id) {
      const record = this.app.embeds.get(command.embed_id);
      if (!record) {
        // الإمبيد حُذف — نخبر الإدارة فقط بدل إزعاج الأعضاء
        if (level >= Level.ADMIN) {
          await message.reply({
            content: `${this.app.config.emoji("warning")} الإمبيد المرتبط بهذا الأمر محذوف. عدّله بـ \`/command edit\`.`,
            allowedMentions: { parse: [] }
          }).catch(() => {});
        }
        return true;
      }
      payload = this.app.embedService.payload(record, {
        member: message.member,
        guild: message.guild,
        allowMentions: !!command.allow_mentions
      });
      if (command.content) {
        payload.content = truncate(
          this.app.embedService.replaceVariables(command.content, { member: message.member, guild: message.guild }),
          2000
        );
      }
    } else {
      payload = {
        content: truncate(
          this.app.embedService.replaceVariables(command.content, { member: message.member, guild: message.guild }),
          2000
        ),
        allowedMentions: command.allow_mentions ? { parse: ["users", "roles", "everyone"] } : { parse: ["users"] }
      };
    }

    const sent = await message.channel.send(payload).catch(() => null);
    if (!sent) return true;

    // تتبّع الرسالة حتى تُحدَّث تلقائيًا عند تعديل الإمبيد لاحقًا
    if (command.embed_id) {
      this.app.embeds.trackMessage({
        embedId: command.embed_id,
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: sent.id
      });
    }

    this.app.customCommands.recordUse(command.id);

    if (command.delete_trigger) {
      await message.delete().catch(() => {});
    }

    return true;
  }
}

module.exports = CustomCommandService;
