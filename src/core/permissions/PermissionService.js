const { PermissionsBitField } = require("discord.js");

/** مستويات الصلاحية. أي رقم أعلى يشمل كل ما دونه. */
const Level = {
  EVERYONE: 0,
  STAFF: 1,
  MODERATOR: 2,
  ADMIN: 3,
  GUILD_OWNER: 4,
  DEVELOPER: 5
};

/**
 * محرك الصلاحيات المركزي.
 *
 * قاعدة أساسية: هذا المحرك هو المصدر الوحيد للحقيقة، ويُستدعى من الخادم
 * عند كل تنفيذ — أوامر سلاش، بريفكس، بدون بريفكس، أزرار، قوائم، مودالات.
 * إخفاء زر أو أمر ليس حماية؛ الحماية هي هذا الفحص.
 */
class PermissionService {
  constructor({ config, guildConfig, staffRepo }) {
    this.config = config;
    this.guildConfig = guildConfig;
    this.staffRepo = staffRepo;
  }

  /** يحسب مستوى العضو الفعلي. */
  resolveLevel(member) {
    if (!member) return Level.EVERYONE;
    if (this.config.isDeveloper(member.id)) return Level.DEVELOPER;
    if (member.guild && member.id === member.guild.ownerId) return Level.GUILD_OWNER;
    if (member.permissions.has(PermissionsBitField.Flags.Administrator)) return Level.ADMIN;

    const roleIds = [...member.roles.cache.keys()];

    // رتبة الطاقم الأساسية تمنح المستوى الأدنى للطاقم
    const baseRoleId = this.guildConfig.value(member.guild.id, "staff.baseRoleId");
    let level = Level.EVERYONE;
    if (baseRoleId && roleIds.includes(baseRoleId)) level = Level.STAFF;

    // رتب السلم الإداري قد ترفع المستوى أكثر
    const rank = this.staffRepo.highestForMember(member.guild.id, roleIds);
    if (rank && rank.level > level) level = Math.min(rank.level, Level.ADMIN);

    // صلاحيات ديسكورد الإشرافية ترفع إلى مشرف كحد أدنى
    if (
      level < Level.MODERATOR &&
      member.permissions.any([
        PermissionsBitField.Flags.BanMembers,
        PermissionsBitField.Flags.KickMembers,
        PermissionsBitField.Flags.ModerateMembers,
        PermissionsBitField.Flags.ManageMessages
      ])
    ) {
      level = Level.MODERATOR;
    }

    return level;
  }

  isDeveloper(userId) {
    return this.config.isDeveloper(userId);
  }

  /**
   * الفحص الشامل قبل أي إجراء.
   * يُرجع { ok: true } أو { ok: false, reason, meta } لعرض رسالة مناسبة.
   */
  check(member, requirement = {}) {
    if (!member || !member.guild) return { ok: false, reason: "guildOnly" };

    const level = this.resolveLevel(member);

    if (requirement.developerOnly && level < Level.DEVELOPER) {
      return { ok: false, reason: "developerOnly" };
    }
    if (requirement.level !== undefined && level < requirement.level) {
      return { ok: false, reason: "noPermission" };
    }
    // المطور ومالك السيرفر لا يُقيَّدان بصلاحيات ديسكورد الاختيارية،
    // لكن ديسكورد نفسه سيمنع أي إجراء لا يملكه البوت فعليًا.
    if (requirement.discordPermissions && level < Level.GUILD_OWNER) {
      const missing = requirement.discordPermissions.filter((p) => !member.permissions.has(p));
      if (missing.length) return { ok: false, reason: "noPermission", meta: { missing } };
    }
    return { ok: true, level };
  }

  /** يتحقق أن البوت نفسه يملك الصلاحيات المطلوبة. */
  botHas(guild, permissions) {
    const me = guild.members.me;
    if (!me) return { ok: false, missing: permissions };
    const missing = permissions.filter((p) => !me.permissions.has(p));
    return { ok: missing.length === 0, missing };
  }

  /**
   * فحص التسلسل الهرمي قبل أي إجراء على عضو.
   * يمنع: استهداف النفس، استهداف البوت، تجاوز الرتب، والرتب المحمية.
   */
  canActOn(executor, target, { allowSelf = false, allowBot = false } = {}) {
    if (!target) return { ok: false, reason: "memberNotFound" };
    if (!allowSelf && executor.id === target.id) return { ok: false, reason: "selfTarget" };
    if (!allowBot && target.id === executor.client.user.id) return { ok: false, reason: "botTarget" };

    const guild = executor.guild;
    const executorLevel = this.resolveLevel(executor);

    // مالك السيرفر لا يُمس إطلاقًا
    if (target.id === guild.ownerId) return { ok: false, reason: "hierarchy" };

    // الرتب المحمية في إعدادات السيرفر
    const protectedRoles = this.guildConfig.value(guild.id, "moderation.protectedRoleIds") || [];
    if (protectedRoles.some((r) => target.roles.cache.has(r)) && executorLevel < Level.GUILD_OWNER) {
      return { ok: false, reason: "protectedTarget" };
    }

    // المطور ومالك السيرفر يتجاوزان فحص الرتب بين الأعضاء،
    // لكن فحص رتبة البوت أدناه يبقى إلزاميًا لأن ديسكورد يفرضه.
    if (executorLevel < Level.GUILD_OWNER) {
      if (target.roles.highest.position >= executor.roles.highest.position) {
        return { ok: false, reason: "hierarchy" };
      }
      const targetLevel = this.resolveLevel(target);
      if (targetLevel >= executorLevel) return { ok: false, reason: "hierarchy" };
    }

    const me = guild.members.me;
    if (me && target.roles.highest.position >= me.roles.highest.position) {
      return { ok: false, reason: "botHierarchy" };
    }

    return { ok: true };
  }
}

module.exports = { PermissionService, Level };
