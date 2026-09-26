const { truncate } = require("../../core/utils/common");

const SCOPES = ["cases", "members", "tickets", "reports", "appeals", "commands"];
const PER_SCOPE = 8;

const likeOf = (q) => `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * البحث الشامل: يستدعي مستودعات الأنظمة الموجودة (لا فهرس مكرر)،
 * وكل مصدر يُتخطى بهدوء إن كان نظامه معطّلًا أو غير مثبت.
 */
class SearchService {
  constructor(app) {
    this.app = app;
  }

  static get SCOPES() {
    return SCOPES;
  }

  _tableExists(name) {
    return !!this.app.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  }

  search(guild, { query = "", userId = null, scope = "all" } = {}) {
    const q = String(query || "").trim().slice(0, 100);
    const number = /^#?\d{1,9}$/.test(q) ? parseInt(q.replace("#", ""), 10) : null;
    const want = (s) => scope === "all" || scope === s;
    const out = {};
    const gid = guild.id;

    if (want("cases")) {
      const rows = number
        ? [this.app.cases.getByNumber(gid, number)].filter(Boolean)
        : this.app.caseworkRepo
          ? this.app.caseworkRepo.searchCases(gid, { userId, text: q || null, limit: PER_SCOPE })
          : userId ? this.app.cases.listByTarget(gid, userId, { limit: PER_SCOPE }) : [];
      out.cases = rows.map((c) => `\`#${c.case_number}\` ${c.active ? "🟢" : "⚪"} \`${c.type}\` <@${c.target_id}> — ${truncate(c.reason || "—", 60)}`);
    }

    if (want("members")) {
      const lines = new Map();
      if (userId) {
        const m = guild.members.cache.get(userId);
        lines.set(userId, `<@${userId}> \`${userId}\`${m ? ` — ${m.displayName}` : ""}`);
      }
      if (q.length >= 2) {
        const lower = q.toLowerCase();
        for (const m of guild.members.cache.values()) {
          if (lines.size >= PER_SCOPE) break;
          if ([m.user.username, m.displayName, m.nickname].some((n) => n && n.toLowerCase().includes(lower))) lines.set(m.id, `<@${m.id}> \`${m.id}\` — ${m.displayName}`);
        }
        if (this.app.historyRepo) {
          for (const r of this.app.historyRepo.searchByName(gid, q, PER_SCOPE)) {
            if (!lines.has(r.user_id)) lines.set(r.user_id, `<@${r.user_id}> \`${r.user_id}\` — ${truncate(String(r.names || ""), 60)}`);
          }
        }
      }
      out.members = [...lines.values()].slice(0, PER_SCOPE);
    }

    if (want("tickets")) {
      const where = ["guild_id = ?"];
      const params = [gid];
      if (number) { where.push("number = ?"); params.push(number); }
      else if (userId) { where.push("(owner_id = ? OR claimed_by = ?)"); params.push(userId, userId); }
      else if (q) { where.push("tags LIKE ? ESCAPE '\\'"); params.push(likeOf(q.toLowerCase())); }
      const hasTags = this._hasColumn("tickets", "tags");
      if (!number && !userId && q && !hasTags) out.tickets = [];
      else if (number || userId || q) {
        params.push(PER_SCOPE);
        out.tickets = this.app.db.prepare(`SELECT * FROM tickets WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...params)
          .map((tk) => `\`#${String(tk.number || tk.id).padStart(4, "0")}\` ${tk.status === "open" ? "🟢" : "🔴"} <@${tk.owner_id}> <#${tk.channel_id}>${tk.priority ? ` \`${tk.priority}\`` : ""}`);
      } else out.tickets = [];
    }

    if (want("reports") && this.app.caseworkRepo) {
      const rows = number ? [this.app.caseworkRepo.report(gid, number)].filter(Boolean) : this.app.caseworkRepo.searchReports(gid, { userId, text: q || null, limit: PER_SCOPE });
      out.reports = rows.map((r) => `\`#${r.number}\` \`${r.status}\` <@${r.reporter_id}> → <@${r.target_id}> — ${truncate(r.reason, 50)}`);
    }

    if (want("appeals") && this.app.appealsRepo) {
      const rows = userId ? this.app.appealsRepo.search(gid, { userId, limit: PER_SCOPE }) : number ? this.app.appealsRepo.forCase(gid, number) : this.app.appealsRepo.search(gid, { limit: q ? 0 : PER_SCOPE });
      out.appeals = rows.slice(0, PER_SCOPE).map((a) => `\`#${a.id}\` \`${a.status}\` <@${a.user_id}> — #${a.case_number} \`${a.type}\``);
    }

    if (want("commands") && q) {
      const lower = q.toLowerCase();
      out.commands = this.app.customCommands.list(gid)
        .filter((c) => c.name.toLowerCase().includes(lower) || (c.content || "").toLowerCase().includes(lower))
        .slice(0, PER_SCOPE)
        .map((c) => `\`${c.prefix || this.app.guildConfig.value(gid, "prefix")}${c.name}\` — ${truncate(c.content || "(embed)", 60)}`);
    }

    return out;
  }

  _hasColumn(table, column) {
    this._cols ||= new Map();
    if (!this._cols.has(table)) this._cols.set(table, new Set(this.app.db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)));
    return this._cols.get(table).has(column);
  }

  payload(guild, opts) {
    const t = this.app.i18n.forGuild(guild.id);
    const results = this.search(guild, opts);
    const fields = Object.entries(results)
      .filter(([, lines]) => lines.length)
      .map(([scope, lines]) => ({ name: `${t(`srch.scope.${scope}`)} (${lines.length})`, value: lines.join("\n").slice(0, 1024) }));
    return {
      embeds: [this.app.theme.embed(guild.id, {
        title: `🔎 ${t("srch.title")}`,
        description: [opts.query ? `\`${truncate(opts.query, 100)}\`` : null, opts.userId ? `<@${opts.userId}>` : null].filter(Boolean).join(" • ") + (fields.length ? "" : `\n\n${t("srch.none")}`),
        color: "info",
        fields
      })],
      allowedMentions: { parse: [] }
    };
  }
}

module.exports = SearchService;
