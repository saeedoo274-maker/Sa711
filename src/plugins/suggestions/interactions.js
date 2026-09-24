const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const { safeReply, safeModal, safeUpdate } = require("../../core/interactions/interactionSafe");
const { stamp, isExpired, replyExpired } = require("../../core/interactions/ui");

const CONFIRM_TTL_MS = 60_000;

module.exports = {
  prefix: "sug",

  async handle(interaction, app) {
    const svc = app.suggestions;
    const guild = interaction.guild;
    const t = app.i18n.forGuild(guild.id);
    const [, action, idRaw, arg, s] = interaction.customId.split(":");
    const id = parseInt(idRaw, 10);
    const suggestion = svc.repo.get(id);
    const err = (key, vars) => safeReply(interaction, { content: `${app.config.emoji("error")} ${t(key, vars)}`, flags: 64 });

    if (!suggestion || suggestion.guild_id !== guild.id) return err("suggest.err.notFound");

    // ---- تصويت (متاح للجميع، بلا انتهاء صلاحية) ----
    if (action === "v") {
      const res = svc.vote(interaction.member, id, arg);
      if (!res.ok) return err(`suggest.err.vote.${res.reason}`);
      return safeReply(interaction, {
        content: `${app.config.emoji("success")} ${t(`suggest.voted.${res.action}`)} (👍 ${res.up} • 👎 ${res.down})`,
        flags: 64
      });
    }

    // كل ما بعد هذا للطاقم — يُفحص عند كل ضغطة
    if (!svc.isStaff(interaction.member)) return err("suggest.err.staffOnly");

    if (action === "m") {
      const st = stamp();
      const btn = (status, emoji, style) =>
        new ButtonBuilder().setCustomId(`sug:s:${id}:${status}:${st}`).setEmoji(emoji).setLabel(t(`suggest.status.${status}`)).setStyle(style).setDisabled(suggestion.status === status);
      return safeReply(interaction, {
        content: `⚙️ ${t("suggest.manage", { number: suggestion.number })}`,
        components: [
          new ActionRowBuilder().addComponents(
            btn("accepted", "✅", ButtonStyle.Success),
            btn("review", "🔍", ButtonStyle.Primary),
            btn("rejected", "❌", ButtonStyle.Danger),
            btn("pending", "🕓", ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`sug:x:${id}:ask:${st}`).setEmoji("🗑️").setStyle(ButtonStyle.Secondary)
          )
        ],
        flags: 64
      });
    }

    if (action === "s") {
      if (isExpired(s, 10 * 60_000)) return replyExpired(interaction, app);
      const modal = new ModalBuilder().setCustomId(`sug:r:${id}:${arg}`).setTitle(`${t(`suggest.status.${arg}`)} — #${suggestion.number}`);
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("reason").setLabel(t("suggest.staffResponse")).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000)
      ));
      return safeModal(interaction, modal);
    }

    if (action === "r" && interaction.isModalSubmit()) {
      const reason = interaction.fields.getTextInputValue("reason") || null;
      const res = await svc.decide(guild, id, arg, interaction.member, reason);
      if (!res.ok) return err(`suggest.err.${res.reason}`);
      return safeReply(interaction, { content: `${app.config.emoji("success")} ${t("suggest.decided", { number: suggestion.number, status: t(`suggest.status.${arg}`) })}`, flags: 64 });
    }

    if (action === "x") {
      if (isExpired(s, CONFIRM_TTL_MS * 10)) return replyExpired(interaction, app);
      if (arg === "ask") {
        return safeUpdate(interaction, {
          content: `🗑️ ${t("suggest.confirmDelete", { number: suggestion.number })}`,
          components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`sug:x:${id}:yes:${stamp()}`).setLabel(t("common.confirm")).setStyle(ButtonStyle.Danger)
          )]
        });
      }
      await svc.remove(guild, id, interaction.member);
      return safeUpdate(interaction, { content: `${app.config.emoji("success")} ${t("suggest.deleted", { number: suggestion.number })}`, components: [] });
    }

    return replyExpired(interaction, app);
  }
};
