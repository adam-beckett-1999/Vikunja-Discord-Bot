import express from 'express';
import crypto from 'node:crypto';
import config from '../config.js';
import { getProject, getTask } from '../services/vikunja.js';
import {
  buildReminderFiredEmbed,
  buildTaskEmbed,
  buildTaskOpenLinkComponents,
  formatTaskDescription,
} from '../utils/embeds.js';
import {
  cacheTaskSnapshot,
  clearTaskSnapshot,
  getCachedTaskSnapshot,
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

const WEBHOOK_EVENT_COLOURS = {
  info: 0x3498db,
  success: 0x2ecc71,
  warning: 0xf39c12,
  danger: 0xe74c3c,
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

  logWebhook('info', 'Webhook server starting on port ' + config.webhook.port);

  // Capture raw body for signature verification before JSON parsing.
  app.use('/webhook', express.raw({ type: 'application/json' }));
  app.use('/webhook', (req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      logWebhook('info', 'HTTP ' + req.method + ' ' + req.originalUrl + ' -> ' + res.statusCode + ' in ' + (Date.now() - startedAt) + 'ms');
    });
    next();
  });

  app.post('/webhook', async (req, res) => {
    const rawBody = req.body.toString('utf8');
    const signature = req.headers['x-vikunja-signature'];
    const contentLength = req.headers['content-length'] ?? 'unknown';
    const contentType = req.headers['content-type'] ?? 'unknown';

    logWebhook('info', 'Incoming webhook request | contentType=' + contentType + ' | contentLength=' + contentLength + ' | signature=' + (signature ? 'present' : 'missing'));

    if (!isSignatureValid(rawBody, signature)) {
      logWebhook('warn', 'Rejected request: invalid signature | secretConfigured=' + Boolean(config.webhook.secret) + ' | signaturePresent=' + Boolean(signature));
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      logWebhook('warn', 'Rejected request: invalid JSON body');
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventType = getWebhookEventType(payload);
    const requestSummary = summarizeWebhookRequest(payload, eventType, signature);

    logWebhook('info', 'Received event: ' + (eventType ?? 'unknown') + ' | ' + requestSummary);

    res.status(200).json({ status: 'ok' });

    // Post notification asynchronously so we don't block the HTTP response.
    setImmediate(async () => {
      try {
        await postNotification(discordClient, eventType, payload);
      } catch (err) {
        logWebhook('error', 'Failed to post Discord notification: ' + (err?.stack ?? err?.message ?? String(err)));
      }
    });
  });

  const port = config.webhook.port;
  app.listen(port, () => {
    logWebhook('info', 'Listening on port ' + port);
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
    logWebhook('warn', 'No project-channel mapping found for payload ' + summarizeWebhookRequest(payload, eventType) + ' – skipping notification.');
    return;
  }

  logWebhook('info', 'Routing ' + (eventType ?? 'unknown') + ' to channel ' + channelId + ' | ' + summarizeWebhookRequest(payload, eventType));

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    logWebhook('error', 'Notification channel not found or not text-based: ' + channelId);
    return;
  }

  const special = await buildSpecialWebhookNotification(eventType, payload, task);
  if (special) {
    if (special.cacheTask?.id !== undefined) {
      cacheTaskSnapshot(special.cacheTask);
    }

    await channel.send({
      content: special.content,
      embeds: [special.embed],
      components: special.taskForOpenButton ? buildTaskOpenLinkComponents(special.taskForOpenButton) : undefined,
      allowedMentions: special.allowedMentions,
    });
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
        components: buildTaskOpenLinkComponents(reminderTask),
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

  await channel.send({
    embeds: [embed],
    components: taskForEmbed ? buildTaskOpenLinkComponents(taskForEmbed) : undefined,
  });
}

async function resolveNotificationChannelId(payload, task, eventType) {
  const projectId = getProjectIdFromPayload(payload);

  if (projectId !== null) {
    const mappedChannelId = await getChannelIdForProject(projectId).catch(() => null);
    if (mappedChannelId) {
      return mappedChannelId;
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
        logWebhook('warn', 'Resolved channel for ' + (eventType ?? 'unknown') + ' via hydrated task ' + taskId + ' -> project ' + hydratedProjectId + '.');
        return mappedChannelId;
      }
    }
  }

  return null;
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

function logWebhook(level, message) {
  if (level === 'error') {
    console.error('[Webhook] ' + message);
  } else if (level === 'warn') {
    console.warn('[Webhook] ' + message);
  } else {
    console.log('[Webhook] ' + message);
  }
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

async function buildSpecialWebhookNotification(eventType, payload, taskFromPayload) {
  const kind = String(eventType ?? '').toLowerCase();

  if (kind === 'task.comment.created' || kind === 'task.comment.edited' || kind === 'task.comment.deleted') {
    const task = await resolveTaskForEvent(payload, taskFromPayload);
    const comment = extractCommentEntity(payload);
    const projectName = task ? await resolveProjectName(task) : undefined;

    const action = kind.endsWith('.created')
      ? 'Comment Added'
      : kind.endsWith('.edited')
        ? 'Comment Edited'
        : 'Comment Deleted';

    const embed = buildTaskEventEmbed(task, action, WEBHOOK_EVENT_COLOURS.info, projectName, payload?.time);
    const commentText = pickString([
      comment?.comment,
      comment?.text,
      comment?.content,
      comment?.message,
    ]);

    if (commentText) {
      const formatted = formatTaskDescription(commentText);
      embed.setDescription(formatted.length > 600 ? formatted.slice(0, 599).trimEnd() + '…' : formatted);
    } else {
      embed.setDescription('A task comment event was received.');
    }

    const author = extractUserLike(comment?.author)
      ?? extractUserLike(comment?.created_by)
      ?? extractUserLike(payload?.user)
      ?? extractUserLike(payload?.data?.user);

    if (author) {
      embed.addFields({ name: 'Author', value: author, inline: true });
    }

    return {
      embed,
      taskForOpenButton: task,
      cacheTask: task,
    };
  }

  if (kind === 'task.assignee.created' || kind === 'task.assignee.deleted') {
    const task = await resolveTaskForEvent(payload, taskFromPayload);
    const projectName = task ? await resolveProjectName(task) : undefined;
    const assignee = extractAssigneeEntity(payload);

    const action = kind.endsWith('.created') ? 'Assignee Added' : 'Assignee Removed';
    const embed = buildTaskEventEmbed(task, action, WEBHOOK_EVENT_COLOURS.info, projectName, payload?.time);
    embed.setDescription('Task assignee list was updated.');

    if (assignee) {
      embed.addFields({ name: 'Assignee', value: assignee, inline: true });
    }

    return {
      embed,
      taskForOpenButton: task,
      cacheTask: task,
    };
  }

  if (kind === 'task.attachment.created' || kind === 'task.attachment.deleted') {
    const task = await resolveTaskForEvent(payload, taskFromPayload);
    const projectName = task ? await resolveProjectName(task) : undefined;
    const attachment = extractAttachmentEntity(payload);

    const action = kind.endsWith('.created') ? 'Attachment Added' : 'Attachment Removed';
    const embed = buildTaskEventEmbed(task, action, WEBHOOK_EVENT_COLOURS.info, projectName, payload?.time);
    embed.setDescription('Task attachments were updated.');

    const filename = pickString([
      attachment?.file?.name,
      attachment?.file_name,
      attachment?.filename,
      attachment?.name,
    ]);
    if (filename) {
      embed.addFields({ name: 'File', value: filename, inline: true });
    }

    const attachmentId = attachment?.id ?? attachment?.attachment_id;
    if (attachmentId !== undefined) {
      embed.addFields({ name: 'Attachment ID', value: String(attachmentId), inline: true });
    }

    return {
      embed,
      taskForOpenButton: task,
      cacheTask: task,
    };
  }

  if (kind === 'task.relation.created' || kind === 'task.relation.deleted') {
    const task = await resolveTaskForEvent(payload, taskFromPayload);
    const projectName = task ? await resolveProjectName(task) : undefined;
    const relation = extractRelationEntity(payload);

    const action = kind.endsWith('.created') ? 'Relation Added' : 'Relation Removed';
    const embed = buildTaskEventEmbed(task, action, WEBHOOK_EVENT_COLOURS.info, projectName, payload?.time);

    const relationKind = pickString([
      relation?.relation_kind,
      relation?.kind,
      relation?.relation,
      relation?.type,
    ]);

    const relatedTask = await resolveRelatedTaskForRelation(relation, payload);
    const relatedTaskTitle = relatedTask?.title
      ? String(relatedTask.title)
      : null;

    const relationView = formatRelationDescription(relationKind, relatedTaskTitle, kind);
    embed.setDescription(relationView.description);

    if (relationKind) {
      embed.addFields({ name: 'Relation', value: relationView.label, inline: true });
    }

    return {
      embed,
      taskForOpenButton: task,
      cacheTask: task,
    };
  }

  if (kind === 'task.overdue') {
    const task = await resolveTaskForEvent(payload, taskFromPayload);
    const projectName = task ? await resolveProjectName(task) : undefined;
    const embed = buildTaskEventEmbed(task, 'Task Overdue', WEBHOOK_EVENT_COLOURS.danger, projectName, payload?.time);
    embed.setDescription('This task is now overdue.');

    return {
      embed,
      taskForOpenButton: task,
      cacheTask: task,
    };
  }

  if (kind === 'tasks.overdue') {
    const tasks = extractTaskCollection(payload);
    if (!tasks.length) {
      return null;
    }

    const embed = new EmbedBuilder()
      .setColor(WEBHOOK_EVENT_COLOURS.danger)
      .setTitle('Tasks Overdue')
      .setDescription(tasks.slice(0, 10).map((item) => {
        const id = item?.id !== undefined ? '#' + item.id : '#?';
        const title = String(item?.title ?? 'Untitled task');
        return '- ' + id + ' ' + title;
      }).join('\n'))
      .setTimestamp(resolveEventTimestamp(payload?.time, tasks[0]?.updated));

    if (tasks.length > 10) {
      embed.setFooter({ text: 'Showing 10 of ' + tasks.length + ' overdue tasks.' });
    }

    return {
      embed,
      taskForOpenButton: null,
      cacheTask: null,
    };
  }

  if (kind === 'project.updated' || kind === 'project.deleted' || kind === 'project.shared.team' || kind === 'project.shared.user') {
    const project = extractProjectEntity(payload);
    const title = project?.title ? String(project.title) : ('Project #' + (project?.id ?? '?'));

    const action = kind === 'project.updated'
      ? 'Project Updated'
      : kind === 'project.deleted'
        ? 'Project Deleted'
        : kind === 'project.shared.team'
          ? 'Project Shared (Team)'
          : 'Project Shared (User)';

    const colour = kind === 'project.deleted' ? WEBHOOK_EVENT_COLOURS.danger : WEBHOOK_EVENT_COLOURS.info;

    const embed = new EmbedBuilder()
      .setColor(colour)
      .setTitle(action + ': ' + title)
      .setDescription('Project webhook event received.')
      .setTimestamp(resolveEventTimestamp(payload?.time));

    if (project?.id !== undefined) {
      embed.addFields({ name: 'Project ID', value: String(project.id), inline: true });
    }

    const sharedTarget = extractShareTarget(payload);
    if (sharedTarget) {
      embed.addFields({ name: 'Shared With', value: sharedTarget, inline: true });
    }

    return {
      embed,
      taskForOpenButton: null,
      cacheTask: null,
    };
  }

  return null;
}

function buildTaskEventEmbed(task, action, color, projectName, eventTime) {
  const titleTask = task?.title ? String(task.title) : 'Task ' + (task?.id ?? '?');
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(action + ': ' + titleTask)
    .setFooter({ text: 'Task ID: ' + (task?.id ?? 'unknown') })
    .setTimestamp(resolveEventTimestamp(eventTime, task?.updated));

  if (projectName) {
    embed.addFields({ name: 'Project', value: String(projectName), inline: true });
  }

  if (task?.done !== undefined) {
    embed.addFields({ name: 'Status', value: task.done ? '✅ Done' : '🔲 Pending', inline: true });
  }

  return embed;
}

function resolveEventTimestamp(eventTime, fallback) {
  const primary = eventTime ? new Date(eventTime) : null;
  if (primary && !Number.isNaN(primary.getTime())) {
    return primary;
  }

  const secondary = fallback ? new Date(fallback) : null;
  if (secondary && !Number.isNaN(secondary.getTime())) {
    return secondary;
  }

  return new Date();
}

async function resolveTaskForEvent(payload, taskFromPayload) {
  if (isTaskLike(taskFromPayload)) {
    return taskFromPayload;
  }

  const directTask = extractTaskEntity(payload);
  if (isTaskLike(directTask)) {
    return directTask;
  }

  const taskId = getTaskIdFromPayload(payload, taskFromPayload);
  if (taskId === null) {
    return null;
  }

  return getTask(taskId)
    .then((res) => res.data)
    .catch(() => null);
}

function isTaskLike(value) {
  if (!value || typeof value !== 'object') return false;
  const id = Number(value.id);
  if (!Number.isFinite(id)) return false;

  return value.project_id !== undefined
    || value.done !== undefined
    || value.priority !== undefined
    || value.due_date !== undefined
    || value.identifier !== undefined;
}

function extractTaskEntity(payload) {
  return findFirstObject([
    payload?.data?.task,
    payload?.task,
    payload?.data?.old_task,
    payload?.data?.new_task,
  ], isTaskLike);
}

function extractCommentEntity(payload) {
  return findFirstObject([
    payload?.data?.comment,
    payload?.comment,
    payload?.data?.task_comment,
    payload?.task_comment,
    payload?.data,
  ], (value) => {
    if (!value || typeof value !== 'object') return false;
    return typeof value.comment === 'string'
      || typeof value.text === 'string'
      || typeof value.content === 'string'
      || value.comment !== undefined;
  });
}

function extractAttachmentEntity(payload) {
  return findFirstObject([
    payload?.data?.attachment,
    payload?.attachment,
    payload?.data?.task_attachment,
    payload?.task_attachment,
    payload?.data,
  ], (value) => {
    if (!value || typeof value !== 'object') return false;
    return value.file !== undefined
      || value.filename !== undefined
      || value.file_name !== undefined
      || value.attachment_id !== undefined;
  });
}

function extractRelationEntity(payload) {
  return findFirstObject([
    payload?.data?.relation,
    payload?.relation,
    payload?.data?.task_relation,
    payload?.task_relation,
    payload?.data,
  ], (value) => {
    if (!value || typeof value !== 'object') return false;
    return value.relation_kind !== undefined
      || value.kind !== undefined
      || value.other_task_id !== undefined
      || value.otherTaskId !== undefined;
  });
}

async function resolveRelatedTaskForRelation(relation, payload) {
  const inlineTask = findFirstObject([
    relation?.other_task,
    relation?.otherTask,
    relation?.related_task,
    relation?.relatedTask,
    payload?.data?.other_task,
    payload?.data?.otherTask,
    payload?.data?.related_task,
    payload?.data?.relatedTask,
  ], (value) => value?.id !== undefined || typeof value?.title === 'string');

  if (inlineTask) {
    return inlineTask;
  }

  const relatedTaskId = Number(
    relation?.other_task_id
    ?? relation?.otherTaskId
    ?? relation?.related_task_id
    ?? relation?.relatedTaskId
    ?? payload?.data?.other_task_id
    ?? payload?.data?.otherTaskId
  );

  if (!Number.isFinite(relatedTaskId)) {
    return null;
  }

  return getTask(relatedTaskId)
    .then((res) => res.data)
    .catch(() => ({ id: relatedTaskId, title: 'Task #' + relatedTaskId }));
}

function formatRelationDescription(relationKind, relatedTaskTitle, eventKind) {
  const normalized = normalizeRelationKind(relationKind);
  const relationLabel = formatRelationKindLabel(normalized);
  const target = relatedTaskTitle ? '**' + relatedTaskTitle + '**' : 'another task';
  const removed = String(eventKind ?? '').toLowerCase().endsWith('.deleted');
  const verb = removed ? 'removed' : 'added';

  const templates = {
    subtask: 'This task ' + verb + ' a subtask relation with ' + target + '.',
    parenttask: 'This task ' + verb + ' a parent relation with ' + target + '.',
    relatedtask: 'This task is related to ' + target + ' (' + verb + ').',
    duplicates: 'This task now marks ' + target + ' as duplicate-related (' + verb + ').',
    blocking: 'This task blocks ' + target + ' (' + verb + ').',
    blockedby: 'This task is blocked by ' + target + ' (' + verb + ').',
    precedes: 'This task precedes ' + target + ' (' + verb + ').',
    follows: 'This task follows ' + target + ' (' + verb + ').',
    copiedfrom: 'This task was linked as copied from ' + target + ' (' + verb + ').',
    copiedto: 'This task was linked as copied to ' + target + ' (' + verb + ').',
  };

  return {
    label: relationLabel,
    description: templates[normalized] ?? ('Task relation ' + verb + ' with ' + target + '.'),
  };
}

function normalizeRelationKind(relationKind) {
  return String(relationKind ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function formatRelationKindLabel(normalizedKind) {
  const labels = {
    subtask: 'Subtask',
    parenttask: 'Parent Task',
    relatedtask: 'Related Task',
    duplicates: 'Duplicates',
    blocking: 'Blocking',
    blockedby: 'Blocked By',
    precedes: 'Precedes',
    follows: 'Follows',
    copiedfrom: 'Copied From',
    copiedto: 'Copied To',
  };

  return labels[normalizedKind] ?? 'Related';
}

function extractProjectEntity(payload) {
  return findFirstObject([
    payload?.data?.project,
    payload?.project,
    payload?.data,
  ], (value) => {
    if (!value || typeof value !== 'object') return false;
    if (isTaskLike(value)) return false;
    return value.id !== undefined || typeof value.title === 'string';
  });
}

function extractTaskCollection(payload) {
  const candidates = [
    payload?.data?.tasks,
    payload?.tasks,
    payload?.data?.overdue_tasks,
    payload?.overdue_tasks,
    payload?.data,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const tasks = candidate.filter(isTaskLike);
    if (tasks.length) {
      return tasks;
    }
  }

  return [];
}

function extractAssigneeEntity(payload) {
  const assignee = findFirstObject([
    payload?.data?.assignee,
    payload?.assignee,
    payload?.data?.user,
    payload?.user,
    payload?.data,
  ], (value) => {
    if (!value || typeof value !== 'object') return false;
    return value.username !== undefined
      || value.name !== undefined
      || value.user_id !== undefined;
  });

  return extractUserLike(assignee);
}

function extractShareTarget(payload) {
  const team = findFirstObject([
    payload?.data?.team,
    payload?.team,
  ], (value) => value && typeof value === 'object');

  if (team) {
    const label = pickString([team.name, team.title]);
    const id = team.id;
    if (label && id !== undefined) return label + ' (#' + id + ')';
    if (label) return label;
    if (id !== undefined) return 'Team #' + id;
  }

  const user = findFirstObject([
    payload?.data?.user,
    payload?.user,
  ], (value) => value && typeof value === 'object');

  return extractUserLike(user);
}

function extractUserLike(user) {
  if (!user || typeof user !== 'object') return null;

  const username = pickString([user.username]);
  const displayName = pickString([user.name, user.display_name, user.displayName]);
  const id = user.id ?? user.user_id;

  if (displayName && username) {
    return displayName + ' (@' + username + ')';
  }

  if (displayName) return displayName;
  if (username) return '@' + username;
  if (id !== undefined) return 'User #' + id;
  return null;
}

function findFirstObject(values, predicate) {
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    if (!predicate || predicate(value)) {
      return value;
    }
  }

  return null;
}

function pickString(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}
