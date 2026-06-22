import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }

  return value;
}

export default {
  bot: {
    timeZone: requireEnv('TZ'),
  },
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
  },
  vikunja: {
    baseUrl: process.env.VIKUNJA_BASE_URL?.replace(/\/$/, ''),
    apiToken: process.env.VIKUNJA_API_TOKEN,
  },
  webhook: {
    port: parseInt(process.env.WEBHOOK_PORT ?? '3000', 10),
  },
};
