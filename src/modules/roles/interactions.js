const { PermissionFlagsBits } = require("discord.js");
const { Events } = require("../../core/events/EventBus");
const { safeUpdate, safeReply, safeModal, ackComponent } = require("../../core/interactions/interactionSafe");

/**
 * توزيع الرتب الذاتية.
 * الرتب المسموح بها تُقرأ من إعدادات اللوحة المخزّنة، لا مما يرسله العميل،
 * فلا يمكن لأحد تزوير التفاعل للحصول على رتبة غير مدرجة في اللوحة.
 */
module.exports = {
  prefix: "selfrole",

  async handle(interaction, app) {
    const [, kind, panelId, roleArg] = interaction.customId.split(":");
    const panel = app.selfRoles.get(panelId);

    if (!panel || panel.guild_id !== interaction.guild.id) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذه اللوحة لم تعد موجودة.`, flags: 64 });
    }

    const allowedIds = new Set(panel.config.roles.map((r) => r.id));
    const me = interaction.guild.members.me;
    const member = interaction.member;

    const requested = kind === "menu" ? interaction.values : [roleArg];
    const valid = requested.filter((id) => allowedIds.has(id));
    if (kind === "btn" && valid.length === 0) {
      return safeReply(interaction, { content: `${app.config.emoji("error")} هذه الرتبة غير متاحة في هذه اللوحة.`, flags: 64 });
    }

    const added = [];
    const removed = [];
    const skipped = [];

    if (kind === "menu") {
      // القائمة: ما اختاره العضو يُضاف، وما ألغاه من رتب اللوحة يُزال
      for (const roleId of allowedIds) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;
        if (role.position >= me.roles.highest.position || role.managed) {
          skipped.push(roleId);
          continue;
        }
        const shouldHave = valid.includes(roleId);
        const has = member.roles.cache.has(roleId);
        if (shouldHave && !has) {
          await member.roles.add(role, "رتب ذاتية").catch(() => skipped.push(roleId));
          added.push(roleId);
        } else if (!shouldHave && has) {
          await member.roles.remove(role, "رتب ذاتية").catch(() => skipped.push(roleId));
          removed.push(roleId);
        }
      }
    } else {
      const roleId = valid[0];
      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) return safeReply(interaction, { content: `${app.config.emoji("error")} الرتبة لم تعد موجودة.`, flags: 64 });
      if (role.position >= me.roles.highest.position || role.managed) {
        return safeReply(interaction, { content: `${app.config.emoji("error")} لا أستطيع إدارة هذه الرتبة.`, flags: 64 });
      }
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role, "رتب ذاتية").catch(() => {});
        removed.push(roleId);
      } else {
        // احترام الحد الأقصى المعرّف في اللوحة
        const owned = panel.config.roles.filter((r) => member.roles.cache.has(r.id)).length;
        if (panel.config.max && owned >= panel.config.max) {
          return safeReply(interaction, {
            content: `${app.config.emoji("warning")} وصلت للحد الأقصى (${panel.config.max} رتبة). أزل رتبة قبل إضافة أخرى.`,
            flags: 64
          });
        }
        await member.roles.add(role, "رتب ذاتية").catch(() => {});
        added.push(roleId);
      }
    }

    for (const id of added) {
      app.bus.emitSafe(Events.ROLE_ADDED, {
        guild: interaction.guild, executor: member, target: member,
        role: { id }, details: "رتب ذاتية"
      });
    }
    for (const id of removed) {
      app.bus.emitSafe(Events.ROLE_REMOVED, {
        guild: interaction.guild, executor: member, target: member,
        role: { id }, details: "رتب ذاتية"
      });
    }

    const parts = [];
    if (added.length) parts.push(`✅ أُضيفت: ${added.map((id) => `<@&${id}>`).join(" ")}`);
    if (removed.length) parts.push(`➖ أُزيلت: ${removed.map((id) => `<@&${id}>`).join(" ")}`);
    if (skipped.length) parts.push(`⚠️ تعذّر تعديل: ${skipped.map((id) => `<@&${id}>`).join(" ")}`);
    if (!parts.length) parts.push("لم يتغيّر شيء.");

    return safeReply(interaction, { content: parts.join("\n"), flags: 64 });
  }
};
