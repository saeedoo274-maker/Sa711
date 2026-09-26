/**
 * الرتب الذاتية والتلقائية — منطق التحقق والنشر الذي كان داخل أمري
 * `/رتب_ذاتية` و`/رتبة_تلقائية`، ونُقل هنا لتستدعيه لوحة التحكم المركزية.
 */
const crypto = require("crypto");
const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../core/permissions/PermissionService");
const { buildEmbed } = require("../../core/utils/helpers");

/** يمنع توزيع رتبة لا يستطيع البوت منحها أو أعلى من رتبة المنفّذ. يعيد نص المشكلة أو null. */
function validateGrantableRole(app, guild, member, role) {
  if (!role) return "الرتبة غير موجودة.";
  if (role.managed) return "هذه الرتبة مُدارة بواسطة تكامل خارجي ولا يمكن منحها.";
  if (role.id === guild.id) return "لا يمكن استخدام رتبة @everyone.";
  const me = guild.members?.me;
  if (me && role.position >= me.roles.highest.position) return `رتبة البوت أقل من <@&${role.id}>.`;
  if (role.permissions?.has?.(PermissionFlagsBits.Administrator)) return "لا يُسمح بتوزيع رتبة تحمل صلاحية Administrator.";
  const executorLevel = app.permissions.resolveLevel(member);
  if (executorLevel < Level.GUILD_OWNER && member.roles?.highest && role.position >= member.roles.highest.position) {
    return "لا يمكنك توزيع رتبة أعلى من رتبتك.";
  }
  return null;
}

async function publishSelfRoles(app, guild, channel, { title, style = "menu", max, roles }) {
  if (!roles?.length) return { ok: false, error: "اختر رتبة واحدة على الأقل." };
  const list = roles.slice(0, 25);
  const panelId = crypto.randomBytes(6).toString("hex");
  const limit = Math.max(1, Math.min(Number(max) || list.length, list.length));
  const heading = (title || "🎭 الرتب الذاتية").slice(0, 256);
  const config = { title: heading, style, max: limit, roles: list };

  const embed = buildEmbed({
    title: heading,
    description: style === "menu"
      ? `اختر رتبك من القائمة أدناه. اختيار رتبة موجودة لديك يزيلها.\nالحد الأقصى: \`${limit}\``
      : "اضغط على الزر للحصول على الرتبة، واضغط مرة أخرى لإزالتها.",
    color: app.config.color("primary"),
    footer: guild.name,
    timestamp: false
  });

  const components = [];
  if (style === "menu") {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`selfrole:menu:${panelId}`)
        .setPlaceholder("اختر رتبك")
        .setMinValues(0)
        .setMaxValues(limit)
        .addOptions(list.map((r) => ({ label: r.name.slice(0, 100), value: r.id })))
    ));
  } else {
    const buttons = list.slice(0, 25).map((r) =>
      new ButtonBuilder().setCustomId(`selfrole:btn:${panelId}:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)
    );
    for (let i = 0; i < buttons.length && components.length < 5; i += 5) components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }

  const message = await channel.send({ embeds: [embed], components }).catch(() => null);
  if (!message) return { ok: false, error: "تعذّر نشر اللوحة." };
  app.selfRoles.save({ id: panelId, guildId: guild.id, channelId: channel.id, messageId: message.id, config });
  return { ok: true, id: panelId, message };
}

module.exports = { validateGrantableRole, publishSelfRoles };
