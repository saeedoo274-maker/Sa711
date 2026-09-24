/**
 * أحداث ديسكورد الخاصة بالسجلات الموسّعة.
 * كل معالج يمرر الحدث لـ LogService فقط؛ الإضافات (السجل التاريخي، التحليلات...)
 * تستقبل نفس الأحداث عبر مدير الإضافات دون أي تعديل هنا.
 */
module.exports = {
  messageDelete: (app, message) => app.logs.messageDelete(message),
  messageUpdate: (app, oldMessage, newMessage) => app.logs.messageUpdate(oldMessage, newMessage),
  messageDeleteBulk: (app, messages, channel) => app.logs.messageDeleteBulk(messages, channel),
  guildMemberRemove: (app, member) => app.logs.memberLeave(member),
  guildBanAdd: (app, ban) => app.logs.banAdd(ban),
  guildBanRemove: (app, ban) => app.logs.banRemove(ban),
  guildMemberUpdate: (app, oldMember, newMember) => app.logs.memberUpdate(oldMember, newMember),
  userUpdate: (app, oldUser, newUser) => app.logs.userUpdate(oldUser, newUser),
  roleCreate: (app, role) => app.logs.role("create", role),
  roleDelete: (app, role) => app.logs.role("delete", role),
  roleUpdate: (app, oldRole, newRole) => app.logs.role("update", newRole, oldRole),
  channelCreate: (app, channel) => app.logs.channel("create", channel),
  channelDelete: (app, channel) => app.logs.channel("delete", channel),
  channelUpdate: (app, oldChannel, newChannel) => app.logs.channel("update", newChannel, oldChannel),
  guildUpdate: (app, oldGuild, newGuild) => app.logs.guildUpdate(oldGuild, newGuild),
  threadCreate: (app, thread) => app.logs.thread("create", thread),
  threadDelete: (app, thread) => app.logs.thread("delete", thread),
  threadUpdate: (app, oldThread, newThread) => app.logs.thread("update", newThread, oldThread)
};
