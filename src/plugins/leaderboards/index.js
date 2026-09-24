const LeaderboardRepository = require("./LeaderboardRepository");
const LeaderboardService = require("./LeaderboardService");

module.exports = {
  register(app) {
    app.leaderboardsRepo = new LeaderboardRepository(app.db);
    app.leaderboards = new LeaderboardService(app, app.leaderboardsRepo);
  }
};
