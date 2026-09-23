const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const crypto = require("crypto");
const { Level } = require("../../../core/permissions/PermissionService");
const { buildEmbed } = require("../../../core/utils/helpers");

/** يمنع إعداد لوحة برتبة لا يستطيع البوت منحها أصلًا. */
function validateRole(ctx, role) {
  if (role.managed) return "هذه الرتبة مُدارة بواسطة تكامل خارجي ولا يمكن منحها.";
  if (role.id === ctx.guild.id) return "لا يمكن استخدام رتبة @everyone.";
  if (role.position >= ctx.guild.members.me.roles.highest.position) return `رتبة البوت أقل من <@&${role.id}>.`;
  if (role.permissions.has(PermissionFlagsBits.Administrator)) return "لا يُسمح بتوزيع رتبة تحمل صلاحية Administrator.";
  const executorLevel = ctx.app.permissions.resolveLevel(ctx.member);
  if (executorLevel < Level.GUILD_OWNER && role.position >= ctx.member.roles.highest.position) {
    return "لا يمكنك توزيع رتبة أعلى من رتبتك.";
  }
  return null;
}

module.exports = [
  {
    name: "رتب_ذاتية",
    aliases: ["selfrole"],
    description: "إنشاء لوحة رتب ذاتية يختار منها الأعضاء رتبهم.",
    usage: "/selfrole create title:<العنوان> role1:<رتبة> ...",
    arguments: [
      { name: "title", required: false, description: "عنوان اللوحة" },
      { name: "style", required: false, description: "menu لقائمة اختيار أو buttons لأزرار" },
      { name: "max", required: false, description: "أقصى عدد رتب يختارها العضو" },
      { name: "role1..role5", required: true, description: "الرتب المتاحة" }
    ],
    examples: ["/selfrole create title:اختر اهتماماتك role1:@ألعاب role2:@برمجة"],
    category: "roles",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageRoles] },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: (() => {
      // ديسكورد يشترط ورود كل الخيارات المطلوبة قبل الاختيارية
      const b = new SlashCommandBuilder()
        .setName("رتب_ذاتية")
        .setDescription("إنشاء لوحة رتب ذاتية")
        .addRoleOption((o) => o.setName("role1").setDescription("الرتبة رقم 1").setRequired(true));
      for (let i = 2; i <= 5; i++) {
        b.addRoleOption((o) => o.setName(`role${i}`).setDescription(`الرتبة رقم ${i}`));
      }
      return b
        .addStringOption((o) => o.setName("title").setDescription("عنوان اللوحة"))
        .addStringOption((o) =>
          o.setName("style").setDescription("شكل اللوحة")
            .addChoices({ name: "قائمة اختيار", value: "menu" }, { name: "أزرار", value: "buttons" })
        )
        .addIntegerOption((o) => o.setName("max").setDescription("أقصى عدد رتب").setMinValue(1).setMaxValue(5))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles);
    })(),

    async execute(ctx) {
      const roles = [];
      for (let i = 1; i <= 5; i++) {
        const role = ctx.interaction.options.getRole(`role${i}`);
        if (!role) continue;
        const problem = validateRole(ctx, role);
        if (problem) return ctx.fail("errors.actionFailed", { details: problem });
        roles.push({ id: role.id, name: role.name });
      }
      if (!roles.length) return ctx.fail("errors.roleNotFound");

      const panelId = crypto.randomBytes(6).toString("hex");
      const style = ctx.getString("style") || "menu";
      const max = Math.min(ctx.getNumber("max") || roles.length, roles.length);
      const title = ctx.getString("title") || "🎭 الرتب الذاتية";

      const config = { title, style, max, roles };

      const embed = buildEmbed({
        title,
        description:
          style === "menu"
            ? `اختر رتبك من القائمة أدناه. اختيار رتبة موجودة لديك يزيلها.\nالحد الأقصى: \`${max}\``
            : "اضغط على الزر للحصول على الرتبة، واضغط مرة أخرى لإزالتها.",
        color: ctx.color("primary"),
        footer: ctx.guild.name,
        timestamp: false
      });

      const components = [];
      if (style === "menu") {
        components.push(
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(`selfrole:menu:${panelId}`)
              .setPlaceholder("اختر رتبك")
              .setMinValues(0)
              .setMaxValues(max)
              .addOptions(roles.map((r) => ({ label: r.name.slice(0, 100), value: r.id })))
          )
        );
      } else {
        const buttons = roles.map((r) =>
          new ButtonBuilder().setCustomId(`selfrole:btn:${panelId}:${r.id}`).setLabel(r.name.slice(0, 80)).setStyle(ButtonStyle.Secondary)
        );
        for (let i = 0; i < buttons.length; i += 5) {
          components.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
        }
      }

      const message = await ctx.channel.send({ embeds: [embed], components });
      ctx.app.selfRoles.save({ id: panelId, guildId: ctx.guild.id, channelId: ctx.channel.id, messageId: message.id, config });

      return ctx.reply({ content: `${ctx.emoji("success")} تم إنشاء لوحة الرتب الذاتية. المعرّف: \`${panelId}\`` }, { ephemeral: true });
    }
  },

  {
    name: "رتبة_تلقائية",
    aliases: ["autorole"],
    description: "ضبط الرتب التي تُعطى تلقائيًا للأعضاء الجدد.",
    usage: "/autorole set role:<رتبة> target:<member|bot>",
    arguments: [
      { name: "set", required: false, description: "إضافة رتبة تلقائية" },
      { name: "clear", required: false, description: "حذف كل الرتب التلقائية" },
      { name: "list", required: false, description: "عرض الرتب التلقائية الحالية" }
    ],
    examples: ["/autorole set role:@عضو target:member"],
    category: "roles",
    slashOnly: true,
    permissions: { level: Level.ADMIN, discordPermissions: [PermissionFlagsBits.ManageRoles] },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: new SlashCommandBuilder()
      .setName("رتبة_تلقائية")
      .setDescription("الرتب التلقائية للأعضاء الجدد")
      .addSubcommand((s) =>
        s.setName("set").setDescription("إضافة رتبة تلقائية")
          .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
          .addStringOption((o) =>
            o.setName("target").setDescription("لمن تُعطى").addChoices({ name: "الأعضاء", value: "member" }, { name: "البوتات", value: "bot" })
          )
      )
      .addSubcommand((s) => s.setName("clear").setDescription("حذف كل الرتب التلقائية"))
      .addSubcommand((s) => s.setName("list").setDescription("عرض الرتب التلقائية"))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(ctx) {
      const sub = ctx.interaction.options.getSubcommand();
      const cfg = ctx.app.guildConfig.get(ctx.guild.id);

      if (sub === "set") {
        const role = ctx.interaction.options.getRole("role");
        const target = ctx.interaction.options.getString("target") || "member";
        const problem = validateRole(ctx, role);
        if (problem) return ctx.fail("errors.actionFailed", { details: problem });

        const key = target === "bot" ? "autoRoles.botRoleIds" : "autoRoles.memberRoleIds";
        const list = new Set(ctx.app.guildConfig.value(ctx.guild.id, key) || []);
        list.add(role.id);
        ctx.app.guildConfig.setMany(ctx.guild.id, { [key]: [...list], "autoRoles.enabled": true });

        return ctx.success(`سيتم إعطاء <@&${role.id}> تلقائيًا لكل ${target === "bot" ? "بوت" : "عضو"} جديد.`);
      }

      if (sub === "clear") {
        ctx.app.guildConfig.setMany(ctx.guild.id, {
          "autoRoles.memberRoleIds": [],
          "autoRoles.botRoleIds": [],
          "autoRoles.enabled": false
        });
        return ctx.success("تم حذف كل الرتب التلقائية.");
      }

      const members = (cfg.autoRoles.memberRoleIds || []).map((id) => `<@&${id}>`).join(" ") || "—";
      const bots = (cfg.autoRoles.botRoleIds || []).map((id) => `<@&${id}>`).join(" ") || "—";
      return ctx.reply({
        embeds: [
          buildEmbed({
            title: "🏷️ الرتب التلقائية",
            color: ctx.color("primary"),
            fields: [
              { name: "الحالة", value: cfg.autoRoles.enabled ? ctx.t("common.enabled") : ctx.t("common.disabled") },
              { name: "للأعضاء", value: members },
              { name: "للبوتات", value: bots }
            ]
          })
        ]
      });
    }
  }
];
