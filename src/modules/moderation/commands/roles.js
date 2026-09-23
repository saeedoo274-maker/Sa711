const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { Events } = require("../../../core/events/EventBus");

module.exports = [
  {
    name: "رتبة",
    aliases: ["role", "رتبه"],
    description: "إضافة أو إزالة رتبة من عضو.",
    usage: "role <add|remove> <@عضو> <@رتبة>",
    arguments: [
      { name: "العملية", required: true, description: "add للإضافة أو remove للإزالة" },
      { name: "عضو", required: true, description: "العضو المستهدف" },
      { name: "رتبة", required: true, description: "الرتبة المراد تعديلها" }
    ],
    examples: ["role add @أحمد @VIP", "role remove @أحمد @VIP"],
    category: "moderation",
    systemFlag: "moderation.enabled",
    permissions: { level: Level.MODERATOR, discordPermissions: [PermissionFlagsBits.ManageRoles] },
    botPermissions: [PermissionFlagsBits.ManageRoles],
    slash: new SlashCommandBuilder()
      .setName("رتبة")
      .setDescription("إضافة أو إزالة رتبة من عضو")
      .addStringOption((o) =>
        o.setName("action").setDescription("العملية").setRequired(true)
          .addChoices({ name: "إضافة", value: "add" }, { name: "إزالة", value: "remove" })
      )
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addRoleOption((o) => o.setName("role").setDescription("الرتبة").setRequired(true))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

    async execute(ctx) {
      const action = (ctx.isSlash ? ctx.getString("action") : ctx.args[0] || "").toLowerCase();
      if (!["add", "remove", "اضافة", "ازالة"].includes(action)) {
        return ctx.fail("errors.actionFailed", { details: "استخدم add أو remove" });
      }
      const isAdd = action === "add" || action === "اضافة";

      const member = await ctx.getMember("user", 1);
      if (!member) return ctx.fail("errors.memberNotFound");
      const role = await ctx.getRole("role", 2);
      if (!role) return ctx.fail("errors.roleNotFound");

      // لا يُسمح بمنح رتبة أعلى من رتبة المنفّذ نفسه (منع تصعيد الصلاحيات)
      const executorLevel = ctx.app.permissions.resolveLevel(ctx.member);
      if (executorLevel < Level.GUILD_OWNER && role.position >= ctx.member.roles.highest.position) {
        return ctx.fail("errors.hierarchy");
      }
      // ولا برتبة أعلى من رتبة البوت
      if (role.position >= ctx.guild.members.me.roles.highest.position) {
        return ctx.fail("errors.actionFailed", { details: ctx.t("moderation.role.botCannotManage") });
      }
      const allowed = ctx.app.permissions.canActOn(ctx.member, member);
      if (!allowed.ok) return ctx.fail(`errors.${allowed.reason}`);

      if (isAdd) {
        if (member.roles.cache.has(role.id)) return ctx.fail("errors.actionFailed", { details: "العضو يملك هذه الرتبة بالفعل" });
        await member.roles.add(role, `${ctx.user.tag}`);
      } else {
        if (!member.roles.cache.has(role.id)) return ctx.fail("errors.actionFailed", { details: "العضو لا يملك هذه الرتبة" });
        await member.roles.remove(role, `${ctx.user.tag}`);
      }

      ctx.app.bus.emitSafe(isAdd ? Events.ROLE_ADDED : Events.ROLE_REMOVED, {
        guild: ctx.guild, executor: ctx.member, target: member, role
      });

      return ctx.success(
        ctx.t(isAdd ? "moderation.role.added" : "moderation.role.removed", {
          role: `<@&${role.id}>`, target: `<@${member.id}>`
        })
      );
    }
  },

  {
    name: "اسم_مستعار",
    aliases: ["nickname", "اسم", "nick"],
    description: "تغيير اسم عضو داخل السيرفر، أو إعادته للأصلي.",
    usage: "nickname <@عضو> [الاسم الجديد]",
    arguments: [
      { name: "عضو", required: true, description: "العضو المستهدف" },
      { name: "الاسم", required: false, description: "اتركه فارغًا لإعادة الاسم الأصلي" }
    ],
    examples: ["nickname @أحمد أبو محمد", "nickname @أحمد"],
    category: "moderation",
    systemFlag: "moderation.enabled",
    permissions: { level: Level.STAFF, discordPermissions: [PermissionFlagsBits.ManageNicknames] },
    botPermissions: [PermissionFlagsBits.ManageNicknames],
    slash: new SlashCommandBuilder()
      .setName("اسم_مستعار")
      .setDescription("تغيير اسم عضو")
      .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("الاسم الجديد (فارغ = إعادة تعيين)").setMaxLength(32))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const allowed = ctx.app.permissions.canActOn(ctx.member, member, { allowSelf: true });
      if (!allowed.ok) return ctx.fail(`errors.${allowed.reason}`);

      const nickname = ctx.getString("name", 1, true);
      await member.setNickname(nickname || null, ctx.user.tag);

      ctx.app.bus.emitSafe(Events.NICKNAME_CHANGED, {
        guild: ctx.guild, executor: ctx.member, target: member,
        details: nickname ? `الاسم الجديد: ${nickname}` : "إعادة تعيين الاسم"
      });

      return ctx.success(
        nickname
          ? ctx.t("moderation.nickname.success", { target: `<@${member.id}>`, nickname })
          : ctx.t("moderation.nickname.reset", { target: `<@${member.id}>` })
      );
    }
  }
];
