const { Events } = require("../../core/events/EventBus");
const { Level } = require("../../core/permissions/PermissionService");

/**
 * السلم الإداري: ترقية وتنزيل مبنيان على ترتيب الرتب المخزّن في قاعدة البيانات.
 * كل عملية تمر بسلسلة فحوصات كاملة قبل لمس أي رتبة على ديسكورد.
 */
class StaffService {
  constructor(app) {
    this.app = app;
  }

  ranks(guildId) {
    return this.app.staff.list(guildId);
  }

  currentRank(member) {
    return this.app.staff.highestForMember(member.guild.id, [...member.roles.cache.keys()]);
  }

  /**
   * @param {"up"|"down"} direction
   * @returns {{ok:boolean, reason?:string, from?:object, to?:object}}
   */
  async move(executor, target, direction) {
    const guild = target.guild;

    // 1) صلاحية المنفّذ
    const executorLevel = this.app.permissions.resolveLevel(executor);
    if (executorLevel < Level.ADMIN) return { ok: false, reason: "noPermission" };

    // 2) الهرمية بين المنفّذ والهدف
    const allowed = this.app.permissions.canActOn(executor, target);
    if (!allowed.ok) return { ok: false, reason: allowed.reason };

    const ranks = this.ranks(guild.id);
    if (!ranks.length) return { ok: false, reason: "noRanks" };

    const current = this.currentRank(target);
    let next;
    if (direction === "up") {
      next = current ? this.app.staff.neighbour(guild.id, current.position, "up") : ranks[0];
      if (!next) return { ok: false, reason: "atTop" };
    } else {
      if (!current) return { ok: false, reason: "notStaff" };
      next = this.app.staff.neighbour(guild.id, current.position, "down");
    }

    // 3) الرتب موجودة فعلًا على ديسكورد
    const nextRole = next ? guild.roles.cache.get(next.role_id) : null;
    if (next && !nextRole) return { ok: false, reason: "roleNotFound" };
    const currentRole = current ? guild.roles.cache.get(current.role_id) : null;

    // 4) البوت قادر على إدارة هذه الرتب
    const me = guild.members.me;
    for (const role of [nextRole, currentRole].filter(Boolean)) {
      if (role.position >= me.roles.highest.position) return { ok: false, reason: "botHierarchy" };
    }

    // 5) المنفّذ لا يستطيع منح رتبة أعلى من رتبته (منع تصعيد الصلاحيات)
    if (executorLevel < Level.GUILD_OWNER && nextRole && nextRole.position >= executor.roles.highest.position) {
      return { ok: false, reason: "hierarchy" };
    }

    const label = direction === "up" ? "ترقية" : "تنزيل";
    try {
      if (currentRole) await target.roles.remove(currentRole, `${executor.user.tag}: ${label}`);
      if (nextRole) await target.roles.add(nextRole, `${executor.user.tag}: ${label}`);
    } catch (err) {
      return { ok: false, reason: "actionFailed", details: err.message };
    }

    this.app.bus.emitSafe(direction === "up" ? Events.STAFF_PROMOTED : Events.STAFF_DEMOTED, {
      guild,
      executor,
      target,
      details: `${current?.name || "بدون رتبة"} ← ${next?.name || "خارج الطاقم"}`
    });

    return { ok: true, from: current, to: next };
  }

  /**
   * سحب العضو من الطاقم كليًا: تُزال كل رتب السلم الإداري دفعة واحدة.
   * يختلف عن التنزيل الذي ينقله رتبة واحدة للأسفل فقط.
   *
   * يمر بنفس سلسلة الفحوصات: صلاحية المنفّذ، الهرمية، وقدرة البوت.
   */
  async dismiss(executor, target, reason = null) {
    const guild = target.guild;

    const executorLevel = this.app.permissions.resolveLevel(executor);
    if (executorLevel < Level.ADMIN) return { ok: false, reason: "noPermission" };

    const allowed = this.app.permissions.canActOn(executor, target);
    if (!allowed.ok) return { ok: false, reason: allowed.reason };

    const current = this.currentRank(target);
    if (!current) return { ok: false, reason: "notStaff" };

    const ranks = this.ranks(guild.id);
    const me = guild.members.me;

    // كل رتب السلم التي يحملها العضو فعلًا
    const held = ranks
      .filter((r) => target.roles.cache.has(r.role_id))
      .map((r) => guild.roles.cache.get(r.role_id))
      .filter(Boolean);

    if (!held.length) return { ok: false, reason: "notStaff" };

    // البوت قادر على إزالتها كلها قبل لمس أي شيء — نمنع الإزالة الجزئية
    for (const role of held) {
      if (role.managed || role.position >= me.roles.highest.position) {
        return { ok: false, reason: "botHierarchy" };
      }
    }

    // المنفّذ لا يسحب من هو أعلى منه
    if (executorLevel < Level.GUILD_OWNER) {
      const top = held.reduce((a, b) => (a.position > b.position ? a : b));
      if (top.position >= executor.roles.highest.position) {
        return { ok: false, reason: "hierarchy" };
      }
    }

    // رتبة الطاقم الأساسية تُسحب معها إن وُجدت
    const baseRoleId = this.app.guildConfig.value(guild.id, "staff.baseRoleId");
    const baseRole = baseRoleId ? guild.roles.cache.get(baseRoleId) : null;
    const removable = [...held];
    if (baseRole && target.roles.cache.has(baseRole.id) &&
        !baseRole.managed && baseRole.position < me.roles.highest.position) {
      removable.push(baseRole);
    }

    const label = reason ? `سحب من الطاقم: ${reason}` : "سحب من الطاقم";
    try {
      for (const role of removable) {
        await target.roles.remove(role, `${executor.user.tag}: ${label}`);
      }
    } catch (err) {
      return { ok: false, reason: "actionFailed", details: err.message };
    }

    this.app.bus.emitSafe(Events.STAFF_DEMOTED, {
      guild,
      executor,
      target,
      details: `${current.name} ← سُحب من الطاقم${reason ? ` (${reason})` : ""}`
    });

    return { ok: true, from: current, removed: removable.length, reason };
  }
}

module.exports = StaffService;
