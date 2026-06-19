import { SlashCommandBuilder } from 'discord.js';
import { deleteTask } from '../../services/vikunja.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-delete')
  .setDescription('Delete a Vikunja task by ID')
  .addIntegerOption((opt) =>
    opt.setName('id')
      .setDescription('Task ID to delete')
      .setRequired(true)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const taskId = interaction.options.getInteger('id', true);

  try {
    await deleteTask(taskId);
    await interaction.editReply({
      embeds: [buildSuccessEmbed('Task `' + taskId + '` has been deleted.')],
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to delete task: ' + msg)] });
  }
}
