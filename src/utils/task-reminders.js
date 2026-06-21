const MAX_REMINDER_LIST_LENGTH = 120;
const MAX_REMINDER_FIELD_LENGTH = 1024;

const REMINDER_KEYS = [
  'reminders',
  'reminder_dates',
  'reminderDates',
  'reminder_date',
  'reminderDate',
  'reminder',
  'remind_at',
  'remindAt',
];

const REMINDER_VALUE_KEYS = [
  'reminder',
  'reminder_date',
  'reminderDate',
  'date',
  'at',
  'time',
  'datetime',
  'date_time',
  'dateTime',
  'remind_at',
  'remindAt',
];

const REMINDER_PAYLOAD_KEYS = [
  'reminder',
  'reminder_date',
  'reminderDate',
  'remind_at',
  'remindAt',
];

export function hasReminderField(task) {
  if (!task || typeof task !== 'object') return false;
  return REMINDER_KEYS.some((key) => Object.hasOwn(task, key));
}

export function extractTaskReminderInstants(task) {
  if (!task || typeof task !== 'object') return [];

  const raw = [];

  for (const key of REMINDER_KEYS) {
    if (!Object.hasOwn(task, key)) continue;
    const value = task[key];

    if (Array.isArray(value)) {
      raw.push(...value);
      continue;
    }

    if (value !== undefined && value !== null && value !== '') {
      raw.push(value);
    }
  }

  const instants = [];
  for (const value of raw) {
    const normalized = normalizeReminderInstant(value);
    if (normalized) instants.push(normalized);
  }

  return [...new Set(instants)].sort();
}

export function formatReminderList(reminders, maxLength = MAX_REMINDER_LIST_LENGTH) {
  if (!Array.isArray(reminders) || !reminders.length) return 'none';

  const text = reminders.map(formatReminderInstantForDisplay).join(', ');
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

export function formatTaskRemindersForEmbed(task, maxLength = MAX_REMINDER_FIELD_LENGTH) {
  const reminders = extractTaskReminderInstants(task);
  if (!reminders.length) return null;

  const lines = reminders.map((value) => '⏰ ' + formatReminderInstantForDisplay(value));
  const text = lines.join('\n');

  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1).trimEnd() + '…';
}

export function diffTaskReminderInstants(oldTask, newTask) {
  const oldReminders = extractTaskReminderInstants(oldTask);
  const newReminders = extractTaskReminderInstants(newTask);

  const oldSet = new Set(oldReminders);
  const newSet = new Set(newReminders);

  const added = newReminders.filter((value) => !oldSet.has(value));
  const removed = oldReminders.filter((value) => !newSet.has(value));

  return {
    oldReminders,
    newReminders,
    added,
    removed,
  };
}

export function extractReminderInstantFromPayload(payload, task) {
  const candidates = [];

  for (const key of REMINDER_PAYLOAD_KEYS) {
    candidates.push(payload?.data?.[key]);
    candidates.push(payload?.[key]);
  }

  for (const candidate of candidates) {
    const normalized = normalizeReminderInstant(candidate);
    if (normalized) return normalized;
  }

  const taskReminders = extractTaskReminderInstants(task);
  if (taskReminders.length === 1) {
    return taskReminders[0];
  }

  return null;
}

function normalizeReminderInstant(value) {
  if (value === undefined || value === null || value === '') return null;

  if (typeof value === 'object' && !(value instanceof Date)) {
    for (const key of REMINDER_VALUE_KEYS) {
      if (!Object.hasOwn(value, key)) continue;
      const nested = normalizeReminderInstant(value[key]);
      if (nested) return nested;
    }
    return null;
  }

  if (typeof value === 'number') {
    const numericDate = parseNumericDate(value);
    return numericDate ? numericDate.toISOString() : null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const stringValue = String(value).trim();
  if (!stringValue) return null;

  if (/^\d+$/.test(stringValue)) {
    const numericDate = parseNumericDate(Number(stringValue));
    if (numericDate) return numericDate.toISOString();
  }

  const parsed = new Date(stringValue);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function parseNumericDate(numberValue) {
  if (!Number.isFinite(numberValue)) return null;

  // Handle both Unix seconds and milliseconds.
  const millis = Math.abs(numberValue) < 100000000000 ? numberValue * 1000 : numberValue;
  const parsed = new Date(millis);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatReminderInstantForDisplay(instant) {
  const parsed = new Date(instant);
  if (Number.isNaN(parsed.getTime())) return String(instant);
  return parsed.toUTCString();
}