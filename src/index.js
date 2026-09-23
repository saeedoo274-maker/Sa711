// فحص إصدار Node قبل أي شيء آخر.
// البوت يعتمد على SQLite المدمج في Node 22 حين لا تتوفر better-sqlite3،
// وأغلب الاستضافات تمنع بناء المكتبات الأصلية — فالفشل هنا برسالة واضحة
// أفضل بكثير من انهيار غامض داخل طبقة قاعدة البيانات لاحقًا.
const nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 22) {
  let hasBetterSqlite = false;
  try {
    require("better-sqlite3");
    hasBetterSqlite = true;
  } catch { /* غير مثبّتة */ }

  if (!hasBetterSqlite) {
    console.error(
      [
        "",
        "══════════════════════════════════════════════",
        `  إصدار Node الحالي: ${process.versions.node} — والمطلوب 22 أو أحدث.`,
        "",
        "  الحل من لوحة الاستضافة:",
        "    Startup ← Node Version ← اختر 22",
        "  ثم أعد تشغيل السيرفر.",
        "",
        "  (البوت يستخدم SQLite المدمج في Node 22، فلا يحتاج",
        "   تثبيت أي مكتبة أو أدوات بناء.)",
        "══════════════════════════════════════════════",
        ""
      ].join("\n")
    );
    process.exit(1);
  }
}

require("dotenv").config();
const Application = require("./core/client/Application");

(async () => {
  const app = new Application();
  try {
    await app.init();
    await app.start();
  } catch (error) {
    app.logger.error(`فشل إقلاع البوت: ${error.message}`, error.stack);
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => app.shutdown(0));
  }
})();
