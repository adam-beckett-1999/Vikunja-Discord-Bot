import { getAllProjects, getAllTasks, getTask, getTasksByProject } from './vikunja.js';

const MAX_CHOICE_NAME_LENGTH = 100;

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function extractTrailingId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Accept either plain numeric input ("123") or label formats like
  // "Project Name (#123)" and "Task Name #123".
  if (/^\d+$/.test(raw)) return raw;

  const match = raw.match(/#(\d+)\)?\s*$/);
  return match ? match[1] : null;
}

export function parseSelectionId(value) {
  return extractTrailingId(value);
}

function isNumericSelection(value) {
  return /^\d+$/.test(String(value ?? '').trim());
}

function toChoices(items, labelFn) {
  return items.slice(0, 25).map((item) => ({
    name: formatChoiceName(labelFn(item), item.id),
    value: String(item.id),
  }));
}

function formatChoiceName(label, id) {
  const safeLabel = String(label ?? '').trim() || 'Untitled';
  const suffix = ' (#' + id + ')';
  const maxLabelLength = MAX_CHOICE_NAME_LENGTH - suffix.length;

  if (maxLabelLength <= 1) {
    return String(id).slice(0, MAX_CHOICE_NAME_LENGTH);
  }

  if (safeLabel.length <= maxLabelLength) {
    return safeLabel + suffix;
  }

  // Keep the ID suffix while shortening long titles to satisfy Discord's 100-char limit.
  const truncated = safeLabel.slice(0, maxLabelLength - 1).trimEnd() + '…';
  return truncated + suffix;
}

function findExactMatch(items, selection, labelFn) {
  const needle = normalize(selection);
  return items.find((item) => normalize(labelFn(item)) === needle) ?? null;
}

function findUniquePartialMatch(items, selection, labelFn) {
  const needle = normalize(selection);
  const matches = items.filter((item) => normalize(labelFn(item)).includes(needle));
  return matches.length === 1 ? matches[0] : null;
}

export async function autocompleteProjects(query) {
  const res = await getAllProjects();
  const projects = Array.isArray(res.data) ? res.data : [];
  const needle = normalize(query);

  const matches = projects.filter((project) => {
    if (!needle) return true;
    return normalize(project.title).includes(needle);
  });

  return toChoices(matches, (project) => project.title);
}

export async function resolveProjectSelection(selection) {
  const raw = String(selection ?? '').trim();
  if (!raw) return null;

  const res = await getAllProjects();
  const projects = Array.isArray(res.data) ? res.data : [];

  const extractedId = extractTrailingId(raw);
  if (extractedId) {
    return projects.find((project) => String(project.id) === extractedId) ?? null;
  }

  if (isNumericSelection(raw)) {
    return projects.find((project) => String(project.id) === raw) ?? null;
  }

  return findExactMatch(projects, raw, (project) => project.title)
    ?? findUniquePartialMatch(projects, raw, (project) => project.title);
}

export async function autocompleteTasks(projectId, query) {
  if (!projectId) return [];

  const params = {
    page: 1,
    per_page: 100,
    s: query || undefined,
  };

  const res = await getTasksByProject(projectId, params);
  let tasks = Array.isArray(res.data) ? res.data : [];

  // Some Vikunja setups return a non-array payload for project-task routes.
  // Fall back to all-task search and filter by project id in that case.
  if (!tasks.length) {
    const allRes = await getAllTasks(params);
    const allTasks = Array.isArray(allRes.data) ? allRes.data : [];
    tasks = allTasks.filter((task) => String(task.project_id) === String(projectId));
  }

  const needle = normalize(query);

  const matches = tasks.filter((task) => {
    if (!needle) return true;
    return normalize(task.title).includes(needle);
  });

  return toChoices(matches, (task) => task.title);
}

export async function resolveTaskSelection(projectId, selection) {
  const raw = String(selection ?? '').trim();
  if (!projectId || !raw) return null;

  const extractedId = extractTrailingId(raw);
  if (extractedId) {
    try {
      const task = await getTask(Number(extractedId));
      return String(task.data?.project_id ?? '') === String(projectId) ? task.data : null;
    } catch {
      return null;
    }
  }

  if (isNumericSelection(raw)) {
    try {
      const task = await getTask(Number(raw));
      return String(task.data?.project_id ?? '') === String(projectId) ? task.data : null;
    } catch {
      return null;
    }
  }

  const res = await getTasksByProject(projectId, {
    page: 1,
    per_page: 100,
    s: raw,
  });
  const tasks = Array.isArray(res.data) ? res.data : [];

  return findExactMatch(tasks, raw, (task) => task.title)
    ?? findUniquePartialMatch(tasks, raw, (task) => task.title);
}