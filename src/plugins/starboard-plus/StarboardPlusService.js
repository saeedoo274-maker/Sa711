const { PermissionFlagsBits } = require("discord.js");

const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;

/**
 * لوحات النجوم الإضافية.
 *
 * بخلاف اللوحة الأصلية (التي تعتمد على reaction.count)، هنا كل صوت يُحفظ كصف:
 * العدّ دقيق (بلا بوتات، بلا تنجيم النفس، بلا الرتب المتجاهلة)، ولا حاجة لجلب
 * قائمة المتفاعلين من ديسكورد إلا مرة واحدة عند أول ظهور للرسالة (لاستدراك ما فات).
 */
class StarboardPlusService {
  constructor(app, repo) {
    this.app = app;
    this.repo = repo;
    this.cache = new Map(); // guildId -> boards
    this.locks = new Map(); // boardId:messageId -> Promise — يمنع النشر المزدوج عند تفاعلات متزامنة
  }

  boards(guildId) {
    if (!this.cache.has(guildId)) this.cache.set(guildId, this.repo.boards(guildId));
    return this.cache.get(guildId);
  }

  invalidate(guildId) {
    this.cache.delete(guildId);
  }

  static emojiMatches(reaction, emoji) {
    return reaction.emoji.id === emoji || reaction.emoji.name === emoji || (reaction.emoji.id && emoji.includes(reaction.emoji.id));
  }

  static channelIgnored(list, channel) {
    return list.includes(channel.id) || (channel.parentId && list.includes(channel.parentId));
  }

  /** هل يُحتسب صوت هذا العضو؟ (للوحة الإضافية أو الأصلية) */
  voterAllowed(guild, userId, authorId, { selfStar, ignoredRoles }) {
    if (!selfStar && userId === authorId) return false;
    if (ignoredRoles?.length) {
      const member = guild.members.cache.get(userId);
      if (member && ignoredRoles.some((r) => member.roles.cache.has(r))) return false;
    }
    return true;
  }

