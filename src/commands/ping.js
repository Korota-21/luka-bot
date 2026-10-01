const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const mongoose = require('mongoose');

const DB_STATES = { 0: 'مفصول ❌', 1: 'متصل ✅', 2: 'يتصل...', 3: 'يفصل...' };

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('اختبار البوت والاتصال بقاعدة البيانات'),

  async execute(interaction) {
    const start = Date.now();
    await interaction.reply({ content: '🏓 ...', flags: MessageFlags.Ephemeral });
    const latency = Date.now() - start;

    await interaction.editReply(
      `🏓 pong!\n` +
        `⏱️ زمن الاستجابة: **${latency}ms**\n` +
        `📡 ويب سوكت: **${interaction.client.ws.ping}ms**\n` +
        `🗄️ قاعدة البيانات: **${DB_STATES[mongoose.connection.readyState]}**`
    );
  },
};
