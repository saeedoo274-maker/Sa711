const InviteRepository = require("./InviteRepository");
const InviteService = require("./InviteService");

module.exports = {
  register(app) {
    app.invitesRepo = new InviteRepository(app.db);
    app.invites = new InviteService(app, app.invitesRepo);
  },
  start(app) {
    const guilds = [...(app.client.guilds?.cache?.values?.() || [])];
    app.invites.warmup(guilds).catch((err) => app.errors.capture(err, { system: "invites/warmup" }));
  },
  events: {
    inviteCreate: (app, invite) => app.invites.onInviteCreate(invite),
    inviteDelete: (app, invite) => app.invites.onInviteDelete(invite),
    guildMemberAdd: (app, member) => app.invites.onMemberAdd(member),
    guildMemberRemove: (app, member) => app.invites.onMemberRemove(member),
    guildDelete: (app, guild) => app.invites.cache.delete(guild.id)
  },
  health(app) {
    return { ok: true, details: `سيرفرات محمّلة: ${app.invites.cache.size}` };
  }
};
