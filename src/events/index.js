/** كل معالجات أحداث ديسكورد. التوقيع الموحّد: (app, ...args)
 *  ملاحظة: نستخدم clientReady لا ready — الاسم القديم أصبح مهملًا في discord.js
 *  الحديثة وإطلاقه يصدر تحذيرًا في السجلّات رغم أنه يعمل، فتفادينا التحذير بالاسم الجديد. */
module.exports = {
  clientReady: require("./ready"),
  interactionCreate: require("./interactionCreate"),
  messageCreate: require("./messageCreate"),
  guildCreate: require("./guildCreate"),
  guildDelete: require("./guildDelete"),
  guildMemberAdd: require("./guildMemberAdd"),
  voiceStateUpdate: require("./voiceStateUpdate"),
  messageReactionAdd: require("./messageReactionAdd"),
  messageReactionRemove: require("./messageReactionRemove")
};
