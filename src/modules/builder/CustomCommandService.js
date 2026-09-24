const crypto = require("node:crypto");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { truncate, formatDuration } = require("../../core/utils/common");
const { safeFetch, pickPath } = require("../../core/utils/safeFetch");

const MAX_ALL_RESPONSES = 5;
const API_CACHE_MS = 60_000;
const API_CACHE_MAX = 200;
const WEBHOOK_CACHE_MAX = 300;

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw ?? "");
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * تشغيل الأوامر المخصصة.
 *
 * تُقرأ من قاعدة البيانات مرة واحدة لكل سيرفر وتُخزَّن مؤقتًا،
 * فلا يوجد استعلام قاعدة بيانات على كل رسالة تُكتب في السيرفر.
 * الكاش يُبطَل فورًا عند أي تعديل من `/command`.
 *
 * التوسعة (كلها اختيارية ولا تغيّر سلوك الأوامر القديمة):
 *  - أسماء بديلة، وسائط {ARG1}..{ARG9} و{ARGS} مع حد أدنى ورسالة استخدام
 *  - ردود متعددة: واحد عشوائي أو كلها بالترتيب
 *  - شروط: رتب مطلوبة، قنوات مسموحة، تبريد لكل عضو
 *  - أزرار روابط وأزرار/قائمة اختيار ترد برد مخفي
 *  - مرفقات، رد في الخاص، رد عبر Webhook باسم وصورة مخصصين
 *  - ردود من API خارجي (JSON) عبر جلب آمن من SSRF: {API} أو {API:مسار.الحقل}
 */
class CustomCommandService {
  constructor(app) {
    this.app = app;
    this.cache = new Map(); // guildId -> { commands, aliases, expiresAt }
    this.ttlMs = 300000;
    this.cooldowns = new Map(); // `${commandId}:${userId}` -> expiresAt
    this.apiCache = new Map(); // url -> { at, json }
    this.webhooks = new Map(); // channelId -> webhook
  }

  invalidate(guildId) {
    if (guildId) this.cache.delete(guildId);
    else this.cache.clear();
  }

  _load(guildId) {
    const cached = this.cache.get(guildId);
    if (cached && cached.expiresAt > Date.now()) return cached;
    const commands = this.app.customCommands.list(guildId);
    const byId = new Map(commands.map((c) => [c.id, c]));
    const aliases = this.app.customCommands.aliases(guildId)
      .map((a) => ({ name: a.alias, command: byId.get(a.command_id) }))
      .filter((a) => a.command);
    const entry = { commands, aliases, expiresAt: Date.now() + this.ttlMs };
    this.cache.set(guildId, entry);
    return entry;
  }

  list(guildId) {
    return this._load(guildId).commands;
  }

  /**
   * يطابق نص الرسالة مع الأوامر المخصصة (وأسمائها البديلة).
   * كل أمر قد يملك بريفكس خاصًا به، وإلا يستخدم بريفكس السيرفر.
   */
  match(guildId, content, guildPrefix) {
    const { commands, aliases } = this._load(guildId);
    if (!commands.length) return null;

    const trimmed = content.trim();
    let best = null;
    const candidates = [...commands.map((c) => ({ name: c.name, command: c })), ...aliases];

    for (const { name, command } of candidates) {
      if (command.enabled === 0) continue;
      const prefix = command.prefix || guildPrefix;
      if (!trimmed.startsWith(prefix)) continue;

      const rest = trimmed.slice(prefix.length);
      if (!rest.startsWith(name)) continue;

      // لازم ينتهي اسم الأمر عند مسافة أو نهاية الرسالة، حتى لا يطابق "تفعيلات" أمرَ "تفعيل"
      const after = rest.slice(name.length);
      if (after && !/^\s/.test(after)) continue;

      // عند تعدد المطابقات نأخذ الأطول اسمًا (الأكثر تحديدًا)
      if (!best || name.length > best.matched.length) {
        best = { command, args: after.trim(), matched: name };
      }
    }

    return best;
  }

  static extras(command) {
    return {
      responses: parseJson(command.responses, []),
      mode: command.response_mode || "single",
      roles: parseJson(command.required_roles, []),
      channels: parseJson(command.allowed_channels, []),
      components: parseJson(command.components, {}),
      attachments: parseJson(command.attachments, [])
    };
  }

