module.exports = {
  register() {},
  health(app) {
    return { ok: true, details: `أعلام الميزات المعروفة: ${app.features.list().length}` };
  }
};
