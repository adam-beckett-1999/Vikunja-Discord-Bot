import { getAllTasks } from './vikunja.js';
import { cacheTaskSnapshot } from './task-update-context.js';

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 500;
const FALLBACK_PER_PAGE_OPTIONS = [100, 50, 25];

function isBadRequestError(err) {
  return Number(err?.response?.status) === 400;
}

function buildPerPageCandidates(perPage) {
  const requested = Math.trunc(perPage);
  const candidates = [requested];

  for (const fallback of FALLBACK_PER_PAGE_OPTIONS) {
    if (fallback < requested && !candidates.includes(fallback)) {
      candidates.push(fallback);
    }
  }

  return candidates;
}

async function fetchPageWithPerPageFallback({ fetchPage, page, perPage, logger }) {
  const perPageCandidates = buildPerPageCandidates(perPage);

  let lastError;
  for (const candidatePerPage of perPageCandidates) {
    try {
      const response = await fetchPage({ page, per_page: candidatePerPage });
      return { response, effectivePerPage: candidatePerPage };
    } catch (err) {
      lastError = err;
      if (!isBadRequestError(err)) {
        throw err;
      }

      if (candidatePerPage !== perPageCandidates[perPageCandidates.length - 1]) {
        logger.warn?.(
          '[Cache] /tasks/all rejected per_page=' + candidatePerPage +
          ' with 400. Retrying with smaller page size.'
        );
      }
    }
  }

  throw lastError;
}

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
  let effectivePerPage = perPage;

  for (let page = 1; page <= maxPages; page++) {
    const fetchResult = await fetchPageWithPerPageFallback({
      fetchPage,
      page,
      perPage: effectivePerPage,
      logger,
    });
    const response = fetchResult.response;
    effectivePerPage = fetchResult.effectivePerPage;

    const tasks = Array.isArray(response?.data) ? response.data : [];

    pagesFetched++;

    for (const task of tasks) {
      cacheTaskSnapshot(task);
      tasksCached++;
    }

    if (tasks.length < effectivePerPage) {
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }
  }

  logger.warn?.('[Cache] Task snapshot warm-up reached max page limit (' + maxPages + ').');
  return { pagesFetched, tasksCached, stoppedByMaxPages: true };
}