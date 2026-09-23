const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { parseDuration } = require("../../../core/utils/helpers");

const SYSTEM = "flights.enabled";
const CODE_PATTERN = /^[A-Za-z0-9\u0600-\u06FF-]{2,16}$/;

module.exports = [
  {
    name: "رحلة",
    aliases: ["flight", "طيران"],
    description: "إدارة الرحلات وحجز التذاكر.",
    usage: "/flight create code:<الرمز> destination:<الوجهة> price:<السعر> seats:<المقاعد>",
    arguments: [
      { name: "create", required: false, description: "إنشاء رحلة جديدة (للإدارة)" },
      { name: "list", required: false, description: "عرض الرحلات المفتوحة" },
      { name: "book", required: false, description: "حجز تذكرة ويُخصم الثمن من رصيدك" },
      { name: "cancel", required: false, description: "إلغاء حجزك مع استرجاع المبلغ" },
      { name: "passengers", required: false, description: "قائمة ركاب رحلة (للإدارة)" },
      { name: "close", required: false, description: "إغلاق الحجز على رحلة (للإدارة)" }
    ],
    examples: [
      "/flight create code:MT-101 destination:بلدة ميستري price:450 seats:30",
      "/flight book code:MT-101",
      "/flight passengers code:MT-101"
    ],
    category: "flights",
    slashOnly: true,
    systemFlag: SYSTEM,
    permissions: { level: Level.EVERYONE },
    slash: new SlashCommandBuilder()
      .setName("رحلة")
      .setDescription("نظام الرحلات والحجز")
      .addSubcommand((s) =>
        s.setName("create").setDescription("إنشاء رحلة")
          .addStringOption((o) => o.setName("code").setDescription("رمز الرحلة مثل MT-101").setRequired(true).setMaxLength(16))
          .addStringOption((o) => o.setName("destination").setDescription("الوجهة").setRequired(true).setMaxLength(100))
          .addIntegerOption((o) => o.setName("price").setDescription("سعر التذكرة").setRequired(true).setMinValue(0))
          .addIntegerOption((o) => o.setName("seats").setDescription("عدد المقاعد").setRequired(true).setMinValue(1).setMaxValue(500))
          .addUserOption((o) => o.setName("captain").setDescription("كابتن الطائرة"))
          .addStringOption((o) => o.setName("departure").setDescription("الإقلاع بعد كم؟ مثل 2h أو 30m"))
      )
      .addSubcommand((s) => s.setName("list").setDescription("الرحلات المتاحة"))
      .addSubcommand((s) =>
        s.setName("book").setDescription("حجز تذكرة")
          .addStringOption((o) => o.setName("code").setDescription("رمز الرحلة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("cancel").setDescription("إلغاء حجزك")
          .addStringOption((o) => o.setName("code").setDescription("رمز الرحلة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("passengers").setDescription("قائمة الركاب")
          .addStringOption((o) => o.setName("code").setDescription("رمز الرحلة").setRequired(true))
      )
      .addSubcommand((s) =>
        s.setName("close").setDescription("إغلاق الحجز على رحلة")
          .addStringOption((o) => o.setName("code").setDescription("رمز الرحلة").setRequired(true))
          .addStringOption((o) =>
            o.setName("status").setDescription("الحالة الجديدة")
              .addChoices(
                { name: "مغلقة للحجز", value: "closed" },
                { name: "أقلعت", value: "departed" },
                { name: "ملغاة", value: "cancelled" }
              )
          )
      ),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const svc = ctx.app.flightService;
      const guild = ctx.guild;
      const level = ctx.app.permissions.resolveLevel(ctx.member);

      if (sub === "list") {
        return ctx.reply({ embeds: [svc.listEmbed(guild, ctx.app.flights.listOpen(guild.id))] });
      }

      if (sub === "create") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");

        const code = ctx.interaction.options.getString("code").trim().toUpperCase();
        if (!CODE_PATTERN.test(code)) {
          return ctx.fail("errors.actionFailed", { details: "رمز الرحلة من 2 إلى 16 حرفًا، بدون مسافات." });
        }
        if (ctx.app.flights.getByCode(guild.id, code)) {
          return ctx.fail("errors.actionFailed", { details: `فيه رحلة بنفس الرمز \`${code}\`.` });
        }

        const departureRaw = ctx.interaction.options.getString("departure");
        let departureAt = null;
        if (departureRaw) {
          const ms = parseDuration(departureRaw);
          if (!ms) return ctx.fail("errors.invalidDuration");
          departureAt = Date.now() + ms;
        }

        const flight = ctx.app.flights.create({
          guildId: guild.id,
          code,
          destination: ctx.interaction.options.getString("destination"),
          price: ctx.interaction.options.getInteger("price"),
          seats: ctx.interaction.options.getInteger("seats"),
          captainId: ctx.interaction.options.getUser("captain")?.id || null,
          departureAt,
          createdBy: ctx.user.id
        });

        return ctx.reply({
          content: `${ctx.emoji("success")} تم إنشاء الرحلة. الأعضاء يحجزون بـ \`/flight book code:${code}\` أو بزر في لوحة الحجز.`,
          embeds: [svc.flightEmbed(guild, flight)]
        });
      }

      const code = ctx.interaction.options.getString("code").trim().toUpperCase();
      const flight = ctx.app.flights.getByCode(guild.id, code);
      if (!flight) return ctx.fail("errors.actionFailed", { details: `ما لقيت رحلة برمز \`${code}\`.` });

      if (sub === "passengers") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        return ctx.reply({
          embeds: [svc.passengersEmbed(guild, flight, ctx.app.flights.passengers(flight.id))]
        }, { ephemeral: true });
      }

      if (sub === "close") {
        if (level < Level.STAFF) return ctx.fail("errors.noPermission");
        const status = ctx.interaction.options.getString("status") || "closed";
        if (!ctx.app.flights.close(flight.id, status)) {
          return ctx.fail("errors.actionFailed", { details: "الرحلة مغلقة أصلًا." });
        }
        return ctx.success(`تم تحديث حالة الرحلة \`${code}\`. عدد الركاب: \`${flight.seats_taken}\``);
      }

      if (sub === "book") {
        const result = await svc.book({ guild, member: ctx.member, flight });
        if (!result.ok) {
          const messages = {
            closed: "الحجز مغلق على هذي الرحلة.",
            full: "ما فيه مقاعد متاحة.",
            already: "أنت حاجز في هذي الرحلة من قبل.",
            insufficient: result.needed
              ? `رصيدك ما يكفي. سعر التذكرة ${ctx.app.economyService.format(guild.id, result.needed)} والمتاح ${ctx.app.economyService.format(guild.id, ctx.app.economyService.total(result.account))}`
              : "رصيدك غير كافٍ."
          };
          return ctx.fail("errors.actionFailed", { details: messages[result.reason] || "فشل الحجز." });
        }
        return ctx.success(
          `تم حجز مقعدك في رحلة \`${code}\` إلى **${flight.destination}**\n` +
          `🎫 رقم المقعد: **#${result.seatNo}**` +
          (flight.price ? `\n💸 خُصم: ${ctx.app.economyService.format(guild.id, flight.price)}` : "")
        );
      }

      // cancel
      const result = await svc.cancelBooking({ guild, member: ctx.member, flight });
      if (!result.ok) {
        return ctx.fail("errors.actionFailed", { details: "ما عندك حجز في هذي الرحلة." });
      }
      return ctx.success(
        `تم إلغاء حجزك في رحلة \`${code}\`` +
        (result.refunded ? `\n💰 استُرجع: ${ctx.app.economyService.format(guild.id, result.refunded)}` : "")
      );
    }
  }
];
