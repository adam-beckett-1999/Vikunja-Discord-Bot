import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('Missing required environment variable: ' + name);
  }

  return value;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

export default {
  bot: {
    timeZone: requireEnv('TZ'),
    publicUrl: requireEnv('BOT_PUBLIC_URL'),
  },
  discord: {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
  },
  vikunja: {
    baseUrl: requireEnv('VIKUNJA_BASE_URL').replace(/\/$/, ''),
    apiToken: requireEnv('VIKUNJA_API_TOKEN'),
  },
  webhook: {
    port: parsePositiveInt(process.env.WEBHOOK_PORT, 3000),
    maxBodyKb: parsePositiveInt(process.env.WEBHOOK_MAX_BODY_KB, 256),
  },
};
