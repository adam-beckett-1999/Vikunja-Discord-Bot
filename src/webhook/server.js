import express from 'express';
import crypto from 'node:crypto';
import config from '../config.js';
import { buildTaskEmbed } from '../utils/embeds.js';
import {
  cacheTaskSnapshot,
  clearTaskSnapshot,
  getCachedTaskSnapshot,
  shouldSuppressWebhookUpdate,
} from '../services/task-update-context.js';
import { getTaskUpdateHighlightFromTasks } from '../utils/task-update-highlight.js';
import { getTaskUpdateHighlightFromPayload } from '../utils/task-update-highlight.js';
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

    console.log('[Webhook] Received event: ' + (eventType ?? 'unknown'));

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
  const channelId = config.webhook.notificationChannelId;
  if (!channelId) {
    console.warn('[Webhook] NOTIFICATION_CHANNEL_ID is not set – skipping notification.');
    return;
  }

  const channel = await discordClient.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    console.error('[Webhook] Notification channel not found or not text-based: ' + channelId);
    return;
  }

  const task = payload.data?.task ?? payload.task ?? payload.data;

  if (eventType === 'task.updated' && task?.id && shouldSuppressWebhookUpdate(task.id)) {
    cacheTaskSnapshot(task);
    return;
  }

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
    let updateHighlight = getTaskUpdateHighlight(eventType, payload, task);

    if (!updateHighlight && eventType === 'task.updated' && task.id !== undefined) {
      updateHighlight = getTaskUpdateHighlightFromTasks(getCachedTaskSnapshot(task.id), task);
    }

    embed = buildTaskEmbed(task, getEventActionLabel(eventType), undefined, updateHighlight);
    cacheTaskSnapshot(task);
  } else {
    embed = buildGenericEventEmbed(eventType, payload);
  }

  await channel.send({ embeds: [embed] });
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
