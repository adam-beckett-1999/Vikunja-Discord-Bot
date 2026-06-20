import { getAllProjects, getTasksByProject } from './vikunja.js';
import { cacheTaskSnapshot } from './task-update-context.js';

const DEFAULT_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 500;

function isBadRequestError(err) {
  return Number(err?.response?.status) === 400;
}

function buildPageSignature(tasks) {
  const ids = tasks
    .map((task) => task?.id)
    .filter((id) => id !== undefined && id !== null)
    .slice(0, 50)
    .join(',');
  return tasks.length + '|' + ids;
}

async function fetchProjectPageWithFallback({
  fetchProjectTasks,
  projectId,
  page,
  perPage,
  supportsPerPage,
  logger,
}) {
  if (!supportsPerPage) {
    const response = await fetchProjectTasks(projectId, { page });
    return {
      response,
      supportsPerPage: false,
      effectivePerPage: undefined,
    };
  }

  try {
    const response = await fetchProjectTasks(projectId, { page, per_page: perPage });
    return {
      response,
      supportsPerPage: true,
      effectivePerPage: perPage,
    };
  } catch (err) {
    if (!isBadRequestError(err)) throw err;
  }

  logger.warn?.(
    '[Cache] /projects/' + projectId + '/tasks rejected per_page; continuing with page-only warm-up for this project.'
  );

  const response = await fetchProjectTasks(projectId, { page });
  return {
    response,
    supportsPerPage: false,
    effectivePerPage: undefined,
  };
}

async function warmTaskSnapshotCacheByProject({
  fetchProjects,
  fetchProjectTasks,
  perPage,
  maxPages,
  logger,
}) {
  const projectsResponse = await fetchProjects();
  const projects = Array.isArray(projectsResponse?.data) ? projectsResponse.data : [];

  let pagesFetched = 0;
  let tasksCached = 0;
  let stoppedByMaxPages = false;

  for (const project of projects) {
    const projectId = project?.id;
    if (projectId === undefined || projectId === null) continue;

    let supportsPerPage = true;
    let effectivePerPage = perPage;
    let previousCount;
    const seenPageSignatures = new Set();

    for (let page = 1; page <= maxPages; page++) {
      const fetchResult = await fetchProjectPageWithFallback({
        fetchProjectTasks,
        projectId,
        page,
        perPage: effectivePerPage,
        supportsPerPage,
        logger,
      });

      supportsPerPage = fetchResult.supportsPerPage;
      effectivePerPage = fetchResult.effectivePerPage;

      const tasks = Array.isArray(fetchResult.response?.data) ? fetchResult.response.data : [];
      const signature = buildPageSignature(tasks);
      pagesFetched++;

      for (const task of tasks) {
        cacheTaskSnapshot(task);
        tasksCached++;
      }

      if (tasks.length === 0) {
        break;
      }

      if (!supportsPerPage && seenPageSignatures.has(signature)) {
        logger.warn?.('[Cache] Detected repeated project task page result for project ' + projectId + '; stopping this project warm-up.');
        break;
      }
      seenPageSignatures.add(signature);

      if (effectivePerPage !== undefined && tasks.length < effectivePerPage) {
        break;
      }

      if (!supportsPerPage && previousCount !== undefined && tasks.length < previousCount) {
        break;
      }

      previousCount = tasks.length;

      if (page === maxPages) {
        stoppedByMaxPages = true;
        logger.warn?.(
          '[Cache] Project task warm-up reached max page limit (' + maxPages + ') for project ' + projectId + '.'
        );
      }
    }
  }

  return { pagesFetched, tasksCached, stoppedByMaxPages };
}

/**
 * Warm the in-memory task snapshot cache by paging through accessible Vikunja
 * tasks. Intended to run on startup so first updates can still be diffed.
 *
 * @param {object} [options]
 * @param {() => Promise<{data: object[]}>} [options.fetchProjects]
 * @param {(projectId: number|string, params: object) => Promise<{data: object[]}>} [options.fetchProjectTasks]
 * @param {number} [options.perPage]
 * @param {number} [options.maxPages]
 * @param {{info?: Function, warn?: Function, error?: Function}} [options.logger]
 * @returns {Promise<{pagesFetched: number, tasksCached: number, stoppedByMaxPages: boolean}>}
 */
export async function warmTaskSnapshotCache(options = {}) {
  const fetchProjects = options.fetchProjects ?? getAllProjects;
  const fetchProjectTasks = options.fetchProjectTasks ?? getTasksByProject;
  const perPage = options.perPage ?? DEFAULT_PER_PAGE;
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const logger = options.logger ?? console;

  const result = await warmTaskSnapshotCacheByProject({
    fetchProjects,
    fetchProjectTasks,
    perPage,
    maxPages,
    logger,
  });

  if (result.tasksCached === 0) {
    logger.warn?.('[Cache] Project warm-up completed but cached 0 tasks.');
  }

  return result;
}