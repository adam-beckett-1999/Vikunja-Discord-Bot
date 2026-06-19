import { SlashCommandBuilder } from 'discord.js';
import { getTask } from '../../services/vikunja.js';
import { buildTaskEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-get')
  .setDescription('Get details of a specific Vikunja task by ID')
  .addIntegerOption((opt) =>
    opt.setName('id')
      .setDescription('Task ID')
      .setRequired(true)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const taskId = interaction.options.getInteger('id', true);

  try {
    const res = await getTask(taskId);
    await interaction.editReply({ embeds: [buildTaskEmbed(res.data)] });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Could not retrieve task: ' + msg)] });
  }
}
