/** جلسات الصوت النشطة: `${guildId}:${userId}` -> وقت الدخول */
const sessions = new Map();

module.exports = async function voiceStateUpdate(app, oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const cfg = app.guildConfig.get(guild.id);
  if (!cfg.staff.trackVoice || !cfg.staff.baseRoleId) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;
  if (!member.roles.cache.has(cfg.staff.baseRoleId)) return;

  const key = `${guild.id}:${member.id}`;

  // دخول روم صوتي
  if (!oldState.channelId && newState.channelId) {
    sessions.set(key, Date.now());
    return;
  }

  // خروج من الصوت: تُحتسب المدة وتُخزَّن بالثواني
  if (oldState.channelId && !newState.channelId) {
    const since = sessions.get(key);
    sessions.delete(key);
    if (!since) return;
    const seconds = Math.round((Date.now() - since) / 1000);
    if (seconds > 0 && seconds < 86400) {
      app.activity.increment(guild.id, member.id, "voice_seconds", seconds);
    }
  }
};
