import axios from 'axios';
import config from '../config.js';

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
    events: events ?? ['task.created', 'task.updated', 'task.deleted'],
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
