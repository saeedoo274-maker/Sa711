/**
 * أدوات الاختبار المشتركة.
 *
 * - createApp(): تطبيق حقيقي كامل (كل الخدمات والمستودعات والإضافات والهجرات)
 *   فوق قاعدة بيانات مؤقتة، بلا اتصال بديسكورد.
 * - fake*(): كائنات ديسكورد مصغّرة تكفي لمسارات الأوامر والخدمات.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.BOT_TOKEN = process.env.BOT_TOKEN || "test-token";
process.env.CLIENT_ID = process.env.CLIENT_ID || "100000000000000001";
process.env.DEVELOPER_IDS = process.env.DEVELOPER_IDS || "900000000000000009";
process.env.LOG_LEVEL = "error";
process.env.BACKUP_ENABLED = "false";

const ROOT = path.join(__dirname, "..", "..");
const Application = require(path.join(ROOT, "src", "core", "client", "Application"));

// SQLite المدمج يطبع تحذيرًا تجريبيًا في كل عملية — لا قيمة له في مخرجات الاختبار
const originalEmit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes("SQLite")) return;
  return originalEmit.call(process, warning, ...rest);
};

let counter = 0;
const createdDirs = [];

async function createApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-test-"));
  createdDirs.push(dir);
  process.env.DATABASE_PATH = path.join(dir, `test-${++counter}.db`);
  const app = new Application();
  await app.init();
  const sent = [];
  // عميل ديسكورد وهمي بالقدر الذي تحتاجه الخدمات
  app.client.users.fetch = async (id) => fakeUser(id, { sent });
  app.client.channels.fetch = async (id) => app.__channels.get(id) || null;
  app.__channels = new Map();
  app.__sent = sent;
  Object.defineProperty(app.client, "user", { value: fakeUser("100000000000000001", { bot: true, username: "bot" }), configurable: true });
  return app;
}

function cleanup(app) {
  try {
    app.scheduler?.stop();
    app.queue?.stop();
    app.database?.close();
  } catch (error) {
    console.error("cleanup failed:", error.message);
  }
}

process.on("exit", () => {
  for (const dir of createdDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // مجلد مؤقت — نظام التشغيل ينظّفه لاحقًا
    }
  }
});

function collection(entries = []) {
  const map = new Map(entries);
  map.first = () => map.values().next().value;
  map.filter = (fn) => collection([...map].filter(([, v]) => fn(v)));
  map.map = (fn) => [...map.values()].map(fn);
  map.some = (fn) => [...map.values()].some(fn);
  map.find = (fn) => [...map.values()].find(fn);
  return map;
}

function fakeUser(id, { bot = false, username = `user${id.slice(-4)}`, sent = null } = {}) {
  return {
    id,
    bot,
    username,
    globalName: username,
    tag: username,
    createdTimestamp: Date.now() - 400 * 86_400_000,
    displayAvatarURL: () => `https://cdn.discordapp.com/avatars/${id}/x.png`,
    toString: () => `<@${id}>`,
    send: async (payload) => {
      if (sent) sent.push({ to: id, payload });
      return { id: `dm-${Date.now()}` };
    }
  };
}

function fakeRole(id, { name = `role${id.slice(-3)}`, position = 1 } = {}) {
  return { id, name, position, managed: false, color: 0, hexColor: "#000000", toString: () => `<@&${id}>` };
}

function fakeGuild(id = "200000000000000002", { ownerId = "300000000000000003", name = "Test Server" } = {}) {
  const roles = collection();
  const members = collection();
  const channels = collection();
  const guild = {
    id,
    name,
    ownerId,
    memberCount: 10,
    premiumSubscriptionCount: 2,
    premiumTier: 1,
    iconURL: () => null,
    roles: { cache: roles, fetch: async (rid) => roles.get(rid) || null, everyone: fakeRole(id, { name: "@everyone", position: 0 }) },
    channels: { cache: channels, fetch: async (cid) => channels.get(cid) || null },
    members: {
      cache: members,
      me: null,
      fetch: async (arg) => {
        if (typeof arg === "string") {
          const m = members.get(arg);
          if (!m) throw Object.assign(new Error("Unknown Member"), { code: 10007 });
          return m;
        }
        return members;
      }
    }
  };
  guild.members.me = fakeMember(guild, "100000000000000001", { bot: true, admin: true, rolePosition: 100 });
  return guild;
}

function fakeMember(guild, id, { bot = false, admin = false, roleIds = [], rolePosition = 1, permissions = [] } = {}) {
  const user = fakeUser(id, { bot });
  const roleCache = collection(roleIds.map((r) => [r, guild.roles.cache.get(r) || fakeRole(r)]));
  const member = {
    id,
    user,
    guild,
    displayName: user.username,
    nickname: null,
    joinedTimestamp: Date.now() - 30 * 86_400_000,
    toString: () => `<@${id}>`,
    permissions: {
      has: (p) => admin || permissions.includes(p),
      any: (list) => admin || list.some((p) => permissions.includes(p))
    },
    roles: {
      cache: roleCache,
      highest: { position: rolePosition },
      add: async (role) => { const r = typeof role === "string" ? fakeRole(role) : role; roleCache.set(r.id, r); return member; },
      remove: async (role) => { roleCache.delete(typeof role === "string" ? role : role.id); return member; }
    },
    send: user.send,
    setNickname: async (nick) => { member.nickname = nick; return member; }
  };
  guild.members.cache.set(id, member);
  return member;
}

function fakeChannel(guild, id, { name = `ch${id.slice(-3)}`, app = null } = {}) {
  const messages = [];
  const channel = {
    id,
    name,
    guild,
    type: 0,
    parentId: null,
    sent: messages,
    isTextBased: () => true,
    toString: () => `<#${id}>`,
    permissionsFor: () => ({ has: () => true }),
    send: async (payload) => {
      const msg = fakeSentMessage(channel, payload);
      messages.push(msg);
      return msg;
    },
    messages: { fetch: async (mid) => messages.find((m) => m.id === mid) || null }
  };
  guild.channels.cache.set(id, channel);
  if (app) app.__channels.set(id, channel);
  return channel;
}

let msgSeq = 1000;
function fakeSentMessage(channel, payload) {
  const msg = {
    id: String(500000000000000000n + BigInt(msgSeq++)),
    channel,
    guild: channel.guild,
    payload,
    content: typeof payload === "string" ? payload : payload?.content,
    edits: [],
    deleted: false,
    edit: async (p) => { msg.edits.push(p); msg.payload = p; return msg; },
    delete: async () => { msg.deleted = true; },
    react: async () => {},
    startThread: async () => ({ id: "thread", send: async () => {} })
  };
  return msg;
}

/** رسالة واردة من عضو (لأحداث messageCreate). */
function fakeMessage(member, channel, content, extra = {}) {
  const mentionsUsers = collection((extra.mentions || []).map((m) => [m.id, m.user || m]));
  const mentionsMembers = collection((extra.mentions || []).filter((m) => m.user).map((m) => [m.id, m]));
  const replies = [];
  const message = {
    id: String(600000000000000000n + BigInt(msgSeq++)),
    content,
    author: member.user,
    member,
    guild: channel.guild,
    channel,
    createdTimestamp: Date.now(),
    attachments: collection(),
    mentions: { users: mentionsUsers, members: mentionsMembers, roles: collection(), channels: collection(), repliedUser: null },
    replies,
    reply: async (p) => { replies.push(p); return fakeSentMessage(channel, p); },
    react: async () => {},
    delete: async () => {}
  };
  return message;
}

