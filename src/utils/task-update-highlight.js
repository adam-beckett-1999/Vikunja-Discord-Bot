import { diffTaskLabelNames, formatLabelNameList } from './task-labels.js';
import { formatTaskDescription } from './embeds.js';

const MAX_UPDATED_FIELD_VALUE_LENGTH = 120;
const PRIORITY_LABELS = {
  0: 'Unset',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
  5: 'DO NOW',
};

/**
 * Build update highlight details from a webhook payload.
 *
 * @param {string|undefined} eventType
 * @param {object} payload
 * @param {object} task
 * @returns {{field: string, before: string, after: string}|null}
 */
export function getTaskUpdateHighlightFromPayload(eventType, payload, task) {
  if (eventType !== 'task.updated' || !task) return null;

  const oldTask = payload?.data?.old_task
    ?? payload?.old_task
    ?? payload?.data?.oldTask
    ?? payload?.oldTask;

  return getTaskUpdateHighlightFromTasks(oldTask, task);
}

/**
 * Build update highlight details by comparing previous and current task objects.
 *
 * @param {object} oldTask
 * @param {object} task
 * @returns {{field: string, before: string, after: string}|null}
 */
export function getTaskUpdateHighlightFromTasks(oldTask, task) {
  if (!oldTask || typeof oldTask !== 'object' || !task || typeof task !== 'object') {
    return null;
  }

  const oldHasLabelField = Object.hasOwn(oldTask, 'tags') || Object.hasOwn(oldTask, 'labels');
  const newHasLabelField = Object.hasOwn(task, 'tags') || Object.hasOwn(task, 'labels');

  // Only compare labels when both snapshots explicitly include label fields.
  // This avoids false "all labels removed" highlights from partial update payloads.
  if (oldHasLabelField && newHasLabelField) {
    const labelDiff = diffTaskLabelNames(oldTask, task);
    if (labelDiff.added.length || labelDiff.removed.length) {
      return {
        field: 'Labels',
        before: formatLabelNameList(labelDiff.oldNames),
        after: formatLabelNameList(labelDiff.newNames),
        added: labelDiff.added,
        removed: labelDiff.removed,
      };
    }
  }

  const fields = [
    'title',
    'description',
    'done',
    'priority',
    'due_date',
    'start_date',
    'end_date',
    'project_id',
  ];

  for (const field of fields) {
    if (!Object.hasOwn(oldTask, field) || !Object.hasOwn(task, field)) {
      continue;
    }
    if (!areEqualForDisplay(oldTask[field], task[field])) {
      return {
        field: formatFieldName(field),
        before: formatFieldValue(field, oldTask[field]),
        after: formatFieldValue(field, task[field]),
      };
    }
  }

  return null;
}

function formatFieldName(field) {
  return field
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function areEqualForDisplay(a, b) {
  return formatComparableValue(a) === formatComparableValue(b);
}

function formatComparableValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}

function formatFieldValue(field, value) {
  if (value === undefined || value === null || value === '') return 'empty';

  if (field === 'priority') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && Object.hasOwn(PRIORITY_LABELS, numeric)) {
      return PRIORITY_LABELS[numeric];
    }
  }

  if (field === 'description' && typeof value === 'string') {
    value = formatTaskDescription(value);
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') {
    const escaped = escapeDiscordMarkdown(value);
    return escaped.length > MAX_UPDATED_FIELD_VALUE_LENGTH
      ? escaped.slice(0, MAX_UPDATED_FIELD_VALUE_LENGTH - 1).trimEnd() + '…'
      : escaped;
  }
  return String(value);
}

function escapeDiscordMarkdown(value) {
  return value.replace(/[\\`*_~|]/g, '\\$&');
}