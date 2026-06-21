import axios from 'axios';
import config from '../config.js';
import { DEFAULT_WEBHOOK_EVENTS } from './webhook-events.js';
import { extractTaskReminderInstants } from '../utils/task-reminders.js';

/**
 * Axios instance pre-configured for the Vikunja REST API.
 * All requests are authenticated via the API token defined in .env.
 */
const vikunjaClient = axios.create({
  baseURL: config.vikunja.baseUrl + '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach the Authorization header dynamically so config can be loaded first.
vikunjaClient.interceptors.request.use((requestConfig) => {
  requestConfig.headers.Authorization = 'Bearer ' + config.vikunja.apiToken;
  return requestConfig;
});

// ─── Projects ─────────────────────────────────────────────────────────────────

/**
 * Fetch all projects the authenticated user can access.
 * @returns {Promise<import('axios').AxiosResponse>}
 */
export async function getAllProjects() {
  return vikunjaClient.get('/projects');
}

/**
 * Fetch a single project by ID.
 * @param {number} projectId
 */
export async function getProject(projectId) {
  return vikunjaClient.get('/projects/' + projectId);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

/**
 * Fetch all tasks the authenticated user can access across all projects.
 *
 * @param {object} [params]
 * @param {number} [params.page]
 * @param {number} [params.per_page]
 * @param {string} [params.s]           - Search string
 * @param {string} [params.filter]      - Filter expression
 * @param {string} [params.sort_by]
 * @param {string} [params.order_by]
 */
export async function getAllTasks(params) {
  return vikunjaClient.get('/tasks/all', { params });
}

/**
 * Fetch all tasks inside a specific project.
 *
 * @param {number} projectId
 * @param {object} [params]
 * @param {number} [params.page]
 * @param {number} [params.per_page]
 * @param {string} [params.s]           - Search string
 */
export async function getTasksByProject(projectId, params) {
  return vikunjaClient.get('/projects/' + projectId + '/tasks', { params });
}

/**
 * Fetch a single task by ID.
 * @param {number} taskId
 */
export async function getTask(taskId) {
  return vikunjaClient.get('/tasks/' + taskId);
}

/**
 * Fetch all assignees for a task.
 * @param {number} taskId
 */
export async function getTaskAssignees(taskId) {
  return vikunjaClient.get('/tasks/' + taskId + '/assignees');
}

/**
 * Create a new task inside a project.
 *
 * @param {number} projectId
 * @param {object} taskData
 * @param {string} taskData.title
 * @param {string} [taskData.description]
 * @param {string} [taskData.due_date]   - ISO 8601 date string
 * @param {number} [taskData.priority]   - 0–5
 */
export async function createTask(projectId, taskData) {
  return vikunjaClient.put('/projects/' + projectId + '/tasks', taskData);
}

/**
 * Update an existing task.
 *
 * @param {number} taskId
 * @param {object} taskData
 */
export async function updateTask(taskId, taskData) {
  return vikunjaClient.post('/tasks/' + taskId, taskData);
}

/**
 * Delete a task by ID.
 * @param {number} taskId
 */
export async function deleteTask(taskId) {
  return vikunjaClient.delete('/tasks/' + taskId);
}

/**
 * Replace the reminders on an existing task using the best available Vikunja
 * payload shapes.
 *
 * @param {number} taskId
 * @param {string[]} reminders
 */
export async function replaceTaskReminders(taskId, reminders) {
  const task = await getTask(taskId).then((res) => res.data);
  return replaceTaskRemindersOnTask(taskId, task, reminders);
}

/**
 * Add a reminder to an existing task.
 *
 * @param {number} taskId
 * @param {string} reminderInstant
 */
export async function addTaskReminder(taskId, reminderInstant) {
  const task = await getTask(taskId).then((res) => res.data);
  const existingReminders = extractTaskReminderInstants(task);
  return replaceTaskRemindersOnTask(taskId, task, [...existingReminders, reminderInstant]);
}

/**
 * Remove a reminder from an existing task.
 *
 * @param {number} taskId
 * @param {string} reminderInstant
 */
export async function removeTaskReminder(taskId, reminderInstant) {
  const task = await getTask(taskId).then((res) => res.data);
  const existingReminders = extractTaskReminderInstants(task);
  const nextReminders = existingReminders.filter((value) => value !== reminderInstant);
  return replaceTaskRemindersOnTask(taskId, task, nextReminders);
}

// ─── Assignees ────────────────────────────────────────────────────────────────

/**
 * Link a user as assignee to a task.
 * Uses endpoint and payload fallbacks to support Vikunja version differences.
 *
 * @param {number} taskId
 * @param {number|string} userId
 */
export async function addAssigneeToTask(taskId, userId) {
  const id = Number(userId);

  return requestFirstMutationSuccess([
    () => vikunjaClient.put('/tasks/' + taskId + '/assignees', { id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/assignees', { user_id: id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/assignees', { id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/assignees', { user_id: id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/assignees/' + id),
    () => vikunjaClient.post('/tasks/' + taskId + '/assignees/' + id),
  ]);
}

/**
 * Unlink a user assignee from a task.
 *
 * @param {number} taskId
 * @param {number|string} userId
 */
export async function removeAssigneeFromTask(taskId, userId) {
  const id = Number(userId);

  return requestFirstMutationSuccess([
    () => vikunjaClient.delete('/tasks/' + taskId + '/assignees/' + id),
  ]);
}

// ─── Labels ───────────────────────────────────────────────────────────────────

function isEndpointNotFound(err) {
  return Number(err?.response?.status) === 404;
}

async function requestFirstSuccess(operations) {
  let lastError;

  for (const operation of operations) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isEndpointNotFound(err)) {
        throw err;
      }
    }
  }

  throw lastError;
}

async function requestFirstMutationSuccess(operations) {
  let lastError;

  for (const operation of operations) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const status = Number(err?.response?.status);
      // Try next candidate for common route/payload compatibility failures.
      if (![400, 404, 405, 422].includes(status)) {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Fetch all labels available to the authenticated user.
 * Supports Vikunja versions exposing either /labels or /tags endpoints.
 */
export async function getAllLabels() {
  return requestFirstSuccess([
    () => vikunjaClient.get('/labels'),
    () => vikunjaClient.get('/tags'),
  ]);
}

/**
 * Create a label by name.
 *
 * @param {string} title
 * @param {string|undefined} hexColor
 */
export async function createLabel(title, hexColor) {
  const payload = { title };
  if (hexColor) payload.hex_color = hexColor;

  return requestFirstSuccess([
    () => vikunjaClient.put('/labels', payload),
    () => vikunjaClient.post('/labels', payload),
    () => vikunjaClient.put('/tags', payload),
    () => vikunjaClient.post('/tags', payload),
  ]);
}

/**
 * Replace task labels using the best available payload shape.
 *
 * @param {number} taskId
 * @param {{id?: number|string, title?: string}[]} labels
 */
export async function replaceTaskLabels(taskId, labels) {
  const ids = labels
    .map((label) => Number(label?.id))
    .filter((id) => Number.isFinite(id));

  const labelsPayload = ids.map((id) => ({ id }));
  const updatePayloads = [
    { labels: labelsPayload },
    { labels: ids },
    { tags: labelsPayload },
    { tags: ids },
  ];

  let lastError;
  for (const payload of updatePayloads) {
    try {
      return await updateTask(taskId, payload);
    } catch (err) {
      lastError = err;
      const status = Number(err?.response?.status);
      if (![400, 404, 422].includes(status)) {
        throw err;
      }
    }
  }

  throw lastError;
}

/**
 * Link a label to a task.
 * Uses endpoint and payload fallbacks to support Vikunja version differences.
 *
 * @param {number} taskId
 * @param {number|string} labelId
 */
export async function addLabelToTask(taskId, labelId) {
  const id = Number(labelId);

  return requestFirstMutationSuccess([
    () => vikunjaClient.put('/tasks/' + taskId + '/labels', { id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/labels', { label_id: id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/labels', { id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/labels', { label_id: id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/labels/' + id),
    () => vikunjaClient.post('/tasks/' + taskId + '/labels/' + id),
    () => vikunjaClient.put('/tasks/' + taskId + '/tags', { id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/tags', { tag_id: id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/tags', { id }),
    () => vikunjaClient.post('/tasks/' + taskId + '/tags', { tag_id: id }),
    () => vikunjaClient.put('/tasks/' + taskId + '/tags/' + id),
    () => vikunjaClient.post('/tasks/' + taskId + '/tags/' + id),
  ]);
}

/**
 * Unlink a label from a task.
 *
 * @param {number} taskId
 * @param {number|string} labelId
 */
export async function removeLabelFromTask(taskId, labelId) {
  const id = Number(labelId);

  return requestFirstMutationSuccess([
    () => vikunjaClient.delete('/tasks/' + taskId + '/labels/' + id),
    () => vikunjaClient.delete('/tasks/' + taskId + '/tags/' + id),
  ]);
}

// Backward-compatible aliases while command names transition to label terminology.
export const getAllTags = getAllLabels;
export const createTag = createLabel;
export const replaceTaskTags = replaceTaskLabels;
export const addTagToTask = addLabelToTask;
export const removeTagFromTask = removeLabelFromTask;

// ─── Webhooks ─────────────────────────────────────────────────────────────────

/**
 * Register a Vikunja webhook for a project so that Vikunja POSTs events to
 * this bot's Express server.
 *
 * @param {number} projectId
 * @param {string} targetUrl  - Publicly reachable URL of this bot's webhook endpoint
 * @param {string[]} [events] - Defaults to all task events
 */
export async function createWebhook(projectId, targetUrl, events) {
  const payload = {
    target_url: targetUrl,
    events: events ?? DEFAULT_WEBHOOK_EVENTS,
  };

  if (config.webhook.secret) {
    payload.secret = config.webhook.secret;
  }

  return vikunjaClient.put('/projects/' + projectId + '/webhooks', payload);
}

/**
 * List all webhooks registered for a project.
 * @param {number} projectId
 */
export async function listWebhooks(projectId) {
  return vikunjaClient.get('/projects/' + projectId + '/webhooks');
}

/**
 * Delete a webhook by ID from a project.
 * @param {number} projectId
 * @param {number} webhookId
 */
export async function deleteWebhook(projectId, webhookId) {
  return vikunjaClient.delete('/projects/' + projectId + '/webhooks/' + webhookId);
}

function normalizeReminderList(reminders) {
  const list = Array.isArray(reminders) ? reminders : [];
  return [...new Set(list.map((value) => String(value).trim()).filter(Boolean))].sort();
}

function buildReminderUpdatePayloads(reminders) {
  const reminderObjects = reminders.map((reminder) => ({ reminder }));
  const payloads = [
    { reminders: reminderObjects },
    { reminders },
    { reminder_dates: reminders },
    { reminderDates: reminders },
  ];

  if (reminders.length === 0) {
    payloads.push(
      { reminder_date: null },
      { reminderDate: null },
      { remind_at: null },
      { remindAt: null }
    );
    return payloads;
  }

  if (reminders.length === 1) {
    const [reminder] = reminders;
    payloads.push(
      { reminder },
      { reminder_date: reminder },
      { reminderDate: reminder },
      { remind_at: reminder },
      { remindAt: reminder }
    );
  }

  return payloads;
}

async function replaceTaskRemindersOnTask(taskId, task, reminders) {
  const normalizedReminders = normalizeReminderList(reminders);
  const baseTaskPayload = buildSafeTaskUpdatePayload(task);
  const payloads = buildReminderUpdatePayloads(normalizedReminders)
    .map((reminderPayload) => ({
      ...baseTaskPayload,
      ...reminderPayload,
    }));

  let lastError;

  for (const payload of payloads) {
    try {
      await updateTask(taskId, payload);

      const updatedTask = await getTask(taskId).then((res) => res.data);
      const updatedReminders = normalizeReminderList(extractTaskReminderInstants(updatedTask));

      if (areStringArraysEqual(updatedReminders, normalizedReminders)) {
        return { data: updatedTask };
      }

      lastError = new Error('Reminder update was accepted but did not persist.');
    } catch (err) {
      lastError = err;
      const status = Number(err?.response?.status);
      if (![400, 404, 405, 422].includes(status)) {
        throw err;
      }
    }
  }

  throw lastError ?? new Error('Failed to update task reminders.');
}

function buildSafeTaskUpdatePayload(task) {
  if (!task || typeof task !== 'object') {
    throw new Error('Could not load current task before updating reminders.');
  }

  const payload = {};
  const fieldNames = [
    'title',
    'description',
    'done',
    'due_date',
    'start_date',
    'end_date',
    'priority',
    'percent_done',
    'repeat_after',
    'repeat_mode',
    'hex_color',
    'project_id',
    'bucket_id',
    'position',
    'assignees',
    'labels',
  ];

  for (const fieldName of fieldNames) {
    if (Object.hasOwn(task, fieldName)) {
      payload[fieldName] = task[fieldName];
    }
  }

  if (!payload.title && typeof task.title === 'string') {
    payload.title = task.title;
  }

  if (!payload.title) {
    throw new Error('Could not update reminders because the current task title is missing.');
  }

  // Vikunja can treat task updates as replace-like for some mutable arrays.
  // Preserve the current task state so reminder writes only change reminders.
  if (Object.hasOwn(task, 'bucket_id') && !Object.hasOwn(payload, 'bucket_id')) {
    payload.bucket_id = task.bucket_id;
  }

  if (Object.hasOwn(task, 'position') && !Object.hasOwn(payload, 'position')) {
    payload.position = task.position;
  }

  return payload;
}

function areStringArraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}
