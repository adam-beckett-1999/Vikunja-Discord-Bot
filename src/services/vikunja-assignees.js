import { getAllTasks } from './vikunja.js';
import {
  extractTaskAssignees,
  formatAssigneeChoiceName,
  toAssigneeSelectionValue,
} from '../utils/task-assignees.js';

const CACHE_TTL_MS = 60_000;
const MAX_PAGES = 10;
const PER_PAGE = 100;

let assigneeCache = {
  expiresAt: 0,
  items: [],
};

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function dedupeAssignees(assignees) {
  const byKey = new Map();

  for (const assignee of assignees) {
    const key = toAssigneeSelectionValue(assignee);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, assignee);
    }
  }

  return [...byKey.values()].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''));
}

async function fetchAssigneesFromTasks() {
  const collected = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await getAllTasks({ page, per_page: PER_PAGE });
    const tasks = Array.isArray(response.data) ? response.data : [];
    if (!tasks.length) break;

    for (const task of tasks) {
      collected.push(...extractTaskAssignees(task));
    }

    if (tasks.length < PER_PAGE) break;
  }

  return dedupeAssignees(collected);
}

async function getKnownAssignees() {
  const now = Date.now();
  if (assigneeCache.expiresAt > now && assigneeCache.items.length) {
    return assigneeCache.items;
  }

  const assignees = await fetchAssigneesFromTasks();
  assigneeCache = {
    expiresAt: now + CACHE_TTL_MS,
    items: assignees,
  };
  return assignees;
}

export async function autocompleteKnownAssignees(query) {
  const assignees = await getKnownAssignees();
  const needle = normalize(query);

  const matches = assignees.filter((assignee) => {
    if (!needle) return true;

    const label = normalize(assignee.label);
    const username = normalize(assignee.username);
    const idText = Number.isFinite(assignee.id) ? String(assignee.id) : '';

    return label.includes(needle) || username.includes(needle) || idText.includes(needle);
  });

  return matches.slice(0, 25).map((assignee) => ({
    name: formatAssigneeChoiceName(assignee),
    value: toAssigneeSelectionValue(assignee),
  }));
}

export async function resolveKnownAssigneeSelection(selection) {
  const assignees = await getKnownAssignees();
  const needle = normalize(selection);
  if (!needle) return null;

  return assignees.find((assignee) => {
    const value = normalize(toAssigneeSelectionValue(assignee));
    const idText = Number.isFinite(assignee.id) ? String(assignee.id) : '';
    const username = normalize(assignee.username);
    const displayName = normalize(assignee.displayName);

    return value === needle || idText === needle || username === needle || displayName === needle;
  }) ?? null;
}