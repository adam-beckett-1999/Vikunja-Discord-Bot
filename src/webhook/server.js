import express from 'express';
import crypto from 'node:crypto';
import config from '../config.js';
import { buildTaskEmbed } from '../utils/embeds.js';
import { EmbedBuilder } from 'discord.js';

const SUPPORTED_EVENTS = new Set(['task.created', 'task.updated', 'task.deleted']);

/**
 * Action label map for embed titles.
 */
const EVENT_ACTION = {
  'task.created': 'Created',
  'task.updated': 'Updated',
  'task.deleted': 'Deleted',
};

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
      console.warn('[Webhook] Rejected request: invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventType = payload.event_type ?? payload.type;

    if (!SUPPORTED_EVENTS.has(eventType)) {
      // Acknowledge but don't act on unknown events.
      return res.status(200).json({ status: 'ignored', event: eventType });
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
  if (!task) {
    console.warn('[Webhook] Payload did not contain a task object for event: ' + eventType);
    return;
  }

  let embed;
  if (eventType === 'task.deleted') {
    // On deletion, the task may only have an ID – build a minimal embed.
    embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('Deleted: ' + (task.title ?? 'Task ' + task.id))
      .setFooter({ text: 'Task ID: ' + task.id })
      .setTimestamp();
  } else {
    embed = buildTaskEmbed(task, EVENT_ACTION[eventType]);
  }

  await channel.send({ embeds: [embed] });
}
