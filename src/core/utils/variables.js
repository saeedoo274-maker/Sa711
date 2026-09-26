/**
 * نظام المتغيرات الموحّد.
 *
 * يستبدل `{VARIABLE}` في أي نص: الإمبيدات، الترحيب، الردود التلقائية،
 * الأوامر المخصصة، ورسائل الأنظمة.
 *
 * ثلاث قواعد تحكم التصميم:
 *  1. **حساسية الحالة ملغاة** — `{USER}` و`{user}` و`{User}` سواء، فلا
 *     يفشل نص لأن كاتبه استخدم حالة مختلفة.
 *  2. **المتغير غير المعروف يبقى كما هو** — لا يُمحى، فيرى المستخدم خطأه
 *     بدل أن يختفي النص بصمت.
 *  3. **المتغير المعروف بلا سياق يُستبدل بفراغ** — `{REASON}` في رسالة
 *     ترحيب لا معنى له، فلا يُعرض حرفيًا.
 */

function pad(n) {
  return String(n).padStart(2, "0");
}

function fmtDate(d = new Date()) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function fmtTime(d = new Date()) {
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** يحوّل كيانًا (عضو/رتبة/قناة) لمنشن مناسب. */
function mentionOf(entity, type = "user") {
  if (!entity) return "";
  if (typeof entity === "string") {
    return type === "role" ? `<@&${entity}>` : type === "channel" ? `<#${entity}>` : `<@${entity}>`;
  }
  if (!entity.id) return "";
  return type === "role" ? `<@&${entity.id}>` : type === "channel" ? `<#${entity.id}>` : `<@${entity.id}>`;
}

/**
 * كل المتغيرات المدعومة.
 * المفتاح بالأحرف الكبيرة، والمطابقة تتجاهل الحالة.
 */
const RESOLVERS = {
  // ---- العضو ----
  USER: (c) => mentionOf(c.member || c.user),
  MENTION: (c) => mentionOf(c.member || c.user),
  USERNAME: (c) => c.user?.username || c.member?.user?.username || "",
  DISPLAYNAME: (c) => c.member?.displayName || c.member?.nickname || c.user?.globalName || c.user?.username || "",
  NICKNAME: (c) => c.member?.nickname || c.member?.displayName || c.user?.username || "",
  USER_ID: (c) => c.user?.id || c.member?.id || "",
  USER_TAG: (c) => c.user?.tag || c.member?.user?.tag || "",
  USER_AVATAR: (c) => {
    const u = c.user || c.member?.user;
    return u?.displayAvatarURL ? u.displayAvatarURL({ size: 512 }) : "";
  },
  USER_CREATED: (c) => {
    const u = c.user || c.member?.user;
    return u?.createdTimestamp ? `<t:${Math.floor(u.createdTimestamp / 1000)}:D>` : "";
  },
  USER_JOINED: (c) =>
    c.member?.joinedTimestamp ? `<t:${Math.floor(c.member.joinedTimestamp / 1000)}:D>` : "",

  // ---- السيرفر ----
  SERVER: (c) => c.guild?.name || "",
  SERVER_ID: (c) => c.guild?.id || "",
  SERVER_ICON: (c) => (c.guild?.iconURL ? c.guild.iconURL({ size: 512 }) || "" : ""),
  MEMBERS: (c) => (c.guild?.memberCount != null ? String(c.guild.memberCount) : ""),
  MEMBER_COUNT: (c) => (c.guild?.memberCount != null ? String(c.guild.memberCount) : ""),
  // مرادف قديم: إمبيدات منشورة تستخدمه، فيبقى مدعومًا للأبد
  MEMBERCOUNT: (c) => (c.guild?.memberCount != null ? String(c.guild.memberCount) : ""),
  OWNER: (c) => (c.guild?.ownerId ? `<@${c.guild.ownerId}>` : ""),

  // ---- القناة ----
  CHANNEL: (c) => mentionOf(c.channel, "channel"),
  CHANNEL_NAME: (c) => c.channel?.name || "",
  CHANNEL_ID: (c) => c.channel?.id || "",
  TICKET: (c) => mentionOf(c.ticket || c.channel, "channel"),

  // ---- الرتبة ----
  ROLE: (c) => mentionOf(c.role || c.roleId, "role"),
  ROLE_NAME: (c) => c.role?.name || "",
  ROLE_ID: (c) => (typeof c.role === "string" ? c.role : c.role?.id) || c.roleId || "",

  // ---- البوت ----
  BOT: (c) => mentionOf(c.bot?.user || c.client?.user),
  BOT_NAME: (c) => c.bot?.user?.username || c.client?.user?.username || "",
  BOT_ID: (c) => c.bot?.user?.id || c.client?.user?.id || "",
  PREFIX: (c) => c.prefix || "",

  // ---- الوقت ----
  DATE: () => fmtDate(),
  TIME: () => fmtTime(),
  DATETIME: () => `${fmtDate()} ${fmtTime()}`,
  YEAR: () => String(new Date().getUTCFullYear()),
  TIMESTAMP: () => `<t:${Math.floor(Date.now() / 1000)}:f>`,
  RELATIVE: () => `<t:${Math.floor(Date.now() / 1000)}:R>`,

  // ---- سياق الإجراءات الإدارية ----
  MODERATOR: (c) => mentionOf(c.moderator),
  MODERATOR_NAME: (c) => c.moderator?.username || c.moderator?.user?.username || "",
  MODERATOR_ID: (c) => c.moderator?.id || "",
  REASON: (c) => c.reason || "",
  DURATION: (c) => c.duration || "",
  CASE_ID: (c) => (c.caseId != null ? String(c.caseId) : ""),
  AMOUNT: (c) => (c.amount != null ? String(c.amount) : ""),
  POINTS: (c) => (c.points != null ? String(c.points) : ""),

  // ---- الإصدار الموسّع (أسماء صريحة مطلوبة من المنشئين) ----
  USER_MENTION: (c) => mentionOf(c.member || c.user),
  USER_NAME: (c) => c.user?.username || c.member?.user?.username || "",
  USER_BANNER: (c) => {
    const u = c.user || c.member?.user;
    return u?.bannerURL ? u.bannerURL({ size: 1024 }) || "" : "";
  },
  ACCOUNT_AGE: (c) => {
    const u = c.user || c.member?.user;
    return u?.createdTimestamp ? String(Math.floor((Date.now() - u.createdTimestamp) / 86_400_000)) : "";
  },
  JOIN_DATE: (c) => (c.member?.joinedTimestamp ? `<t:${Math.floor(c.member.joinedTimestamp / 1000)}:D>` : ""),
  CATEGORY_NAME: (c) => c.channel?.parent?.name || "",
  ROLE_COLOR: (c) => (typeof c.role === "object" && c.role?.hexColor) || "",
  SERVER_NAME: (c) => c.guild?.name || "",
  SERVER_OWNER: (c) => (c.guild?.ownerId ? `<@${c.guild.ownerId}>` : ""),
  SERVER_MEMBER_COUNT: (c) => (c.guild?.memberCount != null ? String(c.guild.memberCount) : ""),
  SERVER_BOOSTS: (c) => (c.guild?.premiumSubscriptionCount != null ? String(c.guild.premiumSubscriptionCount) : ""),
  SERVER_LEVEL: (c) => (c.guild?.premiumTier != null ? String(c.guild.premiumTier) : ""),
  TICKET_ID: (c) => (c.ticket?.number != null ? String(c.ticket.number) : c.ticket?.id ? String(c.ticket.id) : ""),
  TICKET_TYPE: (c) => c.ticket?.typeName || c.ticket?.type || "",
  TICKET_OWNER: (c) => (c.ticket?.ownerId ? `<@${c.ticket.ownerId}>` : c.ticket?.user_id ? `<@${c.ticket.user_id}>` : ""),
  TICKET_STAFF: (c) => (c.ticket?.claimedBy ? `<@${c.ticket.claimedBy}>` : c.ticket?.claimed_by ? `<@${c.ticket.claimed_by}>` : ""),
  CASE_TYPE: (c) => c.caseType || "",
  XP: (c) => (c.xp != null ? String(c.xp) : ""),
  LEVEL: (c) => (c.level != null ? String(c.level) : ""),
  RANK: (c) => (c.rank != null ? String(c.rank) : ""),
  BALANCE: (c) => (c.balance != null ? String(c.balance) : ""),
  BANK: (c) => (c.bank != null ? String(c.bank) : ""),
  REPUTATION: (c) => (c.reputation != null ? String(c.reputation) : ""),
  MESSAGES: (c) => (c.messages != null ? String(c.messages) : ""),
  INVITES: (c) => (c.invites != null ? String(c.invites) : ""),
  WARNINGS: (c) => (c.warnings != null ? String(c.warnings) : ""),
  ACHIEVEMENTS: (c) => (c.achievements != null ? String(c.achievements) : "")
};

/** المتغيرات التي لا معنى لها بلا سياق خاص — تُستبدل بفراغ لا بنصها. */
const CONTEXTUAL = new Set([
  "MODERATOR", "MODERATOR_NAME", "MODERATOR_ID",
  "REASON", "DURATION", "CASE_ID", "AMOUNT", "POINTS",
  "ROLE", "ROLE_NAME", "ROLE_ID", "TICKET", "ROLE_COLOR", "CATEGORY_NAME", "USER_BANNER",
  "TICKET_ID", "TICKET_TYPE", "TICKET_OWNER", "TICKET_STAFF", "CASE_TYPE",
  "XP", "LEVEL", "RANK", "BALANCE", "BANK", "REPUTATION", "MESSAGES", "INVITES", "WARNINGS", "ACHIEVEMENTS"
]);

const PLACEHOLDER_RE = /\{([A-Za-z_]+)\}/g;

/** أسماء كل المتغيرات — للعرض في شاشات المساعدة. */
const VARIABLE_NAMES = Object.keys(RESOLVERS);

/** مجموعات للعرض المنظّم. */
const VARIABLE_GROUPS = {
  "👤 العضو": ["USER", "MENTION", "USERNAME", "DISPLAYNAME", "NICKNAME", "USER_ID", "USER_TAG", "USER_AVATAR", "USER_CREATED", "USER_JOINED"],
  "🏠 السيرفر": ["SERVER", "SERVER_ID", "SERVER_ICON", "MEMBERS", "MEMBER_COUNT", "OWNER"],
  "💬 القناة": ["CHANNEL", "CHANNEL_NAME", "CHANNEL_ID", "TICKET"],
  "🎭 الرتبة": ["ROLE", "ROLE_NAME", "ROLE_ID"],
  "🤖 البوت": ["BOT", "BOT_NAME", "BOT_ID", "PREFIX"],
  "🕐 الوقت": ["DATE", "TIME", "DATETIME", "YEAR", "TIMESTAMP", "RELATIVE"],
  "⚖️ الإجراءات": ["MODERATOR", "MODERATOR_NAME", "MODERATOR_ID", "REASON", "DURATION", "CASE_ID", "CASE_TYPE", "AMOUNT", "POINTS"],
  "🧾 موسّعة": ["USER_MENTION", "USER_NAME", "USER_BANNER", "ACCOUNT_AGE", "JOIN_DATE", "CATEGORY_NAME", "ROLE_COLOR", "SERVER_NAME", "SERVER_OWNER", "SERVER_MEMBER_COUNT", "SERVER_BOOSTS", "SERVER_LEVEL"],
  "🎫 التذاكر": ["TICKET", "TICKET_ID", "TICKET_TYPE", "TICKET_OWNER", "TICKET_STAFF"],
  "📈 الإحصاءات": ["XP", "LEVEL", "RANK", "BALANCE", "BANK", "REPUTATION", "MESSAGES", "INVITES", "WARNINGS", "ACHIEVEMENTS"]
};

/**
 * يبني سياق المتغيرات من الكائنات المتاحة.
 * يستخرج `user` من `member` تلقائيًا فلا يحتاج المستدعي تمريرهما معًا.
 */
function buildContext({ member, user, guild, channel, role, roleId, ticket, bot, client, prefix, ...rest } = {}) {
  return {
    member: member || null,
    user: user || member?.user || null,
    guild: guild || member?.guild || null,
    channel: channel || null,
    role: role || null,
    roleId: roleId || null,
    ticket: ticket || null,
    bot: bot || client || null,
    client: client || bot || null,
    prefix: prefix || null,
    ...rest
  };
}

/**
 * يستبدل كل المتغيرات في النص.
 * @param {string} text
 * @param {object} ctx سياق من `buildContext`
 * @returns {string}
 */
function apply(text, ctx = {}) {
  if (!text || typeof text !== "string") return text ?? "";

  return text.replace(PLACEHOLDER_RE, (match, name) => {
    const key = name.toUpperCase();
    const resolver = RESOLVERS[key];

    // متغير غير معروف: يبقى كما كتبه المستخدم ليرى خطأه
    if (!resolver) return match;

    let value;
    try {
      value = resolver(ctx);
    } catch {
      value = "";
    }

    if (value !== "" && value != null) return String(value);

    // معروف لكن بلا قيمة: السياقي يُفرَّغ، وغيره يبقى ظاهرًا
    return CONTEXTUAL.has(key) ? "" : match;
  });
}

/** أسماء المتغيرات المستخدمة فعلًا في نص (بالأحرف الكبيرة). */
function usedVariables(text) {
  const out = new Set();
  if (typeof text !== "string") return out;
  for (const m of text.matchAll(PLACEHOLDER_RE)) out.add(m[1].toUpperCase());
  return out;
}

/**
 * اقتراحات الإكمال التلقائي للمنشئين: حين ينتهي النص بـ `{جزء` تُقترح المتغيرات المطابقة.
 * تُرجع قائمة نصوص كاملة (النص الحالي + المتغير) جاهزة كخيارات autocomplete.
 */
function suggest(typed = "", limit = 25) {
  const text = String(typed || "");
  const open = text.lastIndexOf("{");
  const closed = text.lastIndexOf("}");
  const partial = open > closed ? text.slice(open + 1).toUpperCase() : null;
  const base = open > closed ? text.slice(0, open) : text;
  const names = VARIABLE_NAMES.filter((n) => partial === null || n.startsWith(partial) || n.includes(partial));
  return names.slice(0, limit).map((n) => `${base}{${n}}`.slice(-100));
}

/** يطبّق المتغيرات على كل نصوص كائن الإمبيد دفعةً واحدة. */
function applyToEmbedData(data, ctx) {
  if (!data || typeof data !== "object") return data;

  const out = { ...data };
  for (const key of ["title", "description", "footer", "author", "image", "thumbnail", "url"]) {
    if (typeof out[key] === "string") out[key] = apply(out[key], ctx);
  }
  if (Array.isArray(out.fields)) {
    out.fields = out.fields.map((f) => ({
      ...f,
      name: apply(f.name, ctx),
      value: apply(f.value, ctx)
    }));
  }
  return out;
}

module.exports = {
  apply,
  applyToEmbedData,
  buildContext,
  VARIABLE_NAMES,
  VARIABLE_GROUPS,
  RESOLVERS,
  CONTEXTUAL,
  usedVariables,
  suggest
};
