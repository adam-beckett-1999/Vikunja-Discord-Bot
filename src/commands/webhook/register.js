import { SlashCommandBuilder } from 'discord.js';
import { createWebhook } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
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
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const projectSelection = interaction.options.getString('project', true);
  const targetUrl = interaction.options.getString('url', true);

  const project = await resolveProjectSelection(projectSelection);
  if (!project) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
    });
    return;
  }

  try {
    const res = await createWebhook(project.id, targetUrl);
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook `' + res.data.id + '` registered on project `' + project.title + '`.\n' +
          'Vikunja will now POST task events to `' + targetUrl + '`.'
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
  if (focused.name !== 'project') return interaction.respond([]);

  const choices = await autocompleteProjects(focused.value);
  await interaction.respond(choices);
}
