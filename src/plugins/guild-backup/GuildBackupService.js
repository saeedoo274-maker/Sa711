const { ChannelType, PermissionsBitField } = require("discord.js");

const FORMAT = "guild-backup";
const VERSION = 1;
const PARTS = ["config", "roles", "channels"];
const CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum]);

/**
 * نسخ السيرفر الاحتياطي.
 *
 * مبدأ الاستعادة: غير هدّامة إطلاقًا. تُنشأ الرتب والقنوات الناقصة فقط (بالاسم)،
 * ولا يُحذف أو يُعدَّل أي شيء موجود. الإعدادات تُستبدل بالنسخة بعد إعادة ربط
 * معرّفات الرتب/القنوات التي أُعيد إنشاؤها. التنفيذ عبر الطابور مع تقدّم وإلغاء
 * وفاصل زمني بين الطلبات لاحترام حدود ديسكورد.
 */
class GuildBackupService {
  constructor(app) {
    this.app = app;
  }

  config(guildId) {
    return { keep: 10, schedule: null, maxBytes: 2_000_000, restoreDelayMs: 1500, ...(this.app.guildConfig.value(guildId, "guildBackup") || {}) };
  }

  /** يلتقط الحالة الحالية للسيرفر. */
  snapshot(guild) {
    const everyoneId = guild.roles.everyone?.id || guild.id;
    const roles = [...guild.roles.cache.values()]
      .filter((r) => r.id !== everyoneId && !r.managed)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.color || 0, hoist: !!r.hoist, mentionable: !!r.mentionable, permissions: String(r.permissions?.bitfield ?? 0n), position: r.position }));
    const roleName = (id) => (id === everyoneId ? "@everyone" : guild.roles.cache.get(id)?.name || null);
    const channels = [...guild.channels.cache.values()]
      .filter((c) => CHANNEL_TYPES.has(c.type))
      .sort((a, b) => (a.rawPosition ?? a.position ?? 0) - (b.rawPosition ?? b.position ?? 0))
      .map((c) => ({
        id: c.id, name: c.name, type: c.type, parent: c.parentId ? guild.channels.cache.get(c.parentId)?.name || null : null,
        topic: c.topic || null, nsfw: !!c.nsfw, rateLimitPerUser: c.rateLimitPerUser || 0, position: c.rawPosition ?? c.position ?? 0,
        overwrites: [...(c.permissionOverwrites?.cache?.values?.() || [])]
          .filter((o) => o.type === 0 && roleName(o.id))
          .map((o) => ({ role: roleName(o.id), allow: String(o.allow?.bitfield ?? 0n), deny: String(o.deny?.bitfield ?? 0n) }))
      }));
    return {
      format: FORMAT,
      version: VERSION,
      guild: { id: guild.id, name: guild.name },
      createdAt: new Date().toISOString(),
      config: this.app.guilds.getRawConfig(guild.id) || {},
      roles,
      channels
    };
  }

  create(guild, { name = null, kind = "manual", userId = null } = {}) {
    const data = this.snapshot(guild);
    return this._store(guild.id, data, { name: name || `backup-${new Date().toISOString().slice(0, 16).replace("T", "_")}`, kind, userId });
  }

  _store(guildId, data, { name, kind, userId }) {
    const json = JSON.stringify(data);
    const size = Buffer.byteLength(json);
    if (size > this.config(guildId).maxBytes) return { ok: false, reason: "tooBig" };
    const summary = JSON.stringify({ roles: data.roles.length, channels: data.channels.length, configKeys: Object.keys(data.config || {}).length });
    const info = this.app.db
      .prepare("INSERT INTO guild_backups (guild_id, name, kind, data, size_bytes, summary, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(guildId, String(name).slice(0, 64), kind, json, size, summary, userId, Date.now());
    this.rotate(guildId);
    return { ok: true, id: Number(info.lastInsertRowid), size };
  }

  /** يحتفظ بآخر N نسخة لكل سيرفر. */
  rotate(guildId) {
    const keep = Math.max(1, this.config(guildId).keep);
    return this.app.db
      .prepare("DELETE FROM guild_backups WHERE guild_id = ? AND id NOT IN (SELECT id FROM guild_backups WHERE guild_id = ? ORDER BY id DESC LIMIT ?)")
      .run(guildId, guildId, keep).changes;
  }

  list(guildId) {
    return this.app.db.prepare("SELECT id, name, kind, size_bytes, summary, created_by, created_at FROM guild_backups WHERE guild_id = ? ORDER BY id DESC LIMIT 25").all(guildId);
  }

  get(guildId, id) {
    const row = this.app.db.prepare("SELECT * FROM guild_backups WHERE guild_id = ? AND id = ?").get(guildId, id);
    if (!row) return null;
    try {
      return { ...row, data: JSON.parse(row.data) };
    } catch {
      return null;
    }
  }

  delete(guildId, id) {
    return this.app.db.prepare("DELETE FROM guild_backups WHERE guild_id = ? AND id = ?").run(guildId, id).changes === 1;
  }

  /** التحقق من ملف مستورد قبل حفظه. */
  static validate(data) {
    if (!data || data.format !== FORMAT || data.version !== VERSION) return "badFormat";
    if (!Array.isArray(data.roles) || !Array.isArray(data.channels) || typeof data.config !== "object" || Array.isArray(data.config)) return "badFormat";
    if (data.roles.length > 250 || data.channels.length > 500) return "tooLarge";
    const okName = (n) => typeof n === "string" && n.length >= 1 && n.length <= 100;
    if (!data.roles.every((r) => okName(r.name) && /^\d+$/.test(String(r.permissions ?? "0")))) return "badFormat";
    if (!data.channels.every((c) => okName(c.name) && Number.isInteger(c.type))) return "badFormat";
    return null;
  }

  import(guild, data, userId) {
    const problem = GuildBackupService.validate(data);
    if (problem) return { ok: false, reason: problem };
    return this._store(guild.id, data, { name: `import-${data.guild?.name || "file"}`.slice(0, 64), kind: "imported", userId });
  }

  /** مقارنة نسخة بالحالة الحالية (بالاسم). */
  compare(guild, backup) {
    const now = this.snapshot(guild);
    const byName = (list) => new Map(list.map((x) => [`${x.type ?? "role"}:${x.name}`, x]));
    const diff = (a, b, fields) => {
      const A = byName(a);
      const B = byName(b);
      const missing = [...A.keys()].filter((k) => !B.has(k)).map((k) => A.get(k).name);
      const extra = [...B.keys()].filter((k) => !A.has(k)).map((k) => B.get(k).name);
      const changed = [...A.keys()].filter((k) => B.has(k) && fields.some((f) => JSON.stringify(A.get(k)[f]) !== JSON.stringify(B.get(k)[f]))).map((k) => A.get(k).name);
      return { missing, extra, changed };
    };
    const flat = (obj, prefix = "") => Object.entries(obj || {}).flatMap(([k, v]) => (v && typeof v === "object" && !Array.isArray(v) ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, JSON.stringify(v)]]));
    const oldCfg = new Map(flat(backup.config));
    const newCfg = new Map(flat(now.config));
    const configChanged = [...new Set([...oldCfg.keys(), ...newCfg.keys()])].filter((k) => oldCfg.get(k) !== newCfg.get(k));
    return {
      roles: diff(backup.roles, now.roles, ["color", "hoist", "mentionable", "permissions"]),
      channels: diff(backup.channels, now.channels, ["topic", "nsfw", "rateLimitPerUser", "parent", "overwrites"]),
      config: configChanged
    };
  }

  /** يبدأ الاستعادة كمهمة طابور. parts ⊆ PARTS */
  startRestore(guild, backupId, parts, userId) {
    const selected = parts.filter((p) => PARTS.includes(p));
    if (!selected.length) return { ok: false, reason: "noParts" };
    if (!this.get(guild.id, backupId)) return { ok: false, reason: "notFound" };
    const job = this.app.queue.add("backup:restore", { guildId: guild.id, backupId, parts: selected, userId }, { guildId: guild.id, createdBy: userId, maxAttempts: 1 });
    return { ok: true, jobId: job.id };
  }

  async restoreWorker(job, tools) {
    const { guildId, backupId, parts, userId } = job.payload;
    const guild = this.app.client.guilds?.cache?.get(guildId);
    const backup = guild ? this.get(guildId, backupId) : null;
    if (!backup) return { error: "notFound" };
    const data = backup.data;
    const delay = this.config(guildId).restoreDelayMs;
    const idMap = {};
    const report = { rolesCreated: 0, channelsCreated: 0, configRestored: false, skipped: 0, errors: [] };
    const me = guild.members.me;
    const botTop = me?.roles?.highest?.position ?? 0;
    const botPerms = me?.permissions?.bitfield ?? 0n;
    const total = (parts.includes("roles") ? data.roles.length : 0) + (parts.includes("channels") ? data.channels.length : 0) + (parts.includes("config") ? 1 : 0);
    let done = 0;
    const step = async () => {
      tools.progress(++done, total);
      if (delay) await tools.sleep(delay);
    };

    const roleByName = (name) => [...guild.roles.cache.values()].find((r) => r.name === name);
    if (parts.includes("roles")) {
      for (const r of data.roles) {
        if (tools.isCancelled()) return { ...report, cancelled: true };
        const existing = roleByName(r.name);
        if (existing) {
          idMap[r.id] = existing.id;
          report.skipped++;
        } else if (r.position >= botTop) {
          report.skipped++;
        } else {
          // لا تُمنح رتبة صلاحيات لا يملكها البوت نفسه (منع تصعيد الصلاحيات عبر الاستعادة)
          const perms = BigInt(r.permissions) & BigInt(botPerms);
          const created = await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: new PermissionsBitField(perms), reason: `استعادة نسخة #${backupId}` }).catch((e) => {
            report.errors.push(`role ${r.name}: ${e.message}`);
            return null;
          });
          if (created) {
            idMap[r.id] = created.id;
            report.rolesCreated++;
          }
        }
        await step();
      }
    }

    if (parts.includes("channels")) {
      const everyoneId = guild.roles.everyone?.id || guild.id;
      const chanByName = (name, type) => [...guild.channels.cache.values()].find((c) => c.name === name && c.type === type);
      const ordered = [...data.channels].sort((a, b) => (a.type === ChannelType.GuildCategory ? -1 : 0) - (b.type === ChannelType.GuildCategory ? -1 : 0));
      for (const c of ordered) {
        if (tools.isCancelled()) return { ...report, cancelled: true };
        const existing = chanByName(c.name, c.type);
        if (existing) {
          idMap[c.id] = existing.id;
          report.skipped++;
        } else {
          const parent = c.parent ? chanByName(c.parent, ChannelType.GuildCategory) : null;
          const permissionOverwrites = c.overwrites
            .map((o) => ({ id: o.role === "@everyone" ? everyoneId : roleByName(o.role)?.id, allow: BigInt(o.allow), deny: BigInt(o.deny) }))
            .filter((o) => o.id);
          const created = await guild.channels.create({
            name: c.name, type: c.type, parent: parent?.id, topic: c.topic || undefined, nsfw: c.nsfw,
            rateLimitPerUser: c.rateLimitPerUser || undefined, permissionOverwrites, reason: `استعادة نسخة #${backupId}`
          }).catch((e) => {
            report.errors.push(`channel ${c.name}: ${e.message}`);
            return null;
          });
          if (created) {
            idMap[c.id] = created.id;
            report.channelsCreated++;
          }
        }
        await step();
      }
    }

    if (parts.includes("config")) {
      // إعادة ربط المعرّفات القديمة بالجديدة داخل الإعدادات
      let json = JSON.stringify(data.config || {});
      for (const [oldId, newId] of Object.entries(idMap)) if (oldId !== newId) json = json.split(oldId).join(newId);
      this.app.guilds.saveConfig(guildId, JSON.parse(json));
      this.app.guildConfig.invalidate(guildId);
      report.configRestored = true;
      await step();
    }

    report.errors = report.errors.slice(0, 20);
    this.app.bus.emitSafe("backup:restored", { guildId, guild, backupId, parts, userId, report });
    return report;
  }

  /** مهمة المجدول للنسخ الدوري لكل سيرفر فعّله. */
  scheduledRun(guildId) {
    const guild = this.app.client.guilds?.cache?.get(guildId);
    if (!guild || !this.config(guildId).schedule || !this.app.features.isEnabled(guildId, "backups")) return;
    this.create(guild, { kind: "scheduled", name: `auto-${new Date().toISOString().slice(0, 10)}` });
  }

  setSchedule(guildId, frequency) {
    const key = `guild-backup:${guildId}`;
    this.app.guildConfig.set(guildId, "guildBackup.schedule", frequency || null);
    this.app.scheduler.cancelByKey(key);
    if (!frequency) return null;
    const repeat = frequency === "daily" ? { kind: "daily", time: "04:00" } : { kind: "weekly", time: "04:00", weekday: 0 };
    return this.app.scheduler.ensureRecurring("guild-backup:run", key, repeat, { guildId });
  }
}

GuildBackupService.PARTS = PARTS;

module.exports = GuildBackupService;
