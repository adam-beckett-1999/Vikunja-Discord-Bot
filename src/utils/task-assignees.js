const MAX_ASSIGNEE_CHOICE_NAME_LENGTH = 100;
const MAX_ASSIGNEE_LIST_LENGTH = 120;
const MAX_ASSIGNEE_FIELD_LENGTH = 1024;

function normalize(value) {
  return String(value ?? '').trim();
}

function normalizeComparable(value) {
  return normalize(value).toLowerCase();
}

function escapeDiscordMarkdown(value) {
  return String(value ?? '').replace(/[\\`*_~|]/g, '\\$&');
}

export function hasAssigneeField(task) {
  if (!task || typeof task !== 'object') return false;

  return Object.hasOwn(task, 'assignees')
    || Object.hasOwn(task, 'assigned_users')
    || Object.hasOwn(task, 'assignedUsers')
    || Object.hasOwn(task, 'assignee');
}

export function extractTaskAssignees(task) {
  if (!task || typeof task !== 'object') return [];

  const candidates = [
    task.assignees,
    task.assigned_users,
    task.assignedUsers,
    task.assignee ? [task.assignee] : null,
  ];

  let rawAssignees = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      rawAssignees = candidate;
      break;
    }
  }

  const deduped = new Map();

  for (const raw of rawAssignees) {
    if (!raw || typeof raw !== 'object') continue;

    const id = Number(raw.id);
    const userId = Number.isFinite(id) ? id : undefined;
    const username = normalize(raw.username);
    const displayName = normalize(raw.name ?? raw.display_name ?? raw.displayName);
    const fallbackName = username || displayName;

    if (!userId && !fallbackName) continue;

    const key = userId
      ? 'id:' + userId
      : 'username:' + normalizeComparable(username || displayName);

    deduped.set(key, {
      id: userId,
      username: username || undefined,
      displayName: displayName || undefined,
      label: displayName || username || ('User #' + userId),
    });
  }

  return [...deduped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export function toAssigneeSelectionValue(assignee) {
  if (Number.isFinite(assignee?.id)) {
    return 'id:' + assignee.id;
  }

  const username = normalizeComparable(assignee?.username);
  if (username) {
    return 'username:' + username;
  }

  const displayName = normalizeComparable(assignee?.displayName);
  if (displayName) {
    return 'name:' + displayName;
  }

  return '';
}

export function formatAssigneeNameList(names, maxLength = MAX_ASSIGNEE_LIST_LENGTH) {
  const clean = names
    .map((name) => escapeDiscordMarkdown(normalize(name)))
    .filter(Boolean);

  if (!clean.length) return 'none';

  const text = clean.join(', ');
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

export function formatTaskAssigneesForEmbed(task, maxLength = MAX_ASSIGNEE_FIELD_LENGTH) {
  const assignees = extractTaskAssignees(task);
  if (!assignees.length) return null;

  const lines = assignees.map((assignee) => '👤 ' + escapeDiscordMarkdown(assignee.label));
  const value = lines.join('\n');

  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 1).trimEnd() + '…';
}

export function diffTaskAssigneeNames(oldTask, newTask) {
  const oldNames = extractTaskAssignees(oldTask).map((assignee) => assignee.label);
  const newNames = extractTaskAssignees(newTask).map((assignee) => assignee.label);

  const oldSet = new Set(oldNames.map((name) => name.toLowerCase()));
  const newSet = new Set(newNames.map((name) => name.toLowerCase()));

  const added = newNames.filter((name) => !oldSet.has(name.toLowerCase()));
  const removed = oldNames.filter((name) => !newSet.has(name.toLowerCase()));

  return { oldNames, newNames, added, removed };
}

export function formatAssigneeChoiceName(assignee) {
  const label = normalize(assignee?.label) || 'Unknown assignee';
  const suffix = Number.isFinite(assignee?.id)
    ? ' (#' + assignee.id + ')'
    : assignee?.username
      ? ' (@' + assignee.username + ')'
      : '';

  const maxLabelLength = MAX_ASSIGNEE_CHOICE_NAME_LENGTH - suffix.length;
  if (label.length <= maxLabelLength) {
    return label + suffix;
  }

  const truncated = label.slice(0, Math.max(1, maxLabelLength - 1)).trimEnd() + '…';
  return truncated + suffix;
}

export function matchAssigneeSelection(task, selectionValue) {
  const assignees = extractTaskAssignees(task);
  const normalizedSelection = normalizeComparable(selectionValue);
  if (!normalizedSelection) return null;

  return assignees.find((assignee) => {
    const choiceValue = toAssigneeSelectionValue(assignee).toLowerCase();
    if (choiceValue === normalizedSelection) return true;

    const idCandidate = Number.isFinite(assignee.id) ? String(assignee.id) : '';
    if (idCandidate && idCandidate === normalizedSelection) return true;

    if (normalizeComparable(assignee.username) === normalizedSelection) return true;
    if (normalizeComparable(assignee.displayName) === normalizedSelection) return true;

    return false;
  }) ?? null;
}