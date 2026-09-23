const { buildEmbed } = require("../core/utils/helpers");

module.exports = async function guildCreate(app, guild) {
  // السيرفرات المحظورة تُغادَر فورًا بلا تفاعل
  if (app.oversight.isBlacklisted(guild.id)) {
    app.logger.warn(`رفض الانضمام لسيرفر محظور: ${guild.name} (${guild.id})`);
    await guild.leave().catch(() => {});
    return;
  }

  app.guilds.ensure(guild.id);
  app.oversight.track({
    guildId: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    iconUrl: guild.iconURL() || null
  });

  app.logger.info(`انضم البوت إلى سيرفر جديد: ${guild.name} (${guild.id}) — ${guild.memberCount} عضو`);

  // إشعار المطورين في الخاص
  const embed = buildEmbed({
    title: "🌐 سيرفر جديد",
    color: app.config.color("success"),
    fields: [
      { name: "الاسم", value: `${guild.name}\n\`${guild.id}\`` },
      { name: "الأعضاء", value: `\`${guild.memberCount}\``, inline: true },
      { name: "المالك", value: `<@${guild.ownerId}>`, inline: true },
      { name: "إجمالي السيرفرات", value: `\`${app.client.guilds.cache.size}\``, inline: true }
    ],
    thumbnail: guild.iconURL() || undefined
  });
  for (const devId of app.config.developerIds) {
    const user = await app.client.users.fetch(devId).catch(() => null);
    await user?.send({ embeds: [embed] }).catch(() => {});
  }
};