/** تفاعل سلاش وهمي يحاكي options/reply/deferReply. */
function fakeSlash(member, channel, { command, sub = null, group = null, options = {} } = {}) {
  const replies = [];
  const interaction = {
    commandName: command,
    guild: member.guild,
    member,
    user: member.user,
    channel,
    channelId: channel.id,
    replied: false,
    deferred: false,
    replies,
    isChatInputCommand: () => true,
    isContextMenuCommand: () => false,
    isAutocomplete: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    options: {
      getSubcommand: () => sub,
      getSubcommandGroup: () => group,
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getNumber: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getUser: (n) => options[n]?.user || options[n] || null,
      getMember: (n) => (options[n]?.user ? options[n] : null),
      getRole: (n) => options[n] ?? null,
      getChannel: (n) => options[n] ?? null,
      getAttachment: (n) => options[n] ?? null
    },
    reply: async (p) => { interaction.replied = true; replies.push(p); return fakeSentMessage(channel, p); },
    editReply: async (p) => { replies.push(p); return fakeSentMessage(channel, p); },
    followUp: async (p) => { replies.push(p); return fakeSentMessage(channel, p); },
    deferReply: async () => { interaction.deferred = true; },
    showModal: async (m) => { interaction.modal = m; replies.push({ modal: m }); }
  };
  return interaction;
}

/** تفاعل مكوّن (زر/قائمة/نموذج) وهمي. */
function fakeComponent(member, channel, customId, { values = [], fields = {}, message = null, kind = "button" } = {}) {
  const replies = [];
  const interaction = {
    customId,
    guild: member.guild,
    member,
    user: member.user,
    channel,
    message: message || fakeSentMessage(channel, {}),
    values,
    replied: false,
    deferred: false,
    replies,
    isButton: () => kind === "button",
    isAnySelectMenu: () => kind === "select",
    isStringSelectMenu: () => kind === "select",
    isModalSubmit: () => kind === "modal",
    isChatInputCommand: () => false,
    isContextMenuCommand: () => false,
    isAutocomplete: () => false,
    fields: { getTextInputValue: (n) => fields[n] ?? "", fields: new Map(Object.entries(fields)) },
    reply: async (p) => { interaction.replied = true; replies.push(p); return fakeSentMessage(channel, p); },
    update: async (p) => { interaction.replied = true; replies.push({ update: p }); },
    editReply: async (p) => { replies.push(p); },
    followUp: async (p) => { replies.push(p); },
    deferUpdate: async () => { interaction.deferred = true; },
    deferReply: async () => { interaction.deferred = true; },
    showModal: async (m) => { interaction.replied = true; interaction.modal = m; replies.push({ modal: m }); }
  };
  return interaction;
}

/** يجمع كل النصوص من ردود متعددة (محتوى + إمبيدات) لتسهيل التحقق. */
function textOf(replies) {
  const parts = [];
  for (const r of [].concat(replies)) {
    const p = r?.update || r;
    if (!p) continue;
    if (typeof p === "string") { parts.push(p); continue; }
    if (p.content) parts.push(p.content);
    for (const e of p.embeds || []) {
      const j = typeof e.toJSON === "function" ? e.toJSON() : e;
      parts.push(j.title || "", j.description || "", ...(j.fields || []).map((f) => `${f.name} ${f.value}`), j.footer?.text || "");
    }
    for (const c of p.components || []) parts.push(JSON.stringify(typeof c.toJSON === "function" ? c.toJSON() : c));
  }
  return parts.join("\n");
}

module.exports = {
  createApp,
  cleanup,
  collection,
  fakeUser,
  fakeRole,
  fakeGuild,
  fakeMember,
  fakeChannel,
  fakeMessage,
  fakeSlash,
  fakeComponent,
  textOf,
  ROOT
};
