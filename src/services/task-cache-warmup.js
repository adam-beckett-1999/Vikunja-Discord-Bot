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

function buildPageSignature(tasks) {
  const ids = tasks
    .map((task) => task?.id)
    .filter((id) => id !== undefined && id !== null)
    .slice(0, 50)
    .join(',');
  return tasks.length + '|' + ids;
}

async function fetchPageWithPerPageFallback({ fetchPage, page, perPage, logger, supportsPerPage }) {
  if (!supportsPerPage) {
    // per_page already known unsupported for this Vikunja instance.
    const response = await fetchPage({ page });
    return {
      response,
      effectivePerPage: undefined,
      supportsPerPage: false,
      usedPageOnlyFallback: true,
      usedUnpagedFallback: false,
    };
  }

  const perPageCandidates = buildPerPageCandidates(perPage);

  let lastError;
  for (const candidatePerPage of perPageCandidates) {
    try {
        const response = await fetchPage({ page, per_page: candidatePerPage });
        return {
          response,
          effectivePerPage: candidatePerPage,
          supportsPerPage: true,
          usedPageOnlyFallback: false,
          usedUnpagedFallback: false,
        };
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

  // Some Vikunja versions reject per_page for /tasks/all but still accept page.
  try {
    const response = await fetchPage({ page });
    logger.warn?.(
      '[Cache] /tasks/all does not support per_page on this instance. Continuing with page-only warm-up.'
    );
    return {
      response,
      effectivePerPage: undefined,
      supportsPerPage: false,
      usedPageOnlyFallback: true,
      usedUnpagedFallback: false,
    };
  } catch (pageOnlyErr) {
    if (!isBadRequestError(pageOnlyErr)) {
      throw pageOnlyErr;
    }
  }

  // Last fallback: completely unpaged request to populate at least initial cache.
  try {
    const response = await fetchPage({});
    logger.warn?.(
      '[Cache] /tasks/all rejected pagination params. Continuing with unpaged warm-up fallback.'
    );
    return {
      response,
      effectivePerPage: undefined,
      supportsPerPage: false,
      usedPageOnlyFallback: false,
      usedUnpagedFallback: true,
    };
  } catch (unpagedErr) {
    if (!isBadRequestError(unpagedErr)) {
      throw unpagedErr;
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
  let supportsPerPage = true;
  const seenPageSignatures = new Set();

  for (let page = 1; page <= maxPages; page++) {
    const fetchResult = await fetchPageWithPerPageFallback({
      fetchPage,
      page,
      perPage: effectivePerPage,
      logger,
      supportsPerPage,
    });
    const response = fetchResult.response;
    effectivePerPage = fetchResult.effectivePerPage;
    supportsPerPage = fetchResult.supportsPerPage;

    const tasks = Array.isArray(response?.data) ? response.data : [];
    const pageSignature = buildPageSignature(tasks);

    pagesFetched++;

    for (const task of tasks) {
      cacheTaskSnapshot(task);
      tasksCached++;
    }

    if (tasks.length === 0) {
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }

    if (fetchResult.usedUnpagedFallback) {
      // Unpaged route does not support reliable pagination.
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }

    if (!supportsPerPage && seenPageSignatures.has(pageSignature)) {
      logger.warn?.('[Cache] Detected repeated /tasks/all page result; stopping warm-up to avoid duplicate looping.');
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }
    seenPageSignatures.add(pageSignature);

    if (effectivePerPage !== undefined && tasks.length < effectivePerPage) {
      return { pagesFetched, tasksCached, stoppedByMaxPages: false };
    }

    // In page-only fallback mode, stop when page returns less than prior page size.
    if (effectivePerPage === undefined && fetchResult.usedPageOnlyFallback && page > 1) {
      const previousSignature = [...seenPageSignatures][seenPageSignatures.size - 2];
      const previousCount = Number(previousSignature?.split('|')[0] ?? tasks.length);
      if (tasks.length < previousCount) {
        return { pagesFetched, tasksCached, stoppedByMaxPages: false };
      }
    }

  }

  logger.warn?.('[Cache] Task snapshot warm-up reached max page limit (' + maxPages + ').');
  return { pagesFetched, tasksCached, stoppedByMaxPages: true };
}