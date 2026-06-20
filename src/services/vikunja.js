import axios from 'axios';
import config from '../config.js';
import { DEFAULT_WEBHOOK_EVENTS } from './webhook-events.js';

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

// ─── Tags / Labels ────────────────────────────────────────────────────────────

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

/**
 * Fetch all tags/labels available to the authenticated user.
 * Supports Vikunja versions exposing either /labels or /tags endpoints.
 */
export async function getAllTags() {
  return requestFirstSuccess([
    () => vikunjaClient.get('/labels'),
    () => vikunjaClient.get('/tags'),
  ]);
}

/**
 * Create a tag/label by name.
 *
 * @param {string} title
 * @param {string|undefined} hexColor
 */
export async function createTag(title, hexColor) {
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
 * Replace task tags/labels using the best available payload shape.
 *
 * @param {number} taskId
 * @param {{id?: number|string, title?: string}[]} tags
 */
export async function replaceTaskTags(taskId, tags) {
  const ids = tags
    .map((tag) => Number(tag?.id))
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