  /** فحص الشروط الإضافية. يُرجع null إن كان مسموحًا، أو سبب الرفض. */
  checkRules(command, member, channel) {
    const x = CustomCommandService.extras(command);
    if (x.channels.length && !x.channels.includes(channel.id) && !(channel.parentId && x.channels.includes(channel.parentId))) return { reason: "channel" };
    if (x.roles.length && this.app.permissions.resolveLevel(member) < Level.ADMIN && !x.roles.some((r) => member.roles.cache.has(r))) return { reason: "roles", roles: x.roles };
    return null;
  }

  _cooldownLeft(command, userId) {
    if (!command.cooldown_ms) return 0;
    const key = `${command.id}:${userId}`;
    const now = Date.now();
    const until = this.cooldowns.get(key) || 0;
    if (until > now) return until - now;
    if (this.cooldowns.size > 20_000) {
      for (const [k, v] of this.cooldowns) if (v <= now) this.cooldowns.delete(k);
    }
    this.cooldowns.set(key, now + command.cooldown_ms);
    return 0;
  }

  static fillArgs(text, args) {
    if (!text) return text;
    const list = args ? args.split(/\s+/).filter(Boolean) : [];
    return text
      .replace(/\{ARGS\}/gi, args || "")
      .replace(/\{ARG([1-9])\}/gi, (_, n) => list[Number(n) - 1] || "");
  }

