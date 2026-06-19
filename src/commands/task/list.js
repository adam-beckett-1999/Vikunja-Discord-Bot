import { SlashCommandBuilder } from 'discord.js';
import { getAllTasks, getTasksByProject } from '../../services/vikunja.js';
import { buildTaskListEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-list')
  .setDescription('List Vikunja tasks, optionally filtered to a project')
  .addIntegerOption((opt) =>
    opt.setName('project')
      .setDescription('Project ID to filter by (leave empty for all tasks)')
  )
  .addStringOption((opt) =>
    opt.setName('search')
      .setDescription('Search string to filter tasks by title')
  )
  .addIntegerOption((opt) =>
    opt.setName('page')
      .setDescription('Page number (default: 1)')
      .setMinValue(1)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const projectId = interaction.options.getInteger('project');
  const search = interaction.options.getString('search') ?? undefined;
  const page = interaction.options.getInteger('page') ?? 1;

  const params = { page };
  if (search) params.s = search;

  try {
    let res;
    let title;
    if (projectId) {
      res = await getTasksByProject(projectId, params);
      title = 'Tasks in Project ' + projectId;
    } else {
      res = await getAllTasks(params);
      title = 'All Tasks';
    }

    const tasks = Array.isArray(res.data) ? res.data : [];
    await interaction.editReply({ embeds: [buildTaskListEmbed(tasks, title)] });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to list tasks: ' + msg)] });
  }
}
