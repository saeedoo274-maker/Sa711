const { ActionRowBuilder, StringSelectMenuBuilder } = require("discord.js");
const { stamp } = require("../../core/interactions/ui");

const SECTIONS = ["overview", "names", "roles", "presence", "moderation"];

function historyPayload(app, guild, user, member, section, ownerId) {
  const t = app.i18n.forGuild(guild.id);
  const embed = app.history.sectionEmbed(guild, user, member, section);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`mbr:h:${user.id}:${ownerId}:${stamp()}`)
    .setPlaceholder(t("member.section"))
    .addOptions(SECTIONS.map((s) => ({ label: t(`hist.${s}`), value: s, default: s === section })));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)], allowedMentions: { parse: [] } };
}

module.exports = { historyPayload, SECTIONS };
