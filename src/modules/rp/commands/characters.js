const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed, timestamp, truncate } = require("../../../core/utils/helpers");

const SYSTEM = "rp.enabled";

/** الشخصيات المتعددة، الممتلكات، الاعتقال (الكلبشة)، والتفتيش. */
module.exports = [
  {
    name: "شخصية",
    aliases: ["character", "char"],
    description: "الشخصيات المتعددة: لكل شخصية ممتلكاتها المستقلة.",
    usage: "/شخصية قائمة",
    arguments: [
      { name: "قائمة", required: false, description: "عرض شخصياتك" },
      { name: "انشاء", required: false, description: "إنشاء شخصية جديدة" },
      { name: "تبديل", required: false, description: "التبديل بين شخصياتك" },
      { name: "تسمية", required: false, description: "تسمية شخصية" }
    ],
    examples: ["/شخصية قائمة", "/شخصية انشاء name:خالد", "/شخصية تبديل slot:2"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("شخصية")
      .setDescription("الشخصيات المتعددة")
      .addSubcommand((s) => s.setName("قائمة").setDescription("عرض شخصياتك"))
      .addSubcommand((s) =>
        s.setName("انشاء").setDescription("إنشاء شخصية جديدة")
          .addStringOption((o) => o.setName("name").setDescription("اسم الشخصية").setMaxLength(60))
      )
      .addSubcommand((s) =>
        s.setName("تبديل").setDescription("التبديل لشخصية أخرى")
          .addIntegerOption((o) => o.setName("slot").setDescription("رقم الشخصية").setRequired(true).setMinValue(1).setMaxValue(5))
      )
      .addSubcommand((s) =>
        s.setName("تسمية").setDescription("تسمية شخصية")
          .addIntegerOption((o) => o.setName("slot").setDescription("رقم الشخصية").setRequired(true).setMinValue(1).setMaxValue(5))
          .addStringOption((o) => o.setName("name").setDescription("الاسم").setRequired(true).setMaxLength(60))
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const guildId = ctx.guild.id;
      const app = ctx.app;
      const maxSlots = app.rpService.config(guildId).maxCharacters || 2;

      app.rp.ensureCharacter(guildId, ctx.user.id);

      if (sub === "قائمة") {
        const chars = app.rp.listCharacters(guildId, ctx.user.id);
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🎭 شخصياتك",
            description: chars
              .map((c) => {
                const owned = app.rp.ownedBy(guildId, ctx.user.id, c.slot).length;
                return `${c.active ? "🟢" : "⚪"} **الشخصية ${c.slot}**${c.name ? ` — ${c.name}` : ""}\n  ممتلكات: \`${owned}\``;
              })
              .join("\n\n"),
            color: ctx.color("primary"),
            footer: `الحد الأقصى: ${maxSlots} شخصية`
          })]
        }, { ephemeral: true });
      }

      if (sub === "انشاء") {
        const chars = app.rp.listCharacters(guildId, ctx.user.id);
        if (chars.length >= maxSlots) {
          return ctx.fail("errors.actionFailed", { details: `وصلت الحد الأقصى (${maxSlots} شخصيات).` });
        }
        // نأخذ أصغر رقم شاغر بدل الاعتماد على العدد، فلا يتكرر رقم بعد حذف
        const used = new Set(chars.map((c) => c.slot));
        let slot = 1;
        while (used.has(slot)) slot++;

        const created = app.rp.createCharacter(guildId, ctx.user.id, slot, ctx.interaction.options.getString("name"));
        return ctx.success(
          `تم إنشاء **الشخصية ${created.slot}**${created.name ? ` — ${created.name}` : ""}.\n` +
          `بدّل لها بـ \`/شخصية تبديل slot:${created.slot}\``
        );
      }

      if (sub === "تسمية") {
        const slot = ctx.interaction.options.getInteger("slot");
        const updated = app.rp.renameCharacter(guildId, ctx.user.id, slot, ctx.interaction.options.getString("name"));
        if (!updated) return ctx.fail("errors.actionFailed", { details: `ما عندك شخصية برقم ${slot}.` });
        return ctx.success(`تم تسمية الشخصية ${slot}: **${updated.name}**`);
      }

      const slot = ctx.interaction.options.getInteger("slot");
      const blocked = app.rpService.restrictionOf(guildId, ctx.user.id);
      if (blocked) return ctx.fail("errors.actionFailed", { details: `${blocked} لا يمكنك تبديل الشخصية الآن.` });

      const switched = app.rp.switchCharacter(guildId, ctx.user.id, slot);
      if (!switched) return ctx.fail("errors.actionFailed", { details: `ما عندك شخصية برقم ${slot}.` });

      return ctx.success(
        `أنت الآن **الشخصية ${switched.slot}**${switched.name ? ` — ${switched.name}` : ""}.\n` +
        "ممتلكاتك وأعمالك تُنسب لهذه الشخصية."
      );
    }
  },

  {
    name: "ممتلكاتي",
    aliases: ["myproperties", "املاكي"],
    description: "عرض مركباتك وعقاراتك للشخصية النشطة.",
    usage: "/ممتلكاتي",
    arguments: [{ name: "user", required: false, description: "ممتلكات عضو آخر (للطاقم)" }],
    examples: ["/ممتلكاتي"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("ممتلكاتي")
      .setDescription("مركباتك وعقاراتك")
      .addUserOption((o) => o.setName("user").setDescription("عضو آخر (للطاقم)")),

    async execute(ctx) {
      const target = ctx.interaction.options.getUser("user");
      if (target && target.id !== ctx.user.id && ctx.app.permissions.resolveLevel(ctx.member) < Level.STAFF) {
        return ctx.fail("errors.noPermission");
      }
      const user = target || ctx.user;
      ctx.app.rp.ensureCharacter(ctx.guild.id, user.id);
      const slot = ctx.app.rp.activeSlot(ctx.guild.id, user.id);
      const rows = ctx.app.rp.ownedBy(ctx.guild.id, user.id, slot);
      return ctx.reply({ embeds: [ctx.app.rpService.ownedEmbed(ctx.guild, user, rows, slot)] }, { ephemeral: true });
    }
  },

  {
    name: "كلبشة",
    aliases: ["cuff", "اعتقال"],
    description: "كلبشة عضو لتجميد تصرّفاته مؤقتًا (أخف من السجن، بلا سحب رتب).",
    usage: "/كلبشة user:@عضو reason:السبب",
    arguments: [
      { name: "user", required: true, description: "العضو" },
      { name: "reason", required: false, description: "السبب" }
    ],
    examples: ["/كلبشة user:@أحمد reason:مقاومة"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("كلبشة")
      .setDescription("كلبشة عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("السبب").setMaxLength(300))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const user = ctx.interaction.options.getUser("user");
      if (user.bot) return ctx.fail("errors.actionFailed", { details: "ما تقدر تكلبش بوتًا." });

      const member = await ctx.guild.members.fetch(user.id).catch(() => null);
      if (!member) return ctx.fail("errors.memberNotFound");

      const check = ctx.app.permissions.canActOn(ctx.member, member);
      if (!check.ok) return ctx.fail("errors.actionFailed", { details: "ما تقدر تكلبش عضوًا بمستواك أو أعلى." });

      const record = ctx.app.rp.cuff({
        guildId: ctx.guild.id, userId: user.id, officerId: ctx.user.id,
        reason: ctx.interaction.options.getString("reason")
      });
      if (!record) return ctx.fail("errors.actionFailed", { details: `<@${user.id}> مكلبش بالفعل.` });

      await ctx.app.rpService.log(ctx.guild.id, "rpJail", buildEmbed({
        title: "⛓️ كلبشة",
        color: ctx.color("warning"),
        fields: [
          { name: "العضو", value: `<@${user.id}>`, inline: true },
          { name: "الضابط", value: `<@${ctx.user.id}>`, inline: true },
          ...(record.reason ? [{ name: "السبب", value: truncate(record.reason, 300) }] : [])
        ]
      }));

      await user.send({
        content: `⛓️ تم كلبشتك في **${ctx.guild.name}**.${record.reason ? `\nالسبب: ${record.reason}` : ""}\nلا يمكنك التصرّف حتى يفكّك أحد رجال الأمن.`
      }).catch(() => {});

      return ctx.success(`تمت كلبشة <@${user.id}>. تصرّفاته مجمّدة حتى فكّ الكلبشة.`);
    }
  },

  {
    name: "فك_كلبشة",
    aliases: ["uncuff"],
    description: "فك كلبشة عضو أو كل المكلبشين.",
    usage: "/فك_كلبشة user:@عضو",
    arguments: [
      { name: "user", required: false, description: "العضو" },
      { name: "all", required: false, description: "فك كل المكلبشين" }
    ],
    examples: ["/فك_كلبشة user:@أحمد", "/فك_كلبشة all:True"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("فك_كلبشة")
      .setDescription("فك كلبشة")
      .addUserOption((o) => o.setName("user").setDescription("العضو"))
      .addBooleanOption((o) => o.setName("all").setDescription("فك كل المكلبشين"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async execute(ctx) {
      const all = ctx.interaction.options.getBoolean("all");
      const user = ctx.interaction.options.getUser("user");

      if (all) {
        if (ctx.app.permissions.resolveLevel(ctx.member) < Level.ADMIN) return ctx.fail("errors.noPermission");
        const count = ctx.app.rp.uncuffAll(ctx.guild.id, ctx.user.id);
        if (!count) return ctx.success("ما فيه مكلبشون أصلًا.");
        return ctx.success(`تم فك \`${count}\` كلبشة.`);
      }

      if (!user) return ctx.fail("errors.actionFailed", { details: "حدد عضوًا أو استخدم `all:True`." });
      if (!ctx.app.rp.uncuff(ctx.guild.id, user.id, ctx.user.id)) {
        return ctx.fail("errors.actionFailed", { details: `<@${user.id}> غير مكلبش.` });
      }

      await user.send({ content: `🔓 تم فك كلبشتك في **${ctx.guild.name}**.` }).catch(() => {});
      return ctx.success(`تم فك كلبشة <@${user.id}>.`);
    }
  },

  {
    name: "المكلبشين",
    aliases: ["cuffed"],
    description: "قائمة المكلبشين حاليًا.",
    usage: "/المكلبشين",
    arguments: [],
    examples: ["/المكلبشين"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder().setName("المكلبشين").setDescription("قائمة المكلبشين"),

    async execute(ctx) {
      const rows = ctx.app.rp.listCuffed(ctx.guild.id);
      if (!rows.length) return ctx.success("ما فيه مكلبشون حاليًا.");
      return ctx.reply({
        embeds: [buildEmbed({
          title: "⛓️ المكلبشون",
          description: rows
            .map((r) => `<@${r.user_id}> — بواسطة <@${r.officer_id}> ${timestamp(r.created_at, "R")}${r.reason ? `\n  ${truncate(r.reason, 80)}` : ""}`)
            .join("\n"),
          color: ctx.color("warning"),
          footer: `الإجمالي: ${rows.length}`
        })]
      }, { ephemeral: true });
    }
  },

  {
    name: "تفتيش",
    aliases: ["search"],
    description: "كشف حقيبة عضو، ومصادرة عنصر منها عند الحاجة.",
    usage: "/تفتيش user:@عضو",
    arguments: [
      { name: "user", required: true, description: "العضو" },
      { name: "seize", required: false, description: "عنصر لمصادرته" },
      { name: "amount", required: false, description: "الكمية المصادرة" }
    ],
    examples: ["/تفتيش user:@أحمد", "/تفتيش user:@أحمد seize:lockpick amount:1"],
    category: "rp",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder()
      .setName("تفتيش")
      .setDescription("كشف حقيبة عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("seize").setDescription("عنصر لمصادرته").setAutocomplete(true))
      .addIntegerOption((o) => o.setName("amount").setDescription("الكمية").setMinValue(1))
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

    async autocomplete(interaction, app) {
      const focused = String(interaction.options.getFocused() || "").toLowerCase();
      const target = interaction.options.getUser("user");
      // نقترح ما يملكه الهدف فعلًا لا كل الكتالوج
      const rows = target
        ? app.rp.inventory(interaction.guild.id, target.id)
        : app.rp.listItems(interaction.guild.id).map((i) => ({ item_key: i.key, label: i.label, amount: "?" }));
      return interaction.respond(
        rows
          .filter((r) => r.item_key.toLowerCase().includes(focused) || (r.label || "").toLowerCase().includes(focused))
          .slice(0, 25)
          .map((r) => ({ name: `${r.label || r.item_key} (${r.amount})`, value: r.item_key }))
      );
    },

    async execute(ctx) {
      const user = ctx.interaction.options.getUser("user");
      const guildId = ctx.guild.id;
      const app = ctx.app;

      const rows = app.rp.inventory(guildId, user.id);
      const seizeKey = ctx.interaction.options.getString("seize");

      if (!seizeKey) {
        return ctx.reply({
          embeds: [buildEmbed({
            title: "🔍 نتيجة التفتيش",
            description: rows.length
              ? `<@${user.id}> يحمل:\n\n` + rows.map((r) => `${r.emoji || "•"} **${r.label || r.item_key}** — \`${r.amount}\`${r.illegal ? " ☠️" : ""}`).join("\n")
              : `<@${user.id}> لا يحمل شيئًا.`,
            color: ctx.color(rows.some((r) => r.illegal) ? "danger" : "primary"),
            footer: rows.some((r) => r.illegal) ? "☠️ يحمل مواد ممنوعة" : undefined
          })]
        }, { ephemeral: true });
      }

      const item = app.rp.getItem(guildId, seizeKey);
      if (!item) return ctx.fail("errors.actionFailed", { details: `العنصر \`${seizeKey}\` غير معرّف.` });

      const amount = ctx.interaction.options.getInteger("amount") || app.rp.amountOf(guildId, user.id, seizeKey);
      if (amount < 1) return ctx.fail("errors.actionFailed", { details: `<@${user.id}> لا يملك **${item.label}**.` });

      const taken = app.rp.take({
        guildId, userId: user.id, itemKey: seizeKey, amount,
        reason: "مصادرة", actorId: ctx.user.id
      });
      if (!taken.ok) {
        return ctx.fail("errors.actionFailed", {
          details: `لا يملك الكمية. المتاح: \`${app.rp.amountOf(guildId, user.id, seizeKey)}\``
        });
      }

      app.rp.logSeizure({
        guildId, userId: user.id, officerId: ctx.user.id,
        itemKey: seizeKey, amount, reason: "تفتيش"
      });

      await app.rpService.log(guildId, "rpInventory", buildEmbed({
        title: "🔒 مصادرة",
        color: ctx.color("danger"),
        fields: [
          { name: "العضو", value: `<@${user.id}>`, inline: true },
          { name: "المصادَر", value: `${amount}× ${item.label}`, inline: true },
          { name: "الضابط", value: `<@${ctx.user.id}>`, inline: true }
        ]
      }));

      return ctx.success(`تمت مصادرة **${amount}** × ${item.label} من <@${user.id}>.\nالمتبقي لديه: \`${taken.amount}\``);
    }
  }
];
