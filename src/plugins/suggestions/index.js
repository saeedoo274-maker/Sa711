const SuggestionRepository = require("./SuggestionRepository");
const SuggestionService = require("./SuggestionService");

module.exports = {
  register(app) {
    app.suggestionsRepo = new SuggestionRepository(app.db);
    app.suggestions = new SuggestionService(app, app.suggestionsRepo);
    app.notifications.registerCategory("suggestions", "الاقتراحات");
  },
  health(app) {
    return { ok: true, details: `اقتراحات: ${app.db.prepare("SELECT COUNT(*) AS c FROM suggestions").get().c}` };
  }
};
