import { Events } from 'discord.js';
import { warmTaskSnapshotCache } from '../services/task-cache-warmup.js';
import { warmProjectNameCache } from '../services/project-cache.js';

const CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let cacheRefreshRunning = false;

function formatCacheError(err) {
  const status = err?.response?.status;
  const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';
  return status ? 'status=' + status + ' message="' + message + '"' : 'message="' + message + '"';
}

async function refreshRuntimeCaches() {
  if (cacheRefreshRunning) {
    return;
  }

  cacheRefreshRunning = true;
  try {
    const [taskResult, projectResult] = await Promise.allSettled([
      warmTaskSnapshotCache(),
      warmProjectNameCache(),
    ]);

    if (taskResult.status === 'fulfilled') {
      console.log(
        '[Cache] Task snapshot refresh complete: ' +
        taskResult.value.tasksCached + ' tasks across ' + taskResult.value.pagesFetched + ' page(s).'
      );
    } else {
      console.error('[Cache] Task snapshot refresh failed: ' + formatCacheError(taskResult.reason));
    }

    if (projectResult.status === 'fulfilled') {
      console.log(
        '[Cache] Project name refresh complete: ' +
        projectResult.value.projectsCached + ' project names cached.'
      );
    } else {
      console.error('[Cache] Project name refresh failed: ' + formatCacheError(projectResult.reason));
    }
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
