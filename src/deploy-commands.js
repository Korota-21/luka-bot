// تشغيله: npm run deploy
// يسجّل الأوامر في السيرفر المحدد (يظهر فوراً، بعكس الأوامر العامة)
const { REST, Routes } = require('discord.js');
const config = require('./config');
const { loadCommands } = require('./utils/loadCommands');

(async () => {
  const commands = [...loadCommands().values()].map((c) => c.data.toJSON());
  const rest = new REST().setToken(config.token);

  try {
    console.log(`Registering ${commands.length} commands...`);
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
      body: commands,
    });
    console.log('Commands registered successfully');
  } catch (err) {
    console.error('Failed to register commands:', err);
    process.exit(1);
  }
})();
