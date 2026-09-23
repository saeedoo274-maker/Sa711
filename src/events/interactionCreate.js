module.exports = async function interactionCreate(app, interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      return app.commands.handleInteraction(interaction);
    }

    // الإكمال التلقائي: يبحث عن دالة autocomplete في تعريف الأمر نفسه.
    // مهلته ثلاث ثوانٍ ولا يقبل رسائل خطأ، فأي فشل يُرد بقائمة فارغة.
    if (interaction.isAutocomplete()) {
      const command = app.registry.get(interaction.commandName);
      if (typeof command?.autocomplete !== "function") return interaction.respond([]).catch(() => {});
      try {
        return await command.autocomplete(interaction, app);
      } catch {
        return interaction.respond([]).catch(() => {});
      }
    }

    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const routed = await app.interactions.route(interaction);
      if (!routed && !interaction.replied && !interaction.deferred) {
        // مكوّن قديم من رسالة سابقة لم يعد له معالج
        await interaction.reply({
          content: `${app.config.emoji("warning")} هذا الزر لم يعد فعّالًا.`,
          flags: 64
        }).catch(() => {});
      }
    }
  } catch (error) {
    const { userMessage } = app.errors.capture(error, {
      system: "interactions",
      command: interaction.customId || interaction.commandName,
      guildId: interaction.guild?.id,
      userId: interaction.user?.id
    });
    const payload = { content: userMessage, flags: 64 };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
};
