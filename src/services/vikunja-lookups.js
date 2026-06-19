import { getAllProjects, getTask, getTasksByProject } from './vikunja.js';

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isNumericSelection(value) {
  return /^\d+$/.test(String(value ?? '').trim());
}

function toChoices(items, labelFn) {
  return items.slice(0, 25).map((item) => ({
    name: labelFn(item),
    value: String(item.id),
  }));
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

  return toChoices(matches, (project) => project.title + ' (#' + project.id + ')');
}

export async function resolveProjectSelection(selection) {
  const raw = String(selection ?? '').trim();
  if (!raw) return null;

  const res = await getAllProjects();
  const projects = Array.isArray(res.data) ? res.data : [];

  if (isNumericSelection(raw)) {
    return projects.find((project) => String(project.id) === raw) ?? null;
  }

  return findExactMatch(projects, raw, (project) => project.title)
    ?? findUniquePartialMatch(projects, raw, (project) => project.title);
}

export async function autocompleteTasks(projectId, query) {
  if (!projectId) return [];

  const res = await getTasksByProject(projectId, {
    page: 1,
    per_page: 25,
    s: query || undefined,
  });
  const tasks = Array.isArray(res.data) ? res.data : [];
  const needle = normalize(query);

  const matches = tasks.filter((task) => {
    if (!needle) return true;
    return normalize(task.title).includes(needle);
  });

  return toChoices(matches, (task) => task.title + ' (#' + task.id + ')');
}

export async function resolveTaskSelection(projectId, selection) {
  const raw = String(selection ?? '').trim();
  if (!projectId || !raw) return null;

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