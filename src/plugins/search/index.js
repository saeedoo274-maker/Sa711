const SearchService = require("./SearchService");

module.exports = {
  register(app) {
    app.search = new SearchService(app);
  }
};
