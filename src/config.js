import 'dotenv/config';

export default {
  bot: {
    timeZone: (process.env.BOT_TIMEZONE ?? 'UTC').trim() || 'UTC',
  },
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildIds: process.env.DISCORD_GUILD_IDS
      ? process.env.DISCORD_GUILD_IDS.split(',').map((id) => id.trim()).filter(Boolean)
      : [],
  },
  vikunja: {
    baseUrl: process.env.VIKUNJA_BASE_URL?.replace(/\/$/, ''),
    apiToken: process.env.VIKUNJA_API_TOKEN,
  },
  webhook: {
    port: parseInt(process.env.WEBHOOK_PORT ?? '3000', 10),
    secret: process.env.WEBHOOK_SECRET,
  },
};
