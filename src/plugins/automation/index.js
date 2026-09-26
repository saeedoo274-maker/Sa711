const AutomationService = require("./AutomationService");

module.exports = {
  register(app) {
    app.automation = new AutomationService(app);
    const on = (event, type, map) => app.bus.on(event, (p) => {
      const ctx = map(p);
      if (ctx?.guild) app.automation.fire(type, ctx).catch((err) => app.errors.capture(err, { system: "automation" }));
    });
    const guildOf = (p) => p.guild || app.client.guilds?.cache?.get(p.guildId);
    on("levels:up", "level_up", (p) => {
      const guild = guildOf(p);
      return guild && { guild, member: guild.members.cache.get(p.userId) };
    });
    on("ticket:created", "ticket_created", (p) => ({ guild: p.guild, member: p.member, channel: p.guild?.channels?.cache?.get(p.ticket?.channel_id) }));
    on("ticket:closed", "ticket_closed", (p) => ({ guild: p.guild, member: p.guild?.members?.cache?.get(p.ticket?.owner_id) }));
    on("suggestion:created", "suggestion_created", (p) => ({ guild: guildOf(p), member: p.member || guildOf(p)?.members?.cache?.get(p.suggestion?.user_id || p.userId) }));
    on("giveaway:ended", "giveaway_ended", (p) => {
      const guild = app.client.guilds?.cache?.get(p.giveaway?.guild_id);
      return guild && { guild, channel: guild.channels.cache.get(p.giveaway.channel_id) };
    });
    app.scheduler.define("automation:continue", (job) => app.automation.continueJob(job.payload), { description: "إكمال أتمتة بعد انتظار" });
    app.scheduler.define("automation:scheduled", (job) => app.automation.scheduledJob(job.payload), { description: "أتمتة مجدولة" });
  },
  events: {
    guildMemberAdd: (app, member) => !member.user.bot && app.automation.fire("member_join", { guild: member.guild, member }),
    guildMemberRemove: (app, member) => !member.user?.bot && app.automation.fire("member_leave", { guild: member.guild, member }),
    messageCreate: (app, message) => {
      if (!message.guild || message.author?.bot || message.webhookId) return null;
      return app.automation.fire("message_keyword", { guild: message.guild, member: message.member, channel: message.channel, message });
    },
    guildMemberUpdate: async (app, oldMember, newMember) => {
      if (oldMember.partial || newMember.user?.bot) return;
      for (const roleId of newMember.roles.cache.keys()) {
        if (!oldMember.roles.cache.has(roleId)) await app.automation.fire("role_added", { guild: newMember.guild, member: newMember, roleId });
      }
    },
    voiceStateUpdate: (app, oldState, newState) => {
      if (!newState.channelId || oldState.channelId === newState.channelId || newState.member?.user?.bot) return null;
      return app.automation.fire("voice_join", { guild: newState.guild, member: newState.member, channel: newState.channel, channelId: newState.channelId });
    },
    guildDelete: (app, guild) => app.automation.invalidate(guild.id)
  },
  health(app) {
    return { ok: true, details: `سيرفرات في الذاكرة: ${app.automation.cache.size}` };
  }
};