  async _withLock(key, fn) {
    const prev = this.locks.get(key) || Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(key) === next) this.locks.delete(key);
    }
  }

  async onReaction(reaction, user, added) {
    if (user.bot) return;
    if (reaction.partial && !(await reaction.fetch().catch(() => null))) return;
    if (reaction.message?.partial && !(await reaction.message.fetch().catch(() => null))) return;
    const message = reaction.message;
    const guild = message?.guild;
    if (!guild) return;
    const boards = this.boards(guild.id).filter((b) => b.enabled && StarboardPlusService.emojiMatches(reaction, b.emoji));
    if (!boards.length) return;
    const allBoardChannels = new Set(this.boards(guild.id).map((b) => b.channel_id));
    const legacy = this.app.guildConfig.value(guild.id, "starboard.channelId");
    if (legacy) allBoardChannels.add(legacy);
    if (allBoardChannels.has(message.channel.id)) return;

    for (const board of boards) {
      if (StarboardPlusService.channelIgnored(board.ignored_channels, message.channel)) continue;
      if (message.author?.bot && !board.allow_bots) continue;
      await this._withLock(`${board.id}:${message.id}`, () => this._apply(guild, board, reaction, user, added));
    }
  }

  async _apply(guild, board, reaction, user, added) {
    const message = reaction.message;
    const rules = { selfStar: !!board.self_star, ignoredRoles: board.ignored_roles };
    if (!this.repo.hasAnyVote(board.id, message.id) && (reaction.count || 0) > 1) {
      // أول مرة نرى هذه الرسالة: نستدرك من تفاعل قبل تشغيل البوت
      const users = await reaction.users.fetch().catch(() => null);
      for (const u of users?.values?.() || []) {
        if (!u.bot && this.voterAllowed(guild, u.id, message.author?.id, rules)) this.repo.addVote(board.id, message.id, u.id);
      }
    }
    if (added) {
      if (this.voterAllowed(guild, user.id, message.author?.id, rules)) this.repo.addVote(board.id, message.id, user.id);
    } else {
      this.repo.removeVote(board.id, message.id, user.id);
    }
    const stars = this.repo.votes(board.id, message.id);
    const entry = this.repo.entry(board.id, message.id);
    const channel = await this.app.client.channels.fetch(board.channel_id).catch(() => null);

    if (stars < board.threshold) {
      if (entry?.board_message_id && channel?.messages) {
        const posted = await channel.messages.fetch(entry.board_message_id).catch(() => null);
        if (posted) await posted.delete().catch(() => {});
      }
      if (entry) this.repo.removeEntry(board.id, message.id);
      return { stars, posted: false };
    }
    if (!channel?.send) return { stars, posted: false };
    if (channel.permissionsFor && !channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return { stars, posted: false };

    const payload = this.app.starboardService.buildPayload(message, stars, board.emoji);
    const base = { boardId: board.id, guildId: guild.id, messageId: message.id, channelId: message.channel.id, authorId: message.author?.id, stars };
    if (entry?.board_message_id) {
      const posted = await channel.messages.fetch(entry.board_message_id).catch(() => null);
      if (posted) {
        await posted.edit(payload).catch(() => {});
        this.repo.upsertEntry({ ...base, boardMessageId: entry.board_message_id });
        return { stars, posted: true };
      }
    }
    const sent = await channel.send(payload).catch((err) => {
      this.app.logger.debug(`تعذر النشر في لوحة ${board.name}: ${err.message}`);
      return null;
    });
    this.repo.upsertEntry({ ...base, boardMessageId: sent?.id || null });
    if (sent) this.app.bus.emitSafe("starboard:posted", { guildId: guild.id, guild, board: board.name, authorId: message.author?.id, stars });
    return { stars, posted: !!sent };
  }

  // ---------------- الإدارة ----------------

  createBoard(guild, { name, channel, emoji, threshold, selfStar, allowBots }) {
    const key = String(name || "").trim().toLowerCase();
    if (!NAME_RE.test(key)) return { ok: false, reason: "badName" };
    if (this.repo.countBoards(guild.id) >= (this.app.guildConfig.value(guild.id, "starboard.maxBoards") || 10)) return { ok: false, reason: "maxBoards" };
    if (channel.permissionsFor && !channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return { ok: false, reason: "noSend" };
    const board = this.repo.createBoard({ guildId: guild.id, name: key, channelId: channel.id, emoji: (emoji || "⭐").trim(), threshold, selfStar, allowBots });
    if (!board) return { ok: false, reason: "exists" };
    this.invalidate(guild.id);
    return { ok: true, board };
  }

  editBoard(guildId, name, fields) {
    const board = this.repo.board(guildId, name);
    if (!board) return { ok: false, reason: "notFound" };
    this.repo.updateBoard(board.id, fields);
    this.invalidate(guildId);
    return { ok: true, board: this.repo.board(guildId, name) };
  }

  deleteBoard(guildId, name) {
    const ok = this.repo.deleteBoard(guildId, name);
    this.invalidate(guildId);
    return ok ? { ok: true } : { ok: false, reason: "notFound" };
  }

  /** تبديل قناة/رتبة في قائمة التجاهل للوحة إضافية أو للأصلية (name = null). */
  toggleIgnore(guildId, name, kind, id) {
    if (!name) {
      const key = kind === "role" ? "starboard.ignoredRoles" : "starboard.ignoredChannels";
      const set = new Set(this.app.guildConfig.value(guildId, key) || []);
      set.has(id) ? set.delete(id) : set.add(id);
      this.app.guildConfig.set(guildId, key, [...set]);
      return { ok: true, ignored: set.has(id) };
    }
    const board = this.repo.board(guildId, name);
    if (!board) return { ok: false, reason: "notFound" };
    const field = kind === "role" ? "ignored_roles" : "ignored_channels";
    const set = new Set(board[field]);
    set.has(id) ? set.delete(id) : set.add(id);
    this.repo.updateBoard(board.id, { [field]: [...set] });
    this.invalidate(guildId);
    return { ok: true, ignored: set.has(id) };
  }
}

module.exports = StarboardPlusService;
