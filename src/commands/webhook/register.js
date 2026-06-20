import { SlashCommandBuilder } from 'discord.js';
import { createWebhook } from '../../services/vikunja.js';
import config from '../../config.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import {
  autocompleteWebhookEventsInput,
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
      .setDescription('Comma-separated events (e.g. task.created, task.updated, task.comment.created)')
      .setRequired(false)
      .setAutocomplete(true)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const projectSelection = interaction.options.getString('project', true);
  const targetUrl = interaction.options.getString('url', true);
  const rawEvents = interaction.options.getString('events');

  const { events, invalid } = parseWebhookEventsInput(rawEvents);
  if (invalid.length) {
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          'Invalid event token(s): `' + invalid.join('`, `') + '`\n' +
          'Use comma-separated event names, for example: `task.created, task.updated`.'
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
    const res = await createWebhook(project.id, targetUrl, events);
    const secretNote = config.webhook.secret
      ? '\nUsing configured webhook secret for signature verification.'
      : '';
    const eventsSummary = '\nEvents: `' + events.join('`, `') + '`';
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook `' + res.data.id + '` registered on project `' + project.title + '`.\n' +
          'Vikunja will now POST the selected events to `' + targetUrl + '`.' +
          eventsSummary +
          secretNote
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

  if (focused.name === 'events') {
    const choices = autocompleteWebhookEventsInput(focused.value);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}
