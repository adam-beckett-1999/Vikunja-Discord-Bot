import express from 'express';
import crypto from 'node:crypto';
import config from '../config.js';
import { getProject, getTask } from '../services/vikunja.js';
import { buildReminderFiredEmbed, buildTaskEmbed } from '../utils/embeds.js';
import {
  cacheTaskSnapshot,
  clearTaskSnapshot,
  getCachedTaskSnapshot,
  shouldSuppressWebhookUpdate,
} from '../services/task-update-context.js';
import { cacheProject, getCachedProjectTitle } from '../services/project-cache.js';
import { getTaskUpdateHighlightFromTasks } from '../utils/task-update-highlight.js';
import { getTaskUpdateHighlightFromPayload } from '../utils/task-update-highlight.js';
import { getMappedDiscordUserIdsForTask } from '../services/assignee-links.js';
import { getChannelIdForProject } from '../services/project-channel-links.js';
import { extractReminderInstantFromPayload } from '../utils/task-reminders.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Action label map for embed titles.
 */
const EVENT_ACTION = {
  'task.created': 'Created',
  'task.updated': 'Updated',
  'task.deleted': 'Deleted',
};

/**
 * Resolve the webhook event type from the Vikunja payload.
 * Vikunja documents and tests currently use `event_name`, while older or
 * alternative producers may use `event_type` or `type`.
 *
 * @param {object} payload
 * @returns {string|undefined}
 */
export function getWebhookEventType(payload) {
  return payload?.event_name ?? payload?.event_type ?? payload?.type;
}

/**
 * Verify the HMAC-SHA256 signature sent by Vikunja to ensure the request is
 * legitimate.  Vikunja signs the raw body with the webhook secret and places
 * the hex digest in the `X-Vikunja-Signature` header.
 *
 * If no secret is configured the check is skipped (useful during development).
 *
 * @param {string} rawBody
 * @param {string|undefined} signature
 * @returns {boolean}
 */
