import { Events } from 'discord.js';
import { warmTaskSnapshotCache } from '../services/task-cache-warmup.js';
import { warmProjectNameCache } from '../services/project-cache.js';

const CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let cacheRefreshRunning = false;

async function refreshRuntimeCaches() {
  if (cacheRefreshRunning) {
    return;
  }

  cacheRefreshRunning = true;
  try {
    const [taskResult, projectResult] = await Promise.all([
      warmTaskSnapshotCache(),
      warmProjectNameCache(),
    ]);

    console.log(
      '[Cache] Refresh complete: ' +
      taskResult.tasksCached + ' task snapshots across ' + taskResult.pagesFetched +
      ' page(s), ' + projectResult.projectsCached + ' project names cached.'
    );
  } catch (err) {
    console.error('[Cache] Failed to refresh runtime caches', err);
  } finally {
    cacheRefreshRunning = false;
  }
}

export const name = Events.ClientReady;
export const once = true;

/**
 * @param {import('discord.js').Client} client
 */
export function execute(client) {
  console.log('[Bot] Logged in as ' + client.user.tag);

  // Initial warm-up in the background and periodic refresh every 5 minutes.
  void refreshRuntimeCaches();
  setInterval(() => {
    void refreshRuntimeCaches();
  }, CACHE_REFRESH_INTERVAL_MS);
}
