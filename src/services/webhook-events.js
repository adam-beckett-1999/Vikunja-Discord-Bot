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
 * Build autocomplete choices for a single event token option.
 *
 * @param {string} currentValue
 * @returns {Array<{name: string, value: string}>}
 */
export function autocompleteWebhookEventToken(currentValue) {
  const query = (currentValue ?? '').trim().toLowerCase();

  return WEBHOOK_EVENT_SUGGESTIONS
    .filter((eventName) => !query || eventName.toLowerCase().includes(query))
    .slice(0, 25)
    .map((eventName) => ({
      name: eventName,
      value: eventName,
    }));
}