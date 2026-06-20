import { getAllProjects } from './vikunja.js';

const projectTitleCache = new Map();

/**
 * Store project title by id for later lookup in webhook embeds.
 *
 * @param {{id?: number|string, title?: string}} project
 */
export function cacheProject(project) {
  const id = project?.id;
  const title = project?.title;
  if (id === undefined || id === null) return;
  if (typeof title !== 'string' || !title.trim()) return;

  projectTitleCache.set(String(id), title);
}

/**
 * Resolve cached project title by id.
 *
 * @param {number|string} projectId
 * @returns {string|undefined}
 */
export function getCachedProjectTitle(projectId) {
  if (projectId === undefined || projectId === null) return undefined;
  return projectTitleCache.get(String(projectId));
}

/**
 * Warm in-memory project cache from Vikunja.
 *
 * @param {object} [options]
 * @param {() => Promise<{data: object[]}>} [options.fetchProjects]
 * @returns {Promise<{projectsCached: number}>}
 */
export async function warmProjectNameCache(options = {}) {
  const fetchProjects = options.fetchProjects ?? getAllProjects;
  const response = await fetchProjects();
  const projects = Array.isArray(response?.data) ? response.data : [];

  let projectsCached = 0;
  for (const project of projects) {
    const before = getCachedProjectTitle(project?.id);
    cacheProject(project);
    const after = getCachedProjectTitle(project?.id);
    if (!before && after) projectsCached++;
    if (before && after && before !== after) projectsCached++;
  }

  return { projectsCached };
}

/**
 * Clear cached project title for tests/cleanup.
 *
 * @param {number|string} projectId
 */
export function clearCachedProjectTitle(projectId) {
  if (projectId === undefined || projectId === null) return;
  projectTitleCache.delete(String(projectId));
}