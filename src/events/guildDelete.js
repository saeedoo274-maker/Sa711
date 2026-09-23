module.exports = async function guildDelete(app, guild) {
  // البيانات تبقى محفوظة تحسّبًا لعودة البوت، والكاش يُفرَّغ فورًا
  app.guildConfig.invalidate(guild.id);
  app.oversight.markLeft(guild.id);
  app.logger.info(`خرج البوت من سيرفر: ${guild.name || guild.id}`);
};
