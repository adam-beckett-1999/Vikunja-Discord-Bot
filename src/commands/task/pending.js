import { SlashCommandBuilder } from 'discord.js';
import { getTask, updateTask } from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { cacheTaskSnapshot, markManualTaskUpdate } from '../../services/task-update-context.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';
import { buildTaskEmbed, buildErrorEmbed, buildTaskOpenLinkComponents } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-pending')
  .setDescription('Mark a Vikunja task as pending')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to mark as pending')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function execute(interaction) {
  await interaction.deferReply();

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

  if (task.done === false) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Task is already marked as pending.')],
    });
    return;
  }

  try {
    markManualTaskUpdate(task.id);
    const res = await updateTask(task.id, { done: false });
    const updatedTask = await getTask(task.id)
      .then((response) => response.data)
      .catch(() => res.data);

    cacheTaskSnapshot(updatedTask);
    const updateHighlight = getTaskUpdateHighlightFromTasks(task, updatedTask);
    await interaction.editReply({
      embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
      components: buildTaskOpenLinkComponents(updatedTask),
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to update task: ' + msg)] });
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