function isSignatureValid(rawBody, signature) {
  if (!config.webhook.secret) return true; // No secret configured – skip check.
  if (!signature) return false;
  const expected = crypto
    .createHmac('sha256', config.webhook.secret)
    .update(rawBody, 'utf8')
    .digest('hex');
  // Strip optional "sha256=" prefix and validate that only hex characters remain.
  const receivedHex = signature.replace(/^sha256=/, '');
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;
  // Use timingSafeEqual to prevent timing attacks.
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Create and start the webhook Express server.
 *
 * @param {import('discord.js').Client} discordClient
 * @returns {import('express').Application}
 */
export function startWebhookServer(discordClient) {
  const app = express();

  // Capture raw body for signature verification before JSON parsing.
  app.use('/webhook', express.raw({ type: 'application/json' }));

  app.post('/webhook', async (req, res) => {
    const rawBody = req.body.toString('utf8');
    const signature = req.headers['x-vikunja-signature'];

    if (!isSignatureValid(rawBody, signature)) {
      console.warn('[Webhook] Rejected request: invalid signature', {
        secretConfigured: Boolean(config.webhook.secret),
        signaturePresent: Boolean(signature),
      });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventType = getWebhookEventType(payload);
    const requestSummary = summarizeWebhookRequest(payload, eventType, signature);

    console.log('[Webhook] Received event: ' + (eventType ?? 'unknown') + ' | ' + requestSummary);

    if (config.webhook.debugLogging) {
      console.log('[Webhook][debug] Raw payload: ' + rawBody);
    }

    res.status(200).json({ status: 'ok' });

    // Post notification asynchronously so we don't block the HTTP response.
    setImmediate(async () => {
      try {
        await postNotification(discordClient, eventType, payload);
      } catch (err) {
        console.error('[Webhook] Failed to post Discord notification', err);
      }
    });
  });

  const port = config.webhook.port;
  app.listen(port, () => {
    console.log('[Webhook] Listening on port ' + port);
  });

  return app;
}

/**
 * Send a notification embed to the configured Discord channel.
 *
 * @param {import('discord.js').Client} discordClient
 * @param {string} eventType
 * @param {object} payload  - Parsed Vikunja webhook payload
 */
async function postNotification(discordClient, eventType, payload) {
  const task = payload.data?.task ?? payload.task ?? payload.data;
  const channelId = await resolveNotificationChannelId(payload, task, eventType);
  if (!channelId) {
    console.warn('[Webhook] No channel mapping found for payload ' + summarizeWebhookRequest(payload, eventType) + ' and NOTIFICATION_CHANNEL_ID is not set – skipping notification.');
    return;
  }

  console.log('[Webhook] Routing ' + (eventType ?? 'unknown') + ' to channel ' + channelId + ' | ' + summarizeWebhookRequest(payload, eventType));

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('[Webhook] Notification channel not found or not text-based: ' + channelId);
    return;
  }

  if (eventType === 'task.updated' && task?.id && shouldSuppressWebhookUpdate(task.id)) {
    cacheTaskSnapshot(task);
    return;
  }

  let taskForEmbed = task;

  let embed;
  if (task && eventType === 'task.deleted') {
    // On deletion, the task may only have an ID – build a minimal embed.
    embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Deleted: ' + (task.title ?? 'Task ' + task.id))
      .setFooter({ text: 'Task ID: ' + task.id })
      .setTimestamp();
    if (task.id !== undefined) {
      clearTaskSnapshot(task.id);
    }
  } else if (task) {
    if (eventType === 'task.reminder.fired') {
      let reminderTask = task;
      let mentionedUserIds = await getMappedDiscordUserIdsForTask(reminderTask);

      // Reminder-fired payloads can omit assignee arrays; retry with full task details.
      if (!mentionedUserIds.length && task.id !== undefined) {
        const latestTask = await getTask(task.id)
          .then((res) => res.data)
          .catch(() => null);

        if (latestTask) {
          reminderTask = latestTask;
          mentionedUserIds = await getMappedDiscordUserIdsForTask(reminderTask);
        }
      }

      const projectName = await resolveProjectName(reminderTask);
      const reminderInstant = extractReminderInstantFromPayload(payload, reminderTask);
      embed = buildReminderFiredEmbed(reminderTask, projectName, reminderInstant, payload?.time);

      const mentionContent = mentionedUserIds.map((id) => '<@' + id + '>').join(' ');

      await channel.send({
        content: mentionContent || undefined,
        embeds: [embed],
        allowedMentions: mentionedUserIds.length
          ? { users: mentionedUserIds }
          : undefined,
      });

      cacheTaskSnapshot(reminderTask);
      return;
    }

    let updateHighlight = getTaskUpdateHighlight(eventType, payload, task);

    if (!updateHighlight && eventType === 'task.updated' && task.id !== undefined) {
      const previousTask = getCachedTaskSnapshot(task.id);

      if (previousTask) {
        // Vikunja update payloads can be partial. Fetch full latest state so we
        // can still produce a useful before/after highlight when old_task is missing.
        const latestTask = await getTask(task.id)
          .then((res) => res.data)
          .catch(() => null);

        const candidateTask = latestTask ?? task;
        updateHighlight = getTaskUpdateHighlightFromTasks(previousTask, candidateTask);
        taskForEmbed = candidateTask;
      }
    }

    const projectName = await resolveProjectName(taskForEmbed);
    embed = buildTaskEmbed(taskForEmbed, getEventActionLabel(eventType), projectName, updateHighlight);
    cacheTaskSnapshot(taskForEmbed);
  } else {
    embed = buildGenericEventEmbed(eventType, payload);
  }

  await channel.send({ embeds: [embed] });
}

async function resolveNotificationChannelId(payload, task, eventType) {
  const projectId = getProjectIdFromPayload(payload);

  if (projectId !== null) {
    const mappedChannelId = await getChannelIdForProject(projectId).catch(() => null);
    if (mappedChannelId) {
      if (config.webhook.debugLogging) {
        console.log('[Webhook][debug] Resolved channel ' + mappedChannelId + ' from project ' + projectId + '.');
      }
      return mappedChannelId;
    }

    if (config.webhook.notificationChannelId) {
      console.warn('[Webhook] No mapped channel for project ' + projectId + '; using legacy NOTIFICATION_CHANNEL_ID fallback.');
    }
  }

  const taskId = getTaskIdFromPayload(payload, task);
  if (taskId !== null) {
    const hydratedTask = await getTask(taskId)
      .then((res) => res.data)
      .catch(() => null);

    const hydratedProjectId = hydratedTask?.project_id ?? hydratedTask?.project?.id;
    if (hydratedProjectId !== undefined && hydratedProjectId !== null) {
      const mappedChannelId = await getChannelIdForProject(hydratedProjectId).catch(() => null);
      if (mappedChannelId) {
        console.warn('[Webhook] Resolved channel for ' + (eventType ?? 'unknown') + ' via hydrated task ' + taskId + ' -> project ' + hydratedProjectId + '.');
        return mappedChannelId;
      }
    }
  }

  return config.webhook.notificationChannelId ?? null;
}

function getProjectIdFromPayload(payload) {
  const candidates = [
    payload?.data?.task?.project_id,
    payload?.task?.project_id,
    payload?.data?.project_id,
    payload?.project_id,
    payload?.data?.project?.id,
    payload?.project?.id,
    payload?.data?.task?.project?.id,
    payload?.task?.project?.id,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function getTaskIdFromPayload(payload, task) {
  const candidates = [
    task?.id,
    payload?.data?.task_id,
    payload?.task_id,
    payload?.data?.task?.id,
    payload?.task?.id,
    payload?.data?.id,
    payload?.id,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }

  return null;
}

function summarizeWebhookRequest(payload, eventType, signature) {
  const projectId = getProjectIdFromPayload(payload);
  const taskId = getTaskIdFromPayload(payload, payload?.data?.task ?? payload?.task ?? payload?.data);
  const payloadKeys = summarizeKeys(payload);
  const dataKeys = summarizeKeys(payload?.data);

  return [
    'event=' + (eventType ?? 'unknown'),
    'projectId=' + (projectId ?? 'n/a'),
    'taskId=' + (taskId ?? 'n/a'),
    'payloadKeys=' + payloadKeys,
    'dataKeys=' + dataKeys,
    'signature=' + (signature ? 'present' : 'missing'),
  ].join(' | ');
}

function summarizeKeys(value) {
  if (!value || typeof value !== 'object') return 'none';
  return Object.keys(value).sort().join(',') || 'none';
}

/**
 * Derive an action label for embed titles from the webhook event name.
 *
 * @param {string|undefined} eventType
 * @returns {string}
 */
function getEventActionLabel(eventType) {
  if (!eventType) return 'Updated';
  if (EVENT_ACTION[eventType]) return EVENT_ACTION[eventType];

  const withoutEntity = eventType.includes('.')
    ? eventType.split('.').slice(1).join(' ')
    : eventType;

  return withoutEntity
    .split(/[._-]/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

export function getTaskUpdateHighlight(eventType, payload, task) {
  return getTaskUpdateHighlightFromPayload(eventType, payload, task);
}

async function resolveProjectName(task) {
  const directTitle = task?.project?.title ?? task?.project_title;
  if (typeof directTitle === 'string' && directTitle.trim()) {
    cacheProject({ id: task?.project_id ?? task?.project?.id, title: directTitle });
    return directTitle;
  }

  const projectId = task?.project_id ?? task?.project?.id;
  if (projectId === undefined || projectId === null) {
    return undefined;
  }

  const cached = getCachedProjectTitle(projectId);
  if (cached) {
    return cached;
  }

  const fetched = await getProject(projectId)
    .then((res) => res.data)
    .catch(() => null);

  if (fetched?.title) {
    cacheProject(fetched);
    return fetched.title;
  }

  return undefined;
}

/**
 * Build a generic embed for events that do not include a task object.
 *
 * @param {string|undefined} eventType
 * @param {object} payload
 * @returns {EmbedBuilder}
 */
function buildGenericEventEmbed(eventType, payload) {
  const projectId = payload?.project_id ?? payload?.data?.project_id ?? payload?.data?.project?.id;
  const payloadId = payload?.data?.id ?? payload?.id;

  const fields = [];
  if (projectId !== undefined) {
    fields.push({ name: 'Project ID', value: String(projectId), inline: true });
  }
  if (payloadId !== undefined) {
    fields.push({ name: 'Entity ID', value: String(payloadId), inline: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Vikunja Event: ' + (eventType ?? 'unknown'))
    .setDescription('Received a webhook event without task details.')
    .setTimestamp();

  if (fields.length) {
    embed.addFields(fields);
  }

  return embed;
}
