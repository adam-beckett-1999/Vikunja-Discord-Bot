export const DEFAULT_WEBHOOK_EVENTS = ['task.created', 'task.updated', 'task.deleted', 'task.reminder.fired'];

// Event list aligned with the Vikunja webhook UI shown by the user.
export const WEBHOOK_EVENT_SUGGESTIONS = [
  'project.deleted',
  'project.shared.team',
  'project.shared.user',
  'project.updated',
  'task.assignee.created',
  'task.assignee.deleted',
  'task.attachment.created',
  'task.attachment.deleted',
  'task.comment.created',
  'task.comment.deleted',
  'task.comment.edited',
  'task.created',
  'task.deleted',
  'task.overdue',
  'task.relation.created',
  'task.relation.deleted',
  'task.reminder.fired',
  'task.updated',
  'tasks.overdue',
];

const SUPPORTED_WEBHOOK_EVENTS = new Set(WEBHOOK_EVENT_SUGGESTIONS);

export const WEBHOOK_EVENT_DESCRIPTIONS = {
  'task.created': 'A new task was created.',
  'task.updated': 'An existing task was edited.',
  'task.deleted': 'A task was deleted.',
  'task.overdue': 'A task became overdue.',
  'tasks.overdue': 'One or more tasks became overdue.',
  'task.comment.created': 'A comment was added to a task.',
  'task.comment.edited': 'A task comment was edited.',
  'task.comment.deleted': 'A task comment was deleted.',
  'task.assignee.created': 'A user was assigned to a task.',
  'task.assignee.deleted': 'A user was unassigned from a task.',
  'task.attachment.created': 'An attachment was added to a task.',
  'task.attachment.deleted': 'An attachment was removed from a task.',
  'task.relation.created': 'A task relation was created.',
  'task.relation.deleted': 'A task relation was removed.',
  'task.reminder.fired': 'A task reminder was fired.',
  'project.updated': 'A project was updated.',
  'project.deleted': 'A project was deleted.',
  'project.shared.team': 'A project was shared with a team.',
  'project.shared.user': 'A project was shared with a user.',
};

const EVENT_TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

/**
 * Parse a comma-separated event list from slash command input.
 *
 * @param {string|null|undefined} rawInput
 * @returns {{events: string[], invalid: string[], unsupported: string[]}}
 */
export function parseWebhookEventsInput(rawInput) {
  if (!rawInput || !rawInput.trim()) {
    return { events: DEFAULT_WEBHOOK_EVENTS, invalid: [], unsupported: [] };
  }

  const tokens = rawInput
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  const invalid = [];
  const unsupported = [];
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

    if (!SUPPORTED_WEBHOOK_EVENTS.has(normalized)) {
      unsupported.push(normalized);
      continue;
    }

    deduped.push(normalized);
  }

  return { events: deduped, invalid, unsupported };
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
    'If omitted, defaults are: `task.created`, `task.updated`, `task.deleted`, `task.reminder.fired`.',
    'Only the supported event names below are accepted.',
    '',
    'Supported events:',
  ];

  for (const eventName of WEBHOOK_EVENT_SUGGESTIONS) {
    const description = WEBHOOK_EVENT_DESCRIPTIONS[eventName] ?? 'Event description not documented.';
    lines.push('- `' + eventName + '` - ' + description);
  }

  return lines.join('\n');
}