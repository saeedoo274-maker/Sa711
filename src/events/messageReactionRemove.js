/** إزالة تفاعل: قد تُنزل رسالة من لوحة النجوم. */
module.exports = async function messageReactionRemove(app, reaction, user) {
  if (user.bot) return;
  if (reaction.partial) {
    const fetched = await reaction.fetch().catch(() => null);
    if (!fetched) return;
  }
  if (reaction.message.partial) {
    const fetched = await reaction.message.fetch().catch(() => null);
    if (!fetched) return;
  }

  const guild = reaction.message.guild;
  if (!guild) return;

  await app.starboardService.sync(reaction, guild).catch((err) =>
    app.errors.capture(err, { system: "starboard", guildId: guild.id })
  );
};
