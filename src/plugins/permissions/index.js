const PermissionRuleService = require("./PermissionRuleService");

module.exports = {
  register(app) {
    app.permissionRules = new PermissionRuleService(app);
  },
  events: {
    guildDelete: (app, guild) => app.permissionRules.invalidate(guild.id)
  },
  health(app) {
    return { ok: true, details: `سيرفرات في الذاكرة: ${app.permissionRules.cache.size}` };
  }
};
