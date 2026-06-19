import { SlashCommandBuilder } from 'discord.js';
import { createWebhook } from '../../services/vikunja.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('webhook-register')
  .setDescription('Register a Vikunja webhook for a project to send notifications here')
  .addIntegerOption((opt) =>
    opt.setName('project')
      .setDescription('Project ID to register the webhook on')
      .setRequired(true)
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

  const projectId = interaction.options.getInteger('project', true);
  const targetUrl = interaction.options.getString('url', true);

  try {
    const res = await createWebhook(projectId, targetUrl);
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook `' + res.data.id + '` registered on project `' + projectId + '`.\n' +
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
