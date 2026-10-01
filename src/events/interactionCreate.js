const { Events, MessageFlags } = require('discord.js');
const { UserError } = require('../utils/errors');

async function safeReply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  try {
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch (err) {
    console.error('Failed to send error reply:', err);
  }
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // autocomplete: ما نقدر نرد برسالة خطأ، نسجل فقط
    if (interaction.isAutocomplete()) {
      try {
        const command = client.commands.get(interaction.commandName);
        if (command?.autocomplete) await command.autocomplete(interaction);
      } catch (err) {
        console.error(`Autocomplete error in /${interaction.commandName}:`, err);
      }
      return;
    }

    try {
      if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;
        return await command.execute(interaction);
      }

      // الأزرار والـ Modals: customId بصيغة "scope:action:..."
      // الـ scope = اسم الأمر اللي يملك الـ componentHandler
      if (interaction.isButton() || interaction.isModalSubmit()) {
        const [scope] = interaction.customId.split(':');
        const handler = client.componentHandlers.get(scope);
        if (handler) return await handler(interaction);
        return await safeReply(interaction, 'هذا الزر لم يعد فعّال.');
      }
    } catch (err) {
      // أخطاء متوقعة نعرضها للمستخدم كما هي
      if (err instanceof UserError) return safeReply(interaction, `⚠️ ${err.message}`);

      console.error('Interaction error:', err);
      await safeReply(interaction, 'صار خطأ غير متوقع، حاول مرة ثانية.');
    }
  },
};
