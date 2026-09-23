/** تفاعل جديد: قد يرفع رسالة إلى لوحة النجوم. */
module.exports = async function messageReactionAdd(app, reaction, user) {
  if (user.bot) return;
  // التفاعلات على رسائل قديمة تصل ناقصة، فنكملها قبل القراءة
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

  await app.reactionReplyService.handle(reaction, user, guild).catch((err) =>
    app.errors.capture(err, { system: "reactionreply", guildId: guild.id, userId: user.id })
  );
};
