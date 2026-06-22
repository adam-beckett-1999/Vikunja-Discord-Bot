import { ChannelType, SlashCommandBuilder } from 'discord.js';
import { createWebhook } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import { setProjectChannelLink } from '../../services/project-channel-links.js';
import { generateWebhookSecret, upsertWebhookRecord } from '../../services/webhook-records.js';
import {
  formatWebhookEventsHelp,
  parseWebhookEventsInput,
} from '../../services/webhook-events.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('webhook-register')
  .setDescription('Register a Vikunja webhook for a project to send notifications here')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project to register the webhook on')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('url')
      .setDescription('Publicly reachable URL of this bot\'s webhook endpoint (e.g. https://example.com/webhook)')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('events')
      .setDescription('Comma-separated event names. Use "help" to show examples.')
      .setMaxLength(1000)
      .setRequired(false)
  )
  .addChannelOption((opt) =>
    opt.setName('channel')
      .setDescription('Discord channel to receive webhook posts for this project (defaults to current channel)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const projectSelection = interaction.options.getString('project', true);
  const targetUrlInput = interaction.options.getString('url', true);
  const rawEvents = interaction.options.getString('events');
  const selectedChannel = interaction.options.getChannel('channel');
  const targetChannelId = selectedChannel?.id ?? interaction.channelId;

  let targetUrl;
  let urlAutoAdjusted = false;
  try {
    const normalized = normalizeWebhookTargetUrl(targetUrlInput);
    targetUrl = normalized.url;
    urlAutoAdjusted = normalized.autoAdjusted;
  } catch (err) {
    await interaction.editReply({
      embeds: [buildErrorEmbed(err.message)],
    });
    return;
  }

  const requestedHelp = rawEvents?.trim().toLowerCase() === 'help';
  if (requestedHelp) {
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook events format help\n\n' +
          formatWebhookEventsHelp()
        ),
      ],
    });
    return;
  }

  const { events, invalid, unsupported } = parseWebhookEventsInput(rawEvents);
  if (invalid.length || unsupported.length) {
    const invalidLine = invalid.length
      ? 'Invalid token(s): `' + invalid.join('`, `') + '`\n'
      : '';
    const unsupportedLine = unsupported.length
      ? 'Unsupported event(s): `' + unsupported.join('`, `') + '`\n'
      : '';
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          invalidLine +
          unsupportedLine +
          formatWebhookEventsHelp()
        ),
      ],
    });
    return;
  }

  const project = await resolveProjectSelection(projectSelection);
  if (!project) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
    });
    return;
  }

  try {
    const secret = generateWebhookSecret();
    const res = await createWebhook(project.id, targetUrl, events, secret);
    await setProjectChannelLink(project.id, targetChannelId);
    await upsertWebhookRecord({
      projectId: project.id,
      webhookId: res.data.id,
      targetUrl,
      secret,
      events,
    });

    const eventsSummary = '\nEvents: `' + events.join('`, `') + '`';
    const channelSummary = targetChannelId
      ? '\nDiscord channel: <#' + targetChannelId + '>'
      : '';
    const urlAdjustSummary = urlAutoAdjusted
      ? '\nURL note: no path was provided, so `/webhook` was appended automatically.'
      : '';

    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook `' + res.data.id + '` registered on project `' + project.title + '`.\n' +
          'Vikunja will now POST the selected events to `' + targetUrl + '`.' +
          eventsSummary +
          channelSummary +
          urlAdjustSummary +
          '\n\nTip: set `events:help` in this command to view format and common event meanings.' +
          '\nA webhook secret was generated and recorded locally for this webhook.'
        ),
      ],
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({
      embeds: [buildErrorEmbed('Failed to register webhook: ' + msg)],
    });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'project') {
    const choices = await autocompleteProjects(focused.value);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}

function normalizeWebhookTargetUrl(rawValue) {
  let parsed;
  try {
    parsed = new URL(String(rawValue ?? '').trim());
  } catch {
    throw new Error('Invalid URL. Please provide a full URL like `https://your-bot.example.com/webhook`.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Webhook URL must start with `http://` or `https://`.');
  }

  const compactPath = parsed.pathname.replace(/\/+$/, '');
  let autoAdjusted = false;

  if (!compactPath || compactPath === '/') {
    parsed.pathname = '/webhook';
    autoAdjusted = true;
  } else if (compactPath !== '/webhook') {
    throw new Error('Webhook URL path must be `/webhook` (example: `https://your-bot.example.com/webhook`).');
  } else {
    parsed.pathname = '/webhook';
  }

  return {
    url: parsed.toString(),
    autoAdjusted,
  };
}
