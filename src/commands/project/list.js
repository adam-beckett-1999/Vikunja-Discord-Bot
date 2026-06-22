import { SlashCommandBuilder } from 'discord.js';
import { getAllProjects } from '../../services/vikunja.js';
import { buildProjectListEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('project-list')
  .setDescription('List all Vikunja projects accessible to the configured API token');

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  try {
    const res = await getAllProjects();
    const projects = Array.isArray(res.data) ? res.data : [];
    await interaction.editReply({ embeds: [buildProjectListEmbed(projects)] });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({
      embeds: [buildErrorEmbed('Failed to list projects: ' + msg)],
    });
  }
}
