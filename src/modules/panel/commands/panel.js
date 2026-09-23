const { SlashCommandBuilder } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const panel = require("../interactions");

module.exports = [
  {
    name: "لوحة",
    aliases: ["panel", "لوحه", "devpanel"],
    description: "لوحة التحكم المركزية: تجمع كل أنظمة البوت الإدارية بدل أوامر منفصلة لكل نظام.",
    usage: "لوحة",
    arguments: [],
    examples: ["لوحة", "/لوحة", "/devpanel"],
    category: "panel",
    permissions: { level: Level.STAFF },
    slash: new SlashCommandBuilder().setName("لوحة").setDescription("فتح لوحة التحكم المركزية"),

    async execute(ctx) {
      // اللوحة تُرسل مخفية دائمًا حتى لا يراها غير صاحبها
      return ctx.reply(panel.home(ctx.app, ctx.member), { ephemeral: true });
    }
  }
];
