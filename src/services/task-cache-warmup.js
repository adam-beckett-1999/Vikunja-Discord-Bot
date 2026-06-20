import { getAllTasks } from './vikunja.js';
import { cacheTaskSnapshot } from './task-update-context.js';

const DEFAULT_PER_PAGE = 200;
const DEFAULT_MAX_PAGES = 500;

/**
 * Warm the in-memory task snapshot cache by paging through accessible Vikunja
 * tasks. Intended to run on startup so first updates can still be diffed.
 *
 * @param {object} [options]
 * @param {(params: object) => Promise<{data: object[]}>} [options.fetchPage]
 * @param {number} [options.perPage]
 * @param {number} [options.maxPages]
 * @param {{info?: Function, warn?: Function, error?: Function}} [options.logger]
 * @returns {Promise<{pagesFetched: number, tasksCached: number, stoppedByMaxPages: boolean}>}
 */
export async function warmTaskSnapshotCache(options = {}) {
  const fetchPage = options.fetchPage ?? getAllTasks;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const logger = options.logger ?? console;

  let pagesFetched = 0;
  let tasksCached = 0;

  for (let page = 1; page <= maxPages; page++) {
    const response = await fetchPage({ page, per_page: perPage });
    const tasks = Array.isArray(response?.data) ? response.data : [];

    pagesFetched++;

    for (const task of tasks) {
      cacheTaskSnapshot(task);
      tasksCached++;
    }

    if (tasks.length < perPage) {
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }
  }

  logger.warn?.('[Cache] Task snapshot warm-up reached max page limit (' + maxPages + ').');
  return { pagesFetched, tasksCached, stoppedByMaxPages: true };
}