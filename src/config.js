require('dotenv').config();

const required = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID', 'MONGO_URI'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing environment variables in .env: ${missing.join(', ')}`);
  process.exit(1);
}

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  mongoUri: process.env.MONGO_URI,
  timezone: process.env.TIMEZONE || 'Asia/Riyadh',
};
