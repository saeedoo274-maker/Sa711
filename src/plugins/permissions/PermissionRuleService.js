const { Level } = require("../../core/permissions/PermissionService");

const MAX_RULES = 300;

/**
 * منشئ الصلاحيات: طبقة قواعد فوق PermissionService (لا تستبدله).
 *
 * الترتيب من الأدق للأعم: <أمر>:<فرعي> ← <أمر> ← system:<نظام>.
 * داخل كل مستوى: قيود القنوات أولًا، ثم منع الرتب، ثم سماح الرتب.
 * أول مستوى فيه قرار يحسم النتيجة.
 *
 *  - منع قناة / قائمة قنوات مسموحة  → الأمر لا يعمل خارجها
 *  - منع رتبة  → حاملها لا يستخدم الأمر (إلا الأدمن فما فوق، منعًا للإقفال)
 *  - سماح رتبة → يتجاوز شرط المستوى الافتراضي فقط؛ أوامر المطور/المالك لا تُمنح أبدًا،
 *    وفحوص الهرمية داخل الخدمات (مثل canActOn) تبقى كما هي.
 */
class PermissionRuleService {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // guildId -> Map(target -> rules[])
  }

  invalidate(guildId) {
    this.cache.delete(guildId);
  }

  _rules(guildId) {
    if (!this.cache.has(guildId)) {
      const map = new Map();
      for (const r of this.app.db.prepare("SELECT * FROM permission_rules WHERE guild_id = ?").all(guildId)) {
        if (!map.has(r.target)) map.set(r.target, []);
        map.get(r.target).push(r);
      }
      this.cache.set(guildId, map);
    }
    return this.cache.get(guildId);
  }

  /** يطبّع اسم الهدف: system:x أو أمر أو أمر:فرعي (الأمر بالاسم الأساسي حتى لو كُتب باسم بديل). */
  normalizeTarget(raw) {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return null;
    if (text.startsWith("system:")) {
      const f = text.slice(7);
      return this.app.features.isKnown(f) ? `system:${f}` : null;
    }
    const [name, sub] = text.split(/[: ]/);
    const command = this.app.registry.get(name);
    if (!command) return null;
    return sub ? `${command.name}:${sub}` : command.name;
  }

  add(guildId, { target, subjectType, subjectId, effect, userId }) {
    if (!["role", "channel"].includes(subjectType) || !["allow", "deny"].includes(effect)) return { ok: false, reason: "invalid" };
    const key = this.normalizeTarget(target);
    if (!key) return { ok: false, reason: "unknownTarget" };
    const command = this.app.registry.get(key.split(":")[0]);
    if (effect === "allow" && subjectType === "role" && command && ((command.permissions?.level ?? 0) >= Level.GUILD_OWNER || command.permissions?.developerOnly)) {
      return { ok: false, reason: "protectedCommand" };
    }
    const count = this.app.db.prepare("SELECT COUNT(*) AS c FROM permission_rules WHERE guild_id = ?").get(guildId).c;
    if (count >= MAX_RULES) return { ok: false, reason: "maxRules" };
    this.app.db
      .prepare(
        `INSERT INTO permission_rules (guild_id, target, subject_type, subject_id, effect, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(guild_id, target, subject_type, subject_id) DO UPDATE SET effect = excluded.effect, created_by = excluded.created_by, created_at = excluded.created_at`
      )
      .run(guildId, key, subjectType, subjectId, effect, userId, Date.now());
    this.invalidate(guildId);
    return { ok: true, target: key };
  }

  remove(guildId, target, subjectType, subjectId) {
    const key = this.normalizeTarget(target) || target;
    const changes = this.app.db.prepare("DELETE FROM permission_rules WHERE guild_id = ? AND target = ? AND subject_type = ? AND subject_id = ?").run(guildId, key, subjectType, subjectId).changes;
    this.invalidate(guildId);
    return changes > 0 ? { ok: true } : { ok: false, reason: "notFound" };
  }

  clear(guildId, target = null) {
    const key = target ? this.normalizeTarget(target) || target : null;
    const changes = key
      ? this.app.db.prepare("DELETE FROM permission_rules WHERE guild_id = ? AND target = ?").run(guildId, key).changes
      : this.app.db.prepare("DELETE FROM permission_rules WHERE guild_id = ?").run(guildId).changes;
    this.invalidate(guildId);
    return changes;
  }

  list(guildId) {
    return [...this._rules(guildId).values()].flat();
  }

  /**
   * يقرر لأمر في سياق عضو وقناة.
   * @returns {{ decision: "allow"|"deny"|null, reason?: string, target?: string }}
   */
  evaluate({ guild, member, channel, command, subcommand = null, feature = null }) {
    if (!guild || !member || !command) return { decision: null };
    if (!this.app.features.isEnabled(guild.id, "permissions")) return { decision: null };
    const rules = this._rules(guild.id);
    if (!rules.size) return { decision: null };
    const level = this.app.permissions.resolveLevel(member);
    if (level >= Level.GUILD_OWNER) return { decision: null };

    const targets = [subcommand ? `${command.name}:${subcommand}` : null, command.name, feature ? `system:${feature}` : null].filter(Boolean);
    const channelIds = [channel?.id, channel?.parentId].filter(Boolean);
    for (const target of targets) {
      const list = rules.get(target);
      if (!list?.length) continue;
      const channelRules = list.filter((r) => r.subject_type === "channel");
      if (level < Level.ADMIN) {
        if (channelRules.some((r) => r.effect === "deny" && channelIds.includes(r.subject_id))) return { decision: "deny", reason: "channel", target };
        const allowedChannels = channelRules.filter((r) => r.effect === "allow");
        if (allowedChannels.length && !allowedChannels.some((r) => channelIds.includes(r.subject_id))) return { decision: "deny", reason: "channel", target };
      }
      const roleRules = list.filter((r) => r.subject_type === "role" && member.roles.cache.has(r.subject_id));
      if (level < Level.ADMIN && roleRules.some((r) => r.effect === "deny")) return { decision: "deny", reason: "role", target };
      if (roleRules.some((r) => r.effect === "allow")) return { decision: "allow", target };
      if (channelRules.length) return { decision: null, target };
    }
    return { decision: null };
  }
}

module.exports = PermissionRuleService;
