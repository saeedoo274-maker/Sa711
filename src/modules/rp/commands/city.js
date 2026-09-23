const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, parseDuration, formatDuration, truncate } = require("../../../core/utils/helpers");

const SYSTEM = "rp.enabled";

/** إدارة المدينة: تعريف العناصر والوظائف والسرقات، ونشر اللوحات. */
module.exports = [
  {
    name: "مدينة",
    aliases: ["city", "rp"],
    description: "إدارة أنظمة المدينة: العناصر، الوظائف، السرقات، اللوحات، والإعدادات.",
    usage: "/مدينة عنصر-انشاء key:wood label:خشب sell:17",
    arguments: [
      { name: "عنصر-انشاء", required: false, description: "تعريف عنصر جديد" },
      { name: "عنصر-تعديل", required: false, description: "تعديل خاصية عنصر" },
      { name: "عنصر-حذف", required: false, description: "حذف عنصر" },
      { name: "العناصر", required: false, description: "عرض كل العناصر" },
      { name: "وظيفة-انشاء", required: false, description: "تعريف وظيفة" },
      { name: "وظيفة-تعديل", required: false, description: "تعديل وظيفة" },
      { name: "الوظائف", required: false, description: "عرض الوظائف" },
      { name: "سرقة-انشاء", required: false, description: "تعريف نوع سرقة" },
      { name: "سرقة-تعديل", required: false, description: "تعديل سرقة" },
      { name: "موقع-اضافة", required: false, description: "إضافة موقع عمل" },
      { name: "لوحة", required: false, description: "نشر لوحة (وظائف/سوق/سرقة/عمل)" },
      { name: "اعطاء", required: false, description: "إعطاء عنصر لعضو" },
      { name: "سحب", required: false, description: "سحب عنصر من عضو" },
      { name: "اعدادات", required: false, description: "ضبط الرتب والقنوات" }
    ],
    examples: [
      "/مدينة عنصر-انشاء key:wood label:خشب sell:17",
      "/مدينة وظيفة-انشاء key:logger label:حطاب emoji:🪓 reward-item:wood",
      "/مدينة لوحة type:jobs channel:#تقديم-وظيفة"
    ],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageGuild] },
    slash: new SlashCommandBuilder()
      .setName("مدينة")
      .setDescription("إدارة أنظمة المدينة")
      .addSubcommand((s) =>
        s.setName("عنصر-انشاء").setDescription("تعريف عنصر")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح إنجليزي بلا مسافات").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(60))
          .addIntegerOption((o) => o.setName("sell").setDescription("سعر البيع (0 = غير قابل للبيع)").setMinValue(0))
          .addIntegerOption((o) => o.setName("buy").setDescription("سعر الشراء (اتركه فارغًا = غير معروض)").setMinValue(0))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addBooleanOption((o) => o.setName("illegal").setDescription("سلعة سوق سوداء؟"))
          .addIntegerOption((o) => o.setName("stock").setDescription("المخزون (فارغ = بلا حد)").setMinValue(0))
      )
      .addSubcommand((s) =>
        s.setName("عنصر-تعديل").setDescription("تعديل عنصر")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح العنصر").setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الحقل").setRequired(true)
              .addChoices(
                { name: "الاسم", value: "label" }, { name: "الإيموجي", value: "emoji" },
                { name: "سعر البيع", value: "sell_price" }, { name: "سعر الشراء", value: "buy_price" },
                { name: "سوق سوداء", value: "illegal" }, { name: "المخزون", value: "stock" },
                { name: "مفعّل", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("عنصر-حذف").setDescription("حذف عنصر")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح العنصر").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((s) => s.setName("العناصر").setDescription("عرض كل العناصر"))
      .addSubcommand((s) =>
        s.setName("وظيفة-انشاء").setDescription("تعريف وظيفة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح إنجليزي").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(60))
          .addRoleOption((o) => o.setName("role").setDescription("رتبة الوظيفة"))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addStringOption((o) => o.setName("reward-item").setDescription("العنصر الذي يُكافأ به").setAutocomplete(true))
          .addIntegerOption((o) => o.setName("reward-min").setDescription("أقل كمية").setMinValue(0))
          .addIntegerOption((o) => o.setName("reward-max").setDescription("أكثر كمية").setMinValue(0))
          .addStringOption((o) => o.setName("duration").setDescription("مدة العمل مثل 1m").setMaxLength(20))
          .addStringOption((o) => o.setName("cooldown").setDescription("التبريد مثل 5m").setMaxLength(20))
          .addStringOption((o) => o.setName("image").setDescription("رابط صورة الوظيفة"))
      )
      .addSubcommand((s) =>
        s.setName("وظيفة-تعديل").setDescription("تعديل وظيفة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح الوظيفة").setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الحقل").setRequired(true)
              .addChoices(
                { name: "الاسم", value: "label" }, { name: "الإيموجي", value: "emoji" },
                { name: "الرتبة", value: "role_id" }, { name: "الصورة", value: "image_url" },
                { name: "عنصر المكافأة", value: "reward_item" }, { name: "أقل كمية", value: "reward_min" },
                { name: "أكثر كمية", value: "reward_max" }, { name: "المدة (ms)", value: "duration_ms" },
                { name: "التبريد (ms)", value: "cooldown_ms" }, { name: "مفعّلة", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) => s.setName("الوظائف").setDescription("عرض الوظائف"))
      .addSubcommand((s) =>
        s.setName("سرقة-انشاء").setDescription("تعريف نوع سرقة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح إنجليزي").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(60))
          .addIntegerOption((o) => o.setName("min").setDescription("أقل غنيمة").setMinValue(0))
          .addIntegerOption((o) => o.setName("max").setDescription("أكثر غنيمة").setMinValue(0))
          .addIntegerOption((o) => o.setName("success").setDescription("نسبة النجاح %").setMinValue(1).setMaxValue(100))
          .addStringOption((o) => o.setName("required-item").setDescription("عنصر مطلوب").setAutocomplete(true))
          .addBooleanOption((o) => o.setName("consume").setDescription("يُستهلك العنصر؟"))
          .addIntegerOption((o) => o.setName("min-police").setDescription("أقل عدد شرطة مباشرين").setMinValue(0))
          .addStringOption((o) => o.setName("duration").setDescription("المدة مثل 1m").setMaxLength(20))
          .addStringOption((o) => o.setName("cooldown").setDescription("التبريد مثل 10m").setMaxLength(20))
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addStringOption((o) => o.setName("image").setDescription("رابط الصورة"))
      )
      .addSubcommand((s) =>
        s.setName("سرقة-تعديل").setDescription("تعديل سرقة")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح السرقة").setRequired(true).setAutocomplete(true))
          .addStringOption((o) =>
            o.setName("field").setDescription("الحقل").setRequired(true)
              .addChoices(
                { name: "الاسم", value: "label" }, { name: "الإيموجي", value: "emoji" },
                { name: "الصورة", value: "image_url" }, { name: "عنصر مطلوب", value: "required_item" },
                { name: "يُستهلك", value: "consume_item" }, { name: "أقل غنيمة", value: "reward_min" },
                { name: "أكثر غنيمة", value: "reward_max" }, { name: "نسبة النجاح", value: "success_percent" },
                { name: "المدة (ms)", value: "duration_ms" }, { name: "التبريد (ms)", value: "cooldown_ms" },
                { name: "أقل شرطة", value: "min_police" }, { name: "مفعّلة", value: "enabled" }
              )
          )
          .addStringOption((o) => o.setName("value").setDescription("القيمة الجديدة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("موقع-اضافة").setDescription("إضافة موقع عمل")
          .addStringOption((o) => o.setName("job").setDescription("الوظيفة").setRequired(true).setAutocomplete(true))
          .addStringOption((o) => o.setName("name").setDescription("اسم الموقع").setRequired(true).setMaxLength(80))
          .addStringOption((o) => o.setName("image").setDescription("رابط الصورة"))
          .addStringOption((o) => o.setName("note").setDescription("ملاحظة").setMaxLength(300))
      )
      .addSubcommand((s) =>
        s.setName("لوحة").setDescription("نشر لوحة في قناة")
          .addStringOption((o) =>
            o.setName("type").setDescription("نوع اللوحة").setRequired(true)
              .addChoices(
                { name: "اختيار الوظائف", value: "jobs" },
                { name: "بدء عمل (وظيفة محددة)", value: "job" },
                { name: "السوق السوداء", value: "market" },
                { name: "سرقة محددة", value: "robbery" }
              )
          )
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
          .addStringOption((o) => o.setName("key").setDescription("مفتاح الوظيفة/السرقة (للنوعين المحددين)").setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("اعطاء").setDescription("إعطاء عنصر لعضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("item").setDescription("العنصر").setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("سحب").setDescription("سحب عنصر من عضو")
          .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
          .addStringOption((o) => o.setName("item").setDescription("العنصر").setRequired(true).setAutocomplete(true))
          .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setRequired(true).setMinValue(1))
      )
      .addSubcommand((s) =>
        s.setName("ممتلك-انشاء").setDescription("تعريف مركبة أو عقار للبيع")
          .addStringOption((o) => o.setName("key").setDescription("مفتاح إنجليزي").setRequired(true).setMaxLength(32))
          .addStringOption((o) => o.setName("label").setDescription("الاسم الظاهر").setRequired(true).setMaxLength(60))
          .addIntegerOption((o) => o.setName("price").setDescription("السعر").setRequired(true).setMinValue(1))
          .addStringOption((o) =>
            o.setName("kind").setDescription("النوع")
              .addChoices({ name: "مركبة", value: "vehicle" }, { name: "عقار", value: "house" })
          )
          .addStringOption((o) => o.setName("emoji").setDescription("إيموجي").setMaxLength(32))
          .addStringOption((o) => o.setName("location").setDescription("الموقع").setMaxLength(80))
          .addIntegerOption((o) => o.setName("stock").setDescription("المخزون (فارغ = بلا حد)").setMinValue(0))
      )
      .addSubcommand((s) =>
        s.setName("الممتلكات").setDescription("عرض المعروضات")
      )
      .addSubcommand((s) =>
        s.setName("ممتلك-حذف").setDescription("حذف معروض")
          .addStringOption((o) => o.setName("key").setDescription("المفتاح").setRequired(true).setAutocomplete(true))
      )
      .addSubcommand((s) =>
        s.setName("معرض").setDescription("نشر معرض المركبات أو العقارات")
          .addStringOption((o) =>
            o.setName("kind").setDescription("النوع").setRequired(true)
              .addChoices({ name: "مركبات", value: "vehicle" }, { name: "عقارات", value: "house" })
          )
          .addChannelOption((o) => o.setName("channel").setDescription("القناة").setRequired(true).addChannelTypes(ChannelType.GuildText))
      )
      .addSubcommand((s) =>
        s.setName("اعدادات").setDescription("ضبط النظام")
          .addBooleanOption((o) => o.setName("enabled").setDescription("تفعيل أنظمة المدينة"))
          .addRoleOption((o) => o.setName("jail-role").setDescription("رتبة السجن"))
          .addStringOption((o) => o.setName("jobs-image").setDescription("صورة لوحة الوظائف"))
          .addStringOption((o) => o.setName("market-image").setDescription("صورة السوق السوداء"))
          .addBooleanOption((o) => o.setName("wanted-on-robbery").setDescription("السرقة الناجحة تجعله مطلوبًا"))
          .addIntegerOption((o) => o.setName("max-characters").setDescription("عدد الشخصيات المسموح لكل عضو").setMinValue(1).setMaxValue(5))
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async autocomplete(interaction, app) {
      const guildId = interaction.guild.id;
      const focused = interaction.options.getFocused(true);
      const term = String(focused.value || "").toLowerCase();
      const sub = interaction.options.getSubcommand(false);

      let pool = [];
      if (["item", "reward-item", "required-item"].includes(focused.name)) {
        pool = app.rp.listItems(guildId).map((i) => ({ name: `${i.label} (${i.key})`, value: i.key }));
      } else if (focused.name === "job") {
        pool = app.rp.listJobs(guildId).map((j) => ({ name: j.label, value: j.key }));
      } else if (focused.name === "key") {
        if (sub?.startsWith("عنصر")) pool = app.rp.listItems(guildId).map((i) => ({ name: `${i.label} (${i.key})`, value: i.key }));
        else if (sub?.startsWith("وظيفة")) pool = app.rp.listJobs(guildId).map((j) => ({ name: j.label, value: j.key }));
        else if (sub?.startsWith("سرقة")) pool = app.rp.listRobberies(guildId).map((r) => ({ name: r.label, value: r.key }));
        else if (sub?.startsWith("ممتلك")) pool = app.rp.listProperties(guildId).map((r) => ({ name: `${r.label} (${r.key})`, value: r.key }));
        else {
          // لوحة: نعرض الوظائف والسرقات معًا لأن النوع يحدد المقصود
          pool = [
            ...app.rp.listJobs(guildId).map((j) => ({ name: `وظيفة: ${j.label}`, value: j.key })),
            ...app.rp.listRobberies(guildId).map((r) => ({ name: `سرقة: ${r.label}`, value: r.key }))
          ];
        }
      }

      return interaction.respond(pool.filter((o) => o.name.toLowerCase().includes(term) || o.value.toLowerCase().includes(term)).slice(0, 25));
    },

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const app = ctx.app;
      const svc = app.rpService;
      const me = ctx.guild.members.me;
      const opt = (n) => ctx.interaction.options.getString(n);
      const validKey = (k) => /^[a-z0-9_]{2,32}$/.test(k);

      // ---------- العناصر ----------
      if (sub === "عنصر-انشاء") {
        const key = opt("key").trim().toLowerCase();
        if (!validKey(key)) return ctx.fail("errors.actionFailed", { details: "المفتاح: حروف إنجليزية صغيرة وأرقام وشرطة سفلية، 2-32." });
        if (app.rp.getItem(guildId, key)) return ctx.fail("errors.actionFailed", { details: `العنصر \`${key}\` موجود بالفعل.` });

        const item = app.rp.createItem({
          guildId, key, label: opt("label"), emoji: opt("emoji"),
          sellPrice: ctx.interaction.options.getInteger("sell") || 0,
          buyPrice: ctx.interaction.options.getInteger("buy"),
          illegal: ctx.interaction.options.getBoolean("illegal"),
          stock: ctx.interaction.options.getInteger("stock")
        });
        return ctx.success(
          `تم تعريف **${item.label}** (\`${item.key}\`)\n` +
          `بيع: ${item.sell_price ? svc.money(guildId, item.sell_price) : "—"} • ` +
          `شراء: ${item.buy_price !== null ? svc.money(guildId, item.buy_price) : "—"}` +
          (item.illegal ? " • ☠️ سوق سوداء" : "")
        );
      }

      if (sub === "عنصر-تعديل" || sub === "وظيفة-تعديل" || sub === "سرقة-تعديل") {
        const key = opt("key").trim();
        const field = opt("field");
        let value = opt("value").trim();

        const numeric = ["sell_price", "buy_price", "stock", "reward_min", "reward_max", "duration_ms",
                         "cooldown_ms", "success_percent", "min_police"];
        const boolean = ["illegal", "enabled", "consume_item"];
        if (numeric.includes(field)) {
          if (value === "" || value === "null") value = null;
          else {
            const n = parseInt(value, 10);
            if (isNaN(n) || n < 0) return ctx.fail("errors.actionFailed", { details: "القيمة لازم تكون رقمًا موجبًا." });
            value = n;
          }
        } else if (boolean.includes(field)) {
          value = ["نعم", "yes", "true", "1"].includes(value.toLowerCase()) ? 1 : 0;
        } else if (value === "" || value === "null") {
          value = null;
        }

        try {
          if (sub === "عنصر-تعديل") {
            if (!app.rp.getItem(guildId, key)) return ctx.fail("errors.actionFailed", { details: "العنصر غير موجود." });
            app.rp.updateItem(guildId, key, field, value);
          } else if (sub === "وظيفة-تعديل") {
            if (!app.rp.getJob(guildId, key)) return ctx.fail("errors.actionFailed", { details: "الوظيفة غير موجودة." });
            app.rp.updateJob(guildId, key, field, value);
          } else {
            if (!app.rp.getRobbery(guildId, key)) return ctx.fail("errors.actionFailed", { details: "السرقة غير موجودة." });
            app.rp.updateRobbery(guildId, key, field, value);
          }
        } catch (err) {
          return ctx.fail("errors.actionFailed", { details: err.message });
        }
        return ctx.success(`تم تعديل \`${field}\` لـ \`${key}\`.`);
      }

      if (sub === "عنصر-حذف") {
        const key = opt("key").trim();
        if (!app.rp.deleteItem(guildId, key)) return ctx.fail("errors.actionFailed", { details: "العنصر غير موجود." });
        return ctx.success(`تم حذف \`${key}\`. (الكميات في حقائب الأعضاء تبقى مسجّلة لكن بلا بيانات عنصر)`);
      }

      if (sub === "العناصر") {
        const items = app.rp.listItems(guildId);
        if (!items.length) return ctx.fail("errors.actionFailed", { details: "ما فيه عناصر بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "📦 عناصر المدينة",
            description: items
              .map((i) => `${i.emoji || "•"} **${i.label}** \`${i.key}\`${i.illegal ? " ☠️" : ""}\n  بيع: ${i.sell_price || "—"} • شراء: ${i.buy_price ?? "—"}${i.stock !== null ? ` • مخزون: ${i.stock}` : ""}`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      // ---------- الوظائف ----------
      if (sub === "وظيفة-انشاء") {
        const key = opt("key").trim().toLowerCase();
        if (!validKey(key)) return ctx.fail("errors.actionFailed", { details: "المفتاح: حروف إنجليزية صغيرة وأرقام، 2-32." });
        if (app.rp.getJob(guildId, key)) return ctx.fail("errors.actionFailed", { details: `الوظيفة \`${key}\` موجودة.` });

        const role = ctx.interaction.options.getRole("role");
        if (role && (role.managed || role.position >= me.roles.highest.position)) {
          return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${role.id}> — ارفع رتبة البوت فوقها.` });
        }
        const rewardItem = opt("reward-item");
        if (rewardItem && !app.rp.getItem(guildId, rewardItem)) {
          return ctx.fail("errors.actionFailed", { details: `العنصر \`${rewardItem}\` غير معرّف. أنشئه أولًا.` });
        }

        const job = app.rp.createJob({
          guildId, key, label: opt("label"), emoji: opt("emoji"), roleId: role?.id,
          imageUrl: opt("image"), rewardItem,
          rewardMin: ctx.interaction.options.getInteger("reward-min") ?? 1,
          rewardMax: ctx.interaction.options.getInteger("reward-max") ?? 3,
          durationMs: parseDuration(opt("duration") || "1m") || 60000,
          cooldownMs: parseDuration(opt("cooldown") || "0") || 0
        });
        return ctx.success(
          `تم تعريف وظيفة **${job.label}** (\`${job.key}\`)\n` +
          `المدة: ${formatDuration(job.duration_ms)} • المكافأة: ${job.reward_min}-${job.reward_max} × ${job.reward_item || "—"}`
        );
      }

      if (sub === "الوظائف") {
        const jobs = app.rp.listJobs(guildId);
        if (!jobs.length) return ctx.fail("errors.actionFailed", { details: "ما فيه وظائف بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "💼 وظائف المدينة",
            description: jobs
              .map((j) => `${j.emoji || "•"} **${j.label}** \`${j.key}\`\n  رتبة: ${j.role_id ? `<@&${j.role_id}>` : "—"} • مكافأة: ${j.reward_min}-${j.reward_max} × ${j.reward_item || "—"} • ${formatDuration(j.duration_ms)}`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      // ---------- السرقات ----------
      if (sub === "سرقة-انشاء") {
        const key = opt("key").trim().toLowerCase();
        if (!validKey(key)) return ctx.fail("errors.actionFailed", { details: "المفتاح: حروف إنجليزية صغيرة وأرقام، 2-32." });
        if (app.rp.getRobbery(guildId, key)) return ctx.fail("errors.actionFailed", { details: `السرقة \`${key}\` موجودة.` });

        const requiredItem = opt("required-item");
        if (requiredItem && !app.rp.getItem(guildId, requiredItem)) {
          return ctx.fail("errors.actionFailed", { details: `العنصر \`${requiredItem}\` غير معرّف.` });
        }

        const rob = app.rp.createRobbery({
          guildId, key, label: opt("label"), emoji: opt("emoji"), imageUrl: opt("image"),
          requiredItem, consumeItem: ctx.interaction.options.getBoolean("consume"),
          rewardMin: ctx.interaction.options.getInteger("min") ?? 100,
          rewardMax: ctx.interaction.options.getInteger("max") ?? 500,
          successPercent: ctx.interaction.options.getInteger("success") ?? 70,
          minPolice: ctx.interaction.options.getInteger("min-police") ?? 0,
          durationMs: parseDuration(opt("duration") || "1m") || 60000,
          cooldownMs: parseDuration(opt("cooldown") || "10m") || 600000
        });
        return ctx.success(
          `تم تعريف **${rob.label}** (\`${rob.key}\`)\n` +
          `الغنيمة: ${rob.reward_min}-${rob.reward_max} • النجاح: ${rob.success_percent}% • التبريد: ${formatDuration(rob.cooldown_ms)}`
        );
      }

      // ---------- المواقع ----------
      if (sub === "موقع-اضافة") {
        const jobKey = opt("job").trim();
        if (!app.rp.getJob(guildId, jobKey)) return ctx.fail("errors.actionFailed", { details: "الوظيفة غير موجودة." });
        const image = opt("image");
        if (image && !/^https:\/\/\S+$/i.test(image)) {
          return ctx.fail("errors.actionFailed", { details: "رابط الصورة لازم يبدأ بـ https://" });
        }
        const loc = app.rp.addLocation({ guildId, jobKey, name: opt("name"), imageUrl: image, note: opt("note") });
        return ctx.success(`تمت إضافة موقع **${loc.name}** لوظيفة \`${jobKey}\`.`);
      }

      // ---------- اللوحات ----------
      if (sub === "لوحة") {
        const type = opt("type");
        const channel = ctx.interaction.options.getChannel("channel");
        const key = opt("key");

        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }

        let payload;
        if (type === "jobs") payload = svc.jobsPanelPayload(ctx.guild);
        else if (type === "market") payload = svc.blackMarketPayload(ctx.guild);
        else if (type === "job") {
          if (!key) return ctx.fail("errors.actionFailed", { details: "حدد مفتاح الوظيفة." });
          const job = app.rp.getJob(guildId, key);
          if (!job) return ctx.fail("errors.actionFailed", { details: "الوظيفة غير موجودة." });
          payload = svc.jobStartPanelPayload(ctx.guild, job);
        } else {
          if (!key) return ctx.fail("errors.actionFailed", { details: "حدد مفتاح السرقة." });
          const rob = app.rp.getRobbery(guildId, key);
          if (!rob) return ctx.fail("errors.actionFailed", { details: "السرقة غير موجودة." });
          payload = svc.robberyPanelPayload(ctx.guild, rob);
        }

        const message = await channel.send(payload).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر اللوحة." });
        return ctx.success(`تم نشر اللوحة في <#${channel.id}>.`);
      }

      // ---------- إعطاء وسحب ----------
      if (sub === "اعطاء" || sub === "سحب") {
        const user = ctx.interaction.options.getUser("user");
        const itemKey = opt("item").trim();
        const amount = ctx.interaction.options.getInteger("amount");

        const item = app.rp.getItem(guildId, itemKey);
        if (!item) return ctx.fail("errors.actionFailed", { details: `العنصر \`${itemKey}\` غير معرّف.` });
        if (user.bot) return ctx.fail("errors.actionFailed", { details: "البوتات ما لها حقائب." });

        if (sub === "اعطاء") {
          app.rp.give({ guildId, userId: user.id, itemKey, amount, reason: "منح إداري", actorId: ctx.user.id });
        } else {
          const taken = app.rp.take({ guildId, userId: user.id, itemKey, amount, reason: "سحب إداري", actorId: ctx.user.id });
          if (!taken.ok) {
            return ctx.fail("errors.actionFailed", {
              details: `ما يملك الكمية. المتاح: \`${app.rp.amountOf(guildId, user.id, itemKey)}\``
            });
          }
        }

        await svc.log(guildId, "rpInventory", buildEmbed({
          title: sub === "اعطاء" ? "📥 منح عنصر" : "📤 سحب عنصر",
          color: ctx.color(sub === "اعطاء" ? "success" : "warning"),
          fields: [
            { name: "العضو", value: `<@${user.id}>`, inline: true },
            { name: "العنصر", value: `${amount}× ${item.label}`, inline: true },
            { name: "المسؤول", value: `<@${ctx.user.id}>`, inline: true }
          ]
        }));

        return ctx.success(
          `${sub === "اعطاء" ? "تم منح" : "تم سحب"} **${amount}** × ${item.label} ${sub === "اعطاء" ? "إلى" : "من"} <@${user.id}>.\n` +
          `🎒 الرصيد الحالي: \`${app.rp.amountOf(guildId, user.id, itemKey)}\``
        );
      }

      // ---------- الممتلكات ----------
      if (sub === "ممتلك-انشاء") {
        const key = opt("key").trim().toLowerCase();
        if (!validKey(key)) return ctx.fail("errors.actionFailed", { details: "المفتاح: حروف إنجليزية صغيرة وأرقام، 2-32." });
        if (app.rp.getProperty(guildId, key)) return ctx.fail("errors.actionFailed", { details: `المعروض \`${key}\` موجود.` });

        const prop = app.rp.createProperty({
          guildId, key, label: opt("label"),
          kind: opt("kind") || "vehicle",
          price: ctx.interaction.options.getInteger("price"),
          emoji: opt("emoji"), location: opt("location"),
          stock: ctx.interaction.options.getInteger("stock")
        });
        return ctx.success(
          `تم تعريف **${prop.label}** (\`${prop.key}\`)\n` +
          `${prop.kind === "house" ? "🏠 عقار" : "🚗 مركبة"} • السعر: ${svc.money(guildId, prop.price)}` +
          (prop.stock !== null ? ` • المخزون: ${prop.stock}` : " • بلا حد")
        );
      }

      if (sub === "الممتلكات") {
        const props = app.rp.listProperties(guildId);
        if (!props.length) return ctx.fail("errors.actionFailed", { details: "ما فيه معروضات بعد." });
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🔑 المعروضات",
            description: props
              .map((p) => `${p.emoji || (p.kind === "house" ? "🏠" : "🚗")} **${p.label}** \`${p.key}\`\n  ${svc.money(guildId, p.price)}${p.location ? ` • ${p.location}` : ""}${p.stock !== null ? ` • مخزون: ${p.stock}` : ""}`)
              .join("\n"),
            color: ctx.color("primary")
          })]
        }, { ephemeral: true });
      }

      if (sub === "ممتلك-حذف") {
        const key = opt("key").trim();
        if (!app.rp.deleteProperty(guildId, key)) return ctx.fail("errors.actionFailed", { details: "المعروض غير موجود." });
        return ctx.success(`تم حذف \`${key}\` من المعروضات. (ملكيات الأعضاء الحالية تبقى كما هي)`);
      }

      if (sub === "معرض") {
        const kind = opt("kind");
        const channel = ctx.interaction.options.getChannel("channel");
        if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
          return ctx.fail("errors.actionFailed", { details: `لا أملك صلاحية الإرسال في <#${channel.id}>.` });
        }
        const message = await channel.send(svc.propertiesPayload(ctx.guild, kind)).catch(() => null);
        if (!message) return ctx.fail("errors.actionFailed", { details: "تعذّر نشر المعرض." });
        return ctx.success(`تم نشر ${kind === "house" ? "معرض العقارات" : "معرض المركبات"} في <#${channel.id}>.`);
      }

      // ---------- الإعدادات ----------
      const updates = {};
      const enabled = ctx.interaction.options.getBoolean("enabled");
      const jailRole = ctx.interaction.options.getRole("jail-role");
      const jobsImage = opt("jobs-image");
      const marketImage = opt("market-image");
      const wantedOnRobbery = ctx.interaction.options.getBoolean("wanted-on-robbery");

      if (enabled !== null) updates["rp.enabled"] = enabled;
      if (jailRole) {
        if (jailRole.managed || jailRole.position >= me.roles.highest.position) {
          return ctx.fail("errors.actionFailed", { details: `لا أستطيع إدارة <@&${jailRole.id}> — ارفع رتبة البوت فوقها.` });
        }
        updates["rp.jailRoleId"] = jailRole.id;
      }
      for (const [val, key] of [[jobsImage, "rp.jobsImageUrl"], [marketImage, "rp.blackMarketImageUrl"]]) {
        if (val === null) continue;
        const trimmed = val.trim();
        if (trimmed && !/^https:\/\/\S+$/i.test(trimmed)) {
          return ctx.fail("errors.actionFailed", { details: "روابط الصور لازم تبدأ بـ https://" });
        }
        updates[key] = trimmed || null;
      }
      if (wantedOnRobbery !== null) updates["rp.wantedOnRobbery"] = wantedOnRobbery;
      const maxChars = ctx.interaction.options.getInteger("max-characters");
      if (maxChars !== null) updates["rp.maxCharacters"] = maxChars;

      if (!Object.keys(updates).length) {
        return ctx.fail("errors.actionFailed", { details: "حدد خيارًا واحدًا على الأقل." });
      }

      app.guildConfig.setMany(guildId, updates);
      const cfg = svc.config(guildId);
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⚙️ إعدادات المدينة",
          color: ctx.color("success"),
          fields: [
            { name: "النظام", value: cfg.enabled ? "🟢 مفعّل" : "⚪ معطّل", inline: true },
            { name: "رتبة السجن", value: cfg.jailRoleId ? `<@&${cfg.jailRoleId}>` : "—", inline: true },
            { name: "مطلوب بعد السرقة", value: cfg.wantedOnRobbery ? "نعم" : "لا", inline: true }
          ]
        })]
      }, { ephemeral: true });
    }
  }
];
