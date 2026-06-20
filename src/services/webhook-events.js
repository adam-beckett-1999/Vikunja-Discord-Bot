export const DEFAULT_WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.deleted'];

// Suggested values for command autocomplete. These are examples only; users can
// still enter custom Vikunja event names supported by their server version.
export const WEBHOOK_EVENT_SUGGESTIONS = [
  ...DEFAULT_WEBHOOK_EVENTS,
  'task.comment.created',
  'task.comment.updated',
  'task.comment.deleted',
  'task.assignee.created',
  'task.assignee.deleted',
  'task.attachment.created',
  'task.attachment.deleted',
  'task.reminder.created',
  'task.reminder.deleted',
  'project.created',
  'project.updated',
  'project.deleted',
];

export const WEBHOOK_EVENT_DESCRIPTIONS = {
  'task.created': 'A new task was created.',
  'task.updated': 'An existing task was edited.',
  'task.deleted': 'A task was deleted.',
  'task.comment.created': 'A comment was added to a task.',
  'task.comment.updated': 'A task comment was edited.',
  'task.comment.deleted': 'A task comment was deleted.',
  'task.assignee.created': 'A user was assigned to a task.',
  'task.assignee.deleted': 'A user was unassigned from a task.',
  'task.attachment.created': 'An attachment was added to a task.',
  'task.attachment.deleted': 'An attachment was removed from a task.',
  'task.reminder.created': 'A reminder was created for a task.',
  'task.reminder.deleted': 'A reminder was removed from a task.',
  'project.created': 'A project was created.',
  'project.updated': 'A project was updated.',
  'project.deleted': 'A project was deleted.',
};

const EVENT_TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

/**
 * Parse a comma-separated event list from slash command input.
 *
 * @param {string|null|undefined} rawInput
 * @returns {{events: string[], invalid: string[]}}
 */
export function parseWebhookEventsInput(rawInput) {
  if (!rawInput || !rawInput.trim()) {
    return { events: DEFAULT_WEBHOOK_EVENTS, invalid: [] };
  }

  const tokens = rawInput
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  const invalid = [];
  const deduped = [];
  const seen = new Set();

  for (const token of tokens) {
    if (!EVENT_TOKEN_PATTERN.test(token)) {
      invalid.push(token);
      continue;
    }

    const normalized = token.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
  }

  if (!deduped.length) {
    return { events: DEFAULT_WEBHOOK_EVENTS, invalid };
  }

  return { events: deduped, invalid };
}

/**
 * Build a user-facing help string for webhook event input and common meanings.
 *
 * @returns {string}
 */
export function formatWebhookEventsHelp() {
  const lines = [
    'Format: comma-separated event names.',
    'Example: `task.created, task.updated, task.comment.created`',
    'If omitted, defaults are: `task.created`, `task.updated`, `task.deleted`.',
    '',
    'Common events:',
  ];

  for (const eventName of WEBHOOK_EVENT_SUGGESTIONS) {
    const description = WEBHOOK_EVENT_DESCRIPTIONS[eventName] ?? 'Event description not documented.';
    lines.push('- `' + eventName + '` - ' + description);
  }

  return lines.join('\n');
}