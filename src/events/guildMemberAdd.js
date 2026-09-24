const { PermissionFlagsBits } = require("discord.js");

module.exports = async function guildMemberAdd(app, member) {
  await app.logs.memberJoin(member).catch((err) => app.errors.capture(err, { system: "logs/memberJoin", guildId: member.guild.id }));

  const cfg = app.guildConfig.get(member.guild.id);
  if (!cfg.autoRoles?.enabled) return;

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) return;

  const roleIds = member.user.bot ? cfg.autoRoles.botRoleIds : cfg.autoRoles.memberRoleIds;
  for (const roleId of roleIds || []) {
    const role = member.guild.roles.cache.get(roleId);
    // تجاهل صامت لأي رتبة لم تعد صالحة، بدل إسقاط بقية الرتب
    if (!role || role.managed || role.position >= me.roles.highest.position) continue;
    await member.roles.add(role, "رتبة تلقائية").catch(() => {});
  }
};
