import 'dotenv/config';

export default {
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
    notificationChannelId: process.env.NOTIFICATION_CHANNEL_ID,
    debugLogging: ['1', 'true', 'yes', 'on'].includes(String(process.env.WEBHOOK_DEBUG_LOGGING ?? '').trim().toLowerCase()),
  },
};
