import { SlashCommandBuilder } from 'discord.js';
import { deleteTask } from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-delete')
  .setDescription('Delete a Vikunja task')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to delete')
      .setRequired(true)
      .setAutocomplete(true)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  const projectSelection = interaction.options.getString('project', true);
  const taskSelection = interaction.options.getString('task', true);

  const project = await resolveProjectSelection(projectSelection);
  if (!project) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
    });
    return;
  }

  const task = await resolveTaskSelection(project.id, taskSelection);
  if (!task) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Could not find a task matching `' + taskSelection + '` in `' + project.title + '`.')],
    });
    return;
  }

  try {
    await deleteTask(task.id);
    await interaction.editReply({
      embeds: [buildSuccessEmbed('Task `' + task.title + '` has been deleted from `' + project.title + '`.')],
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to delete task: ' + msg)] });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'project') {
    const choices = await autocompleteProjects(focused.value);
    await interaction.respond(choices);
    return;
  }

  if (focused.name === 'task') {
    const projectSelection = interaction.options.getString('project');
    if (!projectSelection) {
      await interaction.respond([]);
      return;
    }

    const projectId = parseSelectionId(projectSelection);
    if (!projectId) {
      await interaction.respond([]);
      return;
    }

    const choices = await autocompleteTasks(projectId, focused.value);
    await interaction.respond(choices);
  }
}
