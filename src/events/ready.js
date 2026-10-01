const { Events } = require('discord.js');
const { startReminderJob } = require('../jobs/reminders');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient) {
    console.log(`Bot is ready as ${readyClient.user.tag}`);
    startReminderJob(readyClient);
    // لاحقاً هنا: استرجاع جلسات البومودورو
  },
};
