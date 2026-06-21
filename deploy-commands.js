/**
 * deploy-commands.js
 *
 * Registers (or updates) slash commands with the Discord API.
 *
 * Usage:
 *   node deploy-commands.js           # Deploy to all guilds listed in DISCORD_GUILD_IDS
 *   node deploy-commands.js --global  # Deploy globally (can take up to 1 hour to propagate)
 */
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
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

const rest = new REST().setToken(config.discord.token);
const deployGlobal = process.argv.includes('--global');

if (deployGlobal) {
  console.log('Deploying ' + commandBody.length + ' command(s) globally…');
  const data = await rest.put(Routes.applicationCommands(config.discord.clientId), {
    body: commandBody,
  });
  console.log('Successfully registered ' + data.length + ' global command(s).');
} else {
  const guildIds = config.discord.guildIds;
  if (!guildIds.length) {
    console.error('No DISCORD_GUILD_IDS configured and --global flag not set. Nothing to deploy.');
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
