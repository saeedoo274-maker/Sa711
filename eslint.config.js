// إعداد ESLint: قواعد "recommended" مع تخفيف ما لا يعبّر عن أخطاء فعلية في نمط هذا المشروع.
const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", "data/**", "src/dashboard/public/vendor/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node }
    },
    rules: {
      // الوسائط غير المستخدمة شائعة في توقيعات المعالجات (app, interaction)
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      // catch فارغ مسموح فقط مع تعليق يشرح السبب (يفرضه no-empty افتراضيًا)
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-useless-escape": "warn",
      "no-control-regex": "off",
      "no-misleading-character-class": "warn",
      "preserve-caught-error": "off"
    }
  },
  {
    files: ["src/dashboard/public/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser } }
  }
];
