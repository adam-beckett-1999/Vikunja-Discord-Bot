import 'dotenv/config';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import config from './config.js';
import { startWebhookServer } from './webhook/server.js';
import * as readyEvent from './events/ready.js';
import * as interactionEvent from './events/interactionCreate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Discord client ────────────────────────────────────────────────────────────
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// ─── Load commands ─────────────────────────────────────────────────────────────
/** @type {Collection<string, {data: import('discord.js').SlashCommandBuilder, execute: Function}>} */
const commands = new Collection();

const commandDirs = ['task', 'project', 'webhook'];

for (const dir of commandDirs) {
  const dirPath = resolve(__dirname, 'commands', dir);
  let files;
  try {
    files = readdirSync(dirPath).filter((f) => f.endsWith('.js'));
  } catch {
    continue;
  }

  for (const file of files) {
    const filePath = pathToFileURL(resolve(dirPath, file)).href;
    const command = await import(filePath);
    if (!command.data || !command.execute) {
      console.warn('[Commands] Skipping ' + file + ': missing data or execute export');
      continue;
    }
    commands.set(command.data.name, command);
    console.log('[Commands] Loaded: ' + command.data.name);
  }
}

// ─── Register event handlers ───────────────────────────────────────────────────
client.once(readyEvent.name, (...args) => readyEvent.execute(...args));
client.on(interactionEvent.name, (...args) => interactionEvent.execute(...args, commands));

// ─── Start webhook server ──────────────────────────────────────────────────────
startWebhookServer(client);

// ─── Login ─────────────────────────────────────────────────────────────────────
if (!config.discord.token) {
  console.error('[Bot] DISCORD_TOKEN is not set. Please configure your .env file.');
  process.exit(1);
}

client.login(config.discord.token);
