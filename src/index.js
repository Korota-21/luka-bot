const mongoose = require('mongoose');
const { Client, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { connectDB } = require('./database/connect');
const { loadCommands } = require('./utils/loadCommands');
const { loadEvents } = require('./utils/loadEvents');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.commands = loadCommands();
console.log(`Loaded ${client.commands.size} commands`);

// معالجات الأزرار والـ Modals: الـ scope هو اسم الأمر
client.componentHandlers = new Map();
for (const [name, command] of client.commands) {
  if (command.componentHandler) client.componentHandlers.set(name, command.componentHandler);
}

loadEvents(client);

process.on('unhandledRejection', (err) => console.error('Unhandled rejection:', err));

(async () => {
  await connectDB();
  await client.login(config.token);
})().catch((err) => {
  console.error('Failed to start bot:', err);
  process.exit(1);
});

async function shutdown() {
  console.log('Shutting down...');
  await client.destroy();
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