  /** يجلب رد API (مع كاش قصير) ويستبدل {API} و{API:path}. */
  async fillApi(text, command, args) {
    if (!command.api_url || !text || !/\{API(?::[^}]+)?\}/i.test(text)) return text;
    const list = args ? args.split(/\s+/).filter(Boolean) : [];
    const url = command.api_url
      .replace(/\{ARGS\}/gi, encodeURIComponent(args || ""))
      .replace(/\{ARG([1-9])\}/gi, (_, n) => encodeURIComponent(list[Number(n) - 1] || ""));
    let json;
    const cached = this.apiCache.get(url);
    if (cached && Date.now() - cached.at < API_CACHE_MS) json = cached.json;
    else {
      const res = await safeFetch(url, { json: true, timeoutMs: 4000, maxBytes: 128 * 1024 });
      if (!res.ok) {
        this.app.logger.debug(`رد API للأمر ${command.name} فشل: ${res.reason}`);
        return text.replace(/\{API(?::[^}]+)?\}/gi, "—");
      }
      json = res.json;
      if (this.apiCache.size >= API_CACHE_MAX) this.apiCache.delete(this.apiCache.keys().next().value);
      this.apiCache.set(url, { at: Date.now(), json });
    }
    return text.replace(/\{API(?::([^}]+))?\}/gi, (_, path) => {
      const v = pickPath(json, path);
      if (v == null) return "—";
      return truncate(typeof v === "object" ? JSON.stringify(v) : String(v), 1000);
    });
  }

  async render(text, command, { member, guild, channel, args }) {
    if (!text) return text;
    const withArgs = CustomCommandService.fillArgs(text, args);
    const withApi = await this.fillApi(withArgs, command, args);
    return truncate(this.app.embedService.replaceVariables(withApi, { member, guild, channel }), 2000);
  }

  /** يختار نص الرد/الردود حسب الوضع. */
  pickTexts(command) {
    const { responses, mode } = CustomCommandService.extras(command);
    if (!responses.length) return [command.content];
    if (mode === "random") return [responses[crypto.randomInt(0, responses.length)]];
    if (mode === "all") return responses.slice(0, MAX_ALL_RESPONSES);
    return [command.content || responses[0]];
  }

  buildComponents(command) {
    const { components } = CustomCommandService.extras(command);
    const rows = [];
    const buttons = (components.buttons || []).slice(0, 5);
    if (buttons.length) {
      const row = new ActionRowBuilder();
      buttons.forEach((b, i) => {
        const btn = new ButtonBuilder().setLabel(truncate(b.label || "•", 80));
        if (b.emoji) btn.setEmoji(b.emoji);
        if (b.type === "link") btn.setStyle(ButtonStyle.Link).setURL(b.url);
        else btn.setStyle(ButtonStyle.Secondary).setCustomId(`cc:btn:${command.id}:${i}:${command.updated_at || 0}`);
        row.addComponents(btn);
      });
      rows.push(row);
    }
    const select = components.select;
    if (select?.options?.length) {
      rows.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`cc:sel:${command.id}:${command.updated_at || 0}`)
          .setPlaceholder(truncate(select.placeholder || "اختر...", 150))
          .addOptions(select.options.slice(0, 25).map((o, i) => ({ label: truncate(o.label, 100), value: String(i), description: o.description ? truncate(o.description, 100) : undefined, emoji: o.emoji || undefined })))
      ));
    }
    return rows;
  }

  async _webhookFor(channel) {
    const target = channel.isThread?.() ? channel.parent : channel;
    if (!target?.fetchWebhooks) return null;
    if (this.webhooks.has(target.id)) return this.webhooks.get(target.id);
    const hooks = await target.fetchWebhooks().catch(() => null);
    let hook = hooks?.find((h) => h.owner?.id === this.app.client.user?.id && h.token);
    if (!hook) hook = await target.createWebhook({ name: "Custom Commands" }).catch(() => null);
    if (hook) {
      if (this.webhooks.size >= WEBHOOK_CACHE_MAX) this.webhooks.delete(this.webhooks.keys().next().value);
      this.webhooks.set(target.id, hook);
    }
    return hook;
  }

  async _deliver(message, command, payload) {
    if (command.dm) {
      const sent = await message.author.send(payload).catch(() => null);
      if (!sent) await message.reply({ content: `${this.app.config.emoji("warning")} لم أستطع مراسلتك في الخاص.`, allowedMentions: { parse: [] } }).catch(() => {});
      return sent;
    }
    if (command.webhook_name) {
      const hook = await this._webhookFor(message.channel);
      if (hook) {
        const sent = await hook.send({
          ...payload,
          username: truncate(command.webhook_name, 80),
          avatarURL: command.webhook_avatar || undefined,
          threadId: message.channel.isThread?.() ? message.channel.id : undefined
        }).catch((err) => {
          this.app.logger.debug(`إرسال Webhook فشل: ${err.message}`);
          this.webhooks.delete(message.channel.isThread?.() ? message.channel.parentId : message.channel.id);
          return null;
        });
        if (sent) return sent;
      }
    }
    if (command.reply) return message.reply({ ...payload, allowedMentions: { ...(payload.allowedMentions || {}), repliedUser: false } }).catch(() => null);
    return message.channel.send(payload).catch(() => null);
  }

  async run(message, command, args = "") {
    const level = this.app.permissions.resolveLevel(message.member);
    if (level < (command.min_level || 0)) return false;
    if (command.enabled === 0) return false;

    const denied = this.checkRules(command, message.member, message.channel);
    if (denied) {
      if (denied.reason === "roles") {
        await message.reply({ content: `${this.app.config.emoji("error")} هذا الأمر يحتاج إحدى الرتب: ${denied.roles.map((r) => `<@&${r}>`).join(" ")}`, allowedMentions: { parse: [] } }).catch(() => {});
      }
      return true;
    }

    const minArgs = command.min_args || 0;
    if (minArgs && (args ? args.split(/\s+/).filter(Boolean).length : 0) < minArgs) {
      await message.reply({ content: `${this.app.config.emoji("warning")} الاستخدام: \`${command.prefix || this.app.guildConfig.value(message.guild.id, "prefix")}${command.name} ${command.usage || "<...>"}\``, allowedMentions: { parse: [] } }).catch(() => {});
      return true;
    }

    const wait = this._cooldownLeft(command, message.author.id);
    if (wait > 0) {
      await message.reply({ content: `${this.app.config.emoji("warning")} انتظر ${formatDuration(wait)} قبل استخدام هذا الأمر مجددًا.`, allowedMentions: { parse: [] } }).catch(() => {});
      return true;
    }

    const env = { member: message.member, guild: message.guild, channel: message.channel, args };
    const x = CustomCommandService.extras(command);
    const components = this.buildComponents(command);
    const files = x.attachments.slice(0, 5);
    let first = null;

    const texts = this.pickTexts(command);
    for (let i = 0; i < texts.length; i++) {
      let payload;
      if (command.embed_id && i === 0) {
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
        if (texts[i]) payload.content = await this.render(texts[i], command, env);
      } else {
        payload = {
          content: (await this.render(texts[i], command, env)) || "​",
          allowedMentions: command.allow_mentions ? { parse: ["users", "roles", "everyone"] } : { parse: ["users"] }
        };
      }
      // المكونات والمرفقات تُلحق بآخر رسالة فقط
      if (i === texts.length - 1) {
        if (components.length) payload.components = [...(payload.components || []), ...components].slice(0, 5);
        if (files.length) payload.files = files;
      }
      const sent = await this._deliver(message, command, payload);
      if (!sent) break;
      first ||= sent;
    }
    if (!first) return true;

    // تتبّع الرسالة حتى تُحدَّث تلقائيًا عند تعديل الإمبيد لاحقًا
    if (command.embed_id && !command.dm && first.channel?.id === message.channel.id) {
      this.app.embeds.trackMessage({
        embedId: command.embed_id,
        guildId: message.guild.id,
        channelId: message.channel.id,
        messageId: first.id
      });
    }

    this.app.customCommands.recordUse(command.id);
    this.app.bus.emitSafe("customCommand:used", { guildId: message.guild.id, guild: message.guild, userId: message.author.id, name: command.name });

    if (command.delete_trigger) {
      await message.delete().catch(() => {});
    }

    return true;
  }

  /** رد زر/قائمة: يعيد نص الخيار كرد مخفي للضاغط. */
  async componentResponse(interaction, commandId, index, version) {
    const command = this.app.customCommands.getById(commandId);
    if (!command || command.guild_id !== interaction.guild.id || String(command.updated_at || 0) !== String(version)) return { ok: false, reason: "expired" };
    const x = CustomCommandService.extras(command);
    const item = interaction.isStringSelectMenu?.() ? x.components.select?.options?.[index] : x.components.buttons?.[index];
    if (!item || item.type === "link" || !item.response) return { ok: false, reason: "expired" };
    const denied = this.checkRules(command, interaction.member, interaction.channel);
    if (denied?.reason === "roles") return { ok: false, reason: "roles", roles: denied.roles };
    const content = await this.render(item.response, command, { member: interaction.member, guild: interaction.guild, channel: interaction.channel, args: "" });
    return { ok: true, content };
  }

  // ---------------- الاستيراد والتصدير ----------------

  exportAll(guildId) {
    const commands = this.app.customCommands.list(guildId).map((c) => {
      const x = CustomCommandService.extras(c);
      return {
        name: c.name, prefix: c.prefix, content: c.content, embed: c.embed_id ? this.app.embeds.get(c.embed_id)?.name || null : null,
        minLevel: c.min_level, ephemeral: !!c.ephemeral, deleteTrigger: !!c.delete_trigger, allowMentions: !!c.allow_mentions,
        cooldownMs: c.cooldown_ms || 0, responses: x.responses, responseMode: x.mode, requiredRoles: x.roles, allowedChannels: x.channels,
        dm: !!c.dm, reply: !!c.reply, minArgs: c.min_args || 0, usage: c.usage, components: x.components, attachments: x.attachments,
        webhookName: c.webhook_name, webhookAvatar: c.webhook_avatar, apiUrl: c.api_url, enabled: c.enabled !== 0,
        aliases: this.app.customCommands.aliasesOf(c.id)
      };
    });
    return { format: "custom-commands", version: 1, exportedAt: new Date().toISOString(), commands };
  }

  /**
   * يستورد من ملف تصدير. يتحقق من كل حقل، ويتخطى الأسماء المحجوزة والمكررة
   * (إلا مع overwrite)، ويعيد تقريرًا بما تم.
   */
  importAll(guildId, data, { overwrite = false, userId = null, isReserved = () => false, validateUrl = () => true } = {}) {
    const report = { created: 0, updated: 0, skipped: [] };
    if (!data || data.format !== "custom-commands" || !Array.isArray(data.commands)) return { ok: false, reason: "badFormat" };
    const NAME = /^[\p{L}\p{N}_-]{1,32}$/u;
    const arr = (v, max, fn = (x) => typeof x === "string") => (Array.isArray(v) ? v.filter(fn).slice(0, max) : []);
    const ids = (v) => arr(v, 25, (x) => /^\d{17,20}$/.test(String(x)));
    const tx = this.app.db.transaction(() => {
      for (const raw of data.commands.slice(0, 200)) {
        const name = String(raw?.name || "").trim();
        if (!NAME.test(name) || isReserved(name)) { report.skipped.push(name || "?"); continue; }
        const existing = this.app.customCommands.getByName(guildId, name);
        if (existing && !overwrite) { report.skipped.push(name); continue; }
        if (!existing && this.app.customCommands.count(guildId) >= 200) { report.skipped.push(name); continue; }
        const embed = raw.embed ? this.app.embeds.getByName(guildId, String(raw.embed)) : null;
        const responses = arr(raw.responses, 20).map((r) => r.slice(0, 1900));
        const content = typeof raw.content === "string" ? raw.content.slice(0, 1900) : null;
        if (!embed && !content && !responses.length) { report.skipped.push(name); continue; }
        const components = CustomCommandService.sanitizeComponents(raw.components, validateUrl);
        const extras = {
          prefix: typeof raw.prefix === "string" && !/\s/.test(raw.prefix) ? raw.prefix.slice(0, 5) : null,
          content, embed_id: embed?.id || null,
          min_level: Math.min(3, Math.max(0, Number(raw.minLevel) || 0)),
          ephemeral: raw.ephemeral ? 1 : 0, delete_trigger: raw.deleteTrigger ? 1 : 0, allow_mentions: raw.allowMentions ? 1 : 0,
          cooldown_ms: Math.min(86_400_000, Math.max(0, Number(raw.cooldownMs) || 0)),
          responses, response_mode: ["single", "random", "all"].includes(raw.responseMode) ? raw.responseMode : "single",
          required_roles: ids(raw.requiredRoles), allowed_channels: ids(raw.allowedChannels),
          dm: raw.dm ? 1 : 0, reply: raw.reply ? 1 : 0, min_args: Math.min(9, Math.max(0, Number(raw.minArgs) || 0)),
          usage: typeof raw.usage === "string" ? raw.usage.slice(0, 100) : null,
          components, attachments: arr(raw.attachments, 5).filter((u) => validateUrl(u)),
          webhook_name: typeof raw.webhookName === "string" ? raw.webhookName.slice(0, 80) : null,
          webhook_avatar: typeof raw.webhookAvatar === "string" && validateUrl(raw.webhookAvatar) ? raw.webhookAvatar : null,
          api_url: typeof raw.apiUrl === "string" && validateUrl(raw.apiUrl.replace(/\{ARGS?\d?\}/gi, "x")) ? raw.apiUrl : null,
          enabled: raw.enabled === false ? 0 : 1
        };
        const record = existing || this.app.customCommands.create({ guildId, name, content: content || responses[0] || null, createdBy: userId });
        this.app.customCommands.updateExtras(record.id, extras);
        for (const alias of arr(raw.aliases, 10)) {
          if (NAME.test(alias) && !isReserved(alias) && !this.app.customCommands.getByName(guildId, alias)) this.app.customCommands.addAlias(guildId, record.id, alias);
        }
        existing ? report.updated++ : report.created++;
      }
    });
    tx();
    this.invalidate(guildId);
    return { ok: true, ...report };
  }

  static sanitizeComponents(raw, validateUrl) {
    const out = {};
    if (Array.isArray(raw?.buttons)) {
      out.buttons = raw.buttons.slice(0, 5).filter((b) => b && typeof b.label === "string").map((b) => (b.type === "link"
        ? { type: "link", label: b.label.slice(0, 80), url: String(b.url || ""), emoji: b.emoji ? String(b.emoji).slice(0, 64) : null }
        : { type: "reply", label: b.label.slice(0, 80), response: String(b.response || "").slice(0, 1900), emoji: b.emoji ? String(b.emoji).slice(0, 64) : null }))
        .filter((b) => b.type !== "link" || validateUrl(b.url));
    }
    if (Array.isArray(raw?.select?.options)) {
      out.select = {
        placeholder: String(raw.select.placeholder || "").slice(0, 150),
        options: raw.select.options.slice(0, 25).filter((o) => o && typeof o.label === "string" && o.response)
          .map((o) => ({ label: o.label.slice(0, 100), description: o.description ? String(o.description).slice(0, 100) : null, emoji: o.emoji ? String(o.emoji).slice(0, 64) : null, response: String(o.response).slice(0, 1900) }))
      };
    }
    return out;
  }
}

module.exports = CustomCommandService;
