const StarboardPlusRepository = require("./StarboardPlusRepository");
const StarboardPlusService = require("./StarboardPlusService");

module.exports = {
  register(app) {
    app.starboardPlusRepo = new StarboardPlusRepository(app.db);
    app.starboardPlus = new StarboardPlusService(app, app.starboardPlusRepo);
  },
  events: {
    messageReactionAdd: (app, reaction, user) => app.starboardPlus.onReaction(reaction, user, true),
    messageReactionRemove: (app, reaction, user) => app.starboardPlus.onReaction(reaction, user, false),
    guildDelete: (app, guild) => app.starboardPlus.invalidate(guild.id)
  },
  health(app) {
    return { ok: true, details: `سيرفرات في الذاكرة: ${app.starboardPlus.cache.size}` };
  }
};
