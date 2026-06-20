import { SlashCommandBuilder } from 'discord.js';
import { getAllTasks, getTasksByProject } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import { buildTaskListEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-list')
  .setDescription('List Vikunja tasks, optionally filtered to a project')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project to filter by (leave empty for all tasks)')
      .setAutocomplete(true)
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

  const projectSelection = interaction.options.getString('project');
  const search = interaction.options.getString('search') ?? undefined;
  const page = interaction.options.getInteger('page') ?? 1;

  const params = { page };
  if (search) params.s = search;

  try {
    let res;
    let title;
    if (projectSelection) {
      const project = await resolveProjectSelection(projectSelection);
      if (!project) {
        await interaction.editReply({
          embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
        });
        return;
      }

      res = await getTasksByProject(project.id, params);
      title = 'Tasks in ' + project.title;
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

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'project') return interaction.respond([]);

  const choices = await autocompleteProjects(focused.value);
  await interaction.respond(choices);
}
