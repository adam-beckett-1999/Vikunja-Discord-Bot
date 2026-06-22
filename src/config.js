import 'dotenv/config';
import { DateTime } from 'luxon';

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

function requireIanaTimezone(name) {
  const value = requireEnv(name);
  const probe = DateTime.now().setZone(value);
  if (!probe.isValid) {
    throw new Error(
      'Invalid IANA timezone in ' + name + ': ' + value
      + '. Examples: UTC, Europe/London, America/New_York'
    );
  }

  return value;
}

function requireHttpUrlEnv(name) {
  const value = requireEnv(name);

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(name + ' must be a valid URL, e.g. https://your-bot.example.com');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(name + ' must start with http:// or https://');
  }

  return value;
}

export default {
  bot: {
    timeZone: requireIanaTimezone('TZ'),
    publicUrl: requireHttpUrlEnv('BOT_PUBLIC_URL'),
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
