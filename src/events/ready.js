import { Events } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * @param {import('discord.js').Client} client
 */
export function execute(client) {
  console.log('[Bot] Logged in as ' + client.user.tag);
}
