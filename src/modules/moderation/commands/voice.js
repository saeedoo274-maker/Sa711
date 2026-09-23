const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require("discord.js");
const { Level } = require("../../../core/permissions/PermissionService");
const { Events } = require("../../../core/events/EventBus");

/** كل أوامر الإدارة الصوتية تشترك في نفس الفحوصات، فتُبنى من مصنع واحد. */
function voiceCommand({ name, aliases, action, label, description, permission, slashExtra }) {
  const base = {
    name,
    aliases,
    description,
    usage: `${name} <@عضو>`,
    arguments: [{ name: "عضو", required: true, description: "العضو المتصل بروم صوتي" }],
    examples: [`${name} @أحمد`],
    category: "moderation",
    systemFlag: "moderation.enabled",
    permissions: { level: Level.MODERATOR, discordPermissions: [permission] },
    botPermissions: [permission],

    async execute(ctx) {
      const member = await ctx.getMember("user", 0);
      if (!member) return ctx.fail("errors.memberNotFound");

      const allowed = ctx.app.permissions.canActOn(ctx.member, member);
      if (!allowed.ok) return ctx.fail(`errors.${allowed.reason}`);

      if (!member.voice.channel) {
        return ctx.fail("errors.actionFailed", { details: ctx.t("moderation.voice.notInVoice") });
      }

      let extraDetails = "";
      try {
        switch (action) {
          case "mute": await member.voice.setMute(true, ctx.user.tag); break;
          case "unmute": await member.voice.setMute(false, ctx.user.tag); break;
          case "deafen": await member.voice.setDeaf(true, ctx.user.tag); break;
          case "undeafen": await member.voice.setDeaf(false, ctx.user.tag); break;
          case "disconnect": await member.voice.disconnect(ctx.user.tag); break;
          case "move": {
            const channel = await ctx.getChannel("channel", 1);
            if (!channel || channel.type !== ChannelType.GuildVoice) return ctx.fail("errors.channelNotFound");
            await member.voice.setChannel(channel, ctx.user.tag);
            extraDetails = `إلى <#${channel.id}>`;
            break;
          }
        }
      } catch (err) {
        return ctx.fail("errors.actionFailed", { details: err.message });
      }

      ctx.app.bus.emitSafe(Events.VOICE_ACTION, {
        guild: ctx.guild, executor: ctx.member, target: member, action: label, details: extraDetails || undefined
      });

      const key = action === "move" ? "moderation.voice.move" : `moderation.voice.${action}`;
      return ctx.success(ctx.t(key, { target: `<@${member.id}>`, channel: extraDetails.replace("إلى ", "") }));
    }
  };

  const builder = new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addUserOption((o) => o.setName("user").setDescription("العضو").setRequired(true))
    .setDefaultMemberPermissions(permission);
  if (slashExtra) slashExtra(builder);
  base.slash = builder;
  return base;
}

module.exports = [
  voiceCommand({ name: "كتم_صوتي", aliases: ["vmute", "كتم"], action: "mute", label: "كتم صوتي", description: "كتم عضو صوتيًا", permission: PermissionFlagsBits.MuteMembers }),
  voiceCommand({ name: "فك_كتم_صوتي", aliases: ["vunmute", "فك_كتم"], action: "unmute", label: "فك كتم صوتي", description: "فك الكتم الصوتي عن عضو", permission: PermissionFlagsBits.MuteMembers }),
  voiceCommand({ name: "اصمام", aliases: ["vdeafen"], action: "deafen", label: "إصمام", description: "إصمام عضو في الروم الصوتي", permission: PermissionFlagsBits.DeafenMembers }),
  voiceCommand({ name: "فك_اصمام", aliases: ["vundeafen"], action: "undeafen", label: "فك إصمام", description: "فك الإصمام عن عضو", permission: PermissionFlagsBits.DeafenMembers }),
  voiceCommand({ name: "فصل_صوتي", aliases: ["disconnect", "فصل"], action: "disconnect", label: "فصل صوتي", description: "فصل عضو من الروم الصوتي", permission: PermissionFlagsBits.MoveMembers }),
  voiceCommand({
    name: "نقل_صوتي", aliases: ["move", "نقل"], action: "move", label: "نقل صوتي",
    description: "نقل عضو إلى روم صوتي آخر", permission: PermissionFlagsBits.MoveMembers,
    slashExtra: (b) => b.addChannelOption((o) => o.setName("channel").setDescription("الروم الصوتي").addChannelTypes(ChannelType.GuildVoice).setRequired(true))
  })
];
