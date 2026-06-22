/**
 * deploy-commands.js
 *
 * Registers (or updates) slash commands with the Discord API.
 *
 * Usage:
 *   node deploy-commands.js           # Deploy to every guild the bot is currently in
 *   node deploy-commands.js --global  # Deploy globally (can take up to 1 hour to propagate)
 */
import 'dotenv/config';
import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import config from './src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commandBody = [];
const commandDirs = ['task', 'project', 'webhook', 'alerts'];

for (const dir of commandDirs) {
  const dirPath = resolve(__dirname, 'src', 'commands', dir);
  let files;
  try {
    files = readdirSync(dirPath).filter((f) => f.endsWith('.js'));
  } catch {
    continue;
  }

  for (const file of files) {
    const filePath = pathToFileURL(resolve(dirPath, file)).href;
    const command = await import(filePath);
    if (!command.data) {
      console.warn('Skipping ' + file + ': no data export');
      continue;
    }
    commandBody.push(command.data.toJSON());
    console.log('Queued: ' + command.data.name);
  }
}

const deployGlobal = process.argv.includes('--global');
const rest = new REST().setToken(config.discord.token);

if (deployGlobal) {
  console.log('Deploying ' + commandBody.length + ' command(s) globally…');
  const data = await rest.put(Routes.applicationCommands(config.discord.clientId), {
    body: commandBody,
  });
  console.log('Successfully registered ' + data.length + ' global command(s).');
} else {
  const guildIds = await getConnectedGuildIds(config.discord.token);
  if (!guildIds.length) {
    console.error('No connected guilds found for this bot. Make sure the bot has been invited to a server before running the container, then restart the container after adding it if needed.');
    process.exit(1);
  }

  for (const guildId of guildIds) {
    console.log('Deploying ' + commandBody.length + ' command(s) to guild ' + guildId + '…');
    const data = await rest.put(
      Routes.applicationGuildCommands(config.discord.clientId, guildId),
      { body: commandBody }
    );
    console.log('Registered ' + data.length + ' command(s) in guild ' + guildId + '.');
  }
}

async function getConnectedGuildIds(token) {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  try {
    await client.login(token);
    await new Promise((resolve) => {
      if (client.isReady()) {
        resolve();
        return;
      }

      client.once('clientReady', resolve);
    });

    return [...client.guilds.cache.keys()];
  } finally {
    client.destroy();
  }
}
