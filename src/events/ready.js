import { Events } from 'discord.js';
import { warmTaskSnapshotCache } from '../services/task-cache-warmup.js';

export const name = Events.ClientReady;
export const once = true;

/**
 * @param {import('discord.js').Client} client
 */
export function execute(client) {
  console.log('[Bot] Logged in as ' + client.user.tag);

  // Warm cache in the background so first webhook updates can include diff hints.
  void warmTaskSnapshotCache()
    .then((result) => {
      console.log(
        '[Cache] Warmed task snapshots: ' + result.tasksCached +
        ' tasks across ' + result.pagesFetched + ' page(s).'
      );
    })
    .catch((err) => {
      console.error('[Cache] Failed to warm task snapshots on startup', err);
    });
}
