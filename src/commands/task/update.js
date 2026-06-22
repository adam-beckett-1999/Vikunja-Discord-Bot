import { SlashCommandBuilder } from 'discord.js';
import { getTask, updateTask } from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { cacheTaskSnapshot } from '../../services/task-update-context.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';
import { buildTaskEmbed, buildErrorEmbed } from '../../utils/embeds.js';

const PRIORITY_CHOICES = [
  { name: 'Unset', value: '0' },
  { name: 'Low', value: '1' },
  { name: 'Medium', value: '2' },
  { name: 'High', value: '3' },
  { name: 'Urgent', value: '4' },
  { name: 'DO NOW', value: '5' },
];

export const data = new SlashCommandBuilder()
  .setName('task-update')
  .setDescription('Update an existing Vikunja task')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to update')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('title')
      .setDescription('New title')
  )
  .addStringOption((opt) =>
    opt.setName('description')
      .setDescription('New description')
  )
  .addStringOption((opt) =>
    opt.setName('due')
      .setDescription('New due date in YYYY-MM-DD format')
  )
  .addStringOption((opt) =>
    opt.setName('priority')
      .setDescription('Priority')
      .addChoices(...PRIORITY_CHOICES)
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

  const title = interaction.options.getString('title') ?? undefined;
  const description = interaction.options.getString('description') ?? undefined;
  const dueRaw = interaction.options.getString('due') ?? undefined;
  const priorityRaw = interaction.options.getString('priority') ?? undefined;
  const priority = priorityRaw !== undefined ? Number(priorityRaw) : undefined;

  const taskData = {};
  if (title !== undefined) taskData.title = title;
  if (description !== undefined) taskData.description = description;
  if (priority !== undefined) taskData.priority = priority;

  if (dueRaw !== undefined) {
    const parsed = new Date(dueRaw);
    if (isNaN(parsed.getTime())) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Invalid due date. Use YYYY-MM-DD format.')],
      });
      return;
    }
    taskData.due_date = parsed.toISOString();
  }

  if (priorityRaw !== undefined && !Number.isInteger(priority)) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Invalid priority selected.')],
    });
    return;
  }

  if (Object.keys(taskData).length === 0) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('No fields to update were provided.')],
    });
    return;
  }

  try {
    const res = await updateTask(task.id, taskData);
    const updatedTask = await getTask(task.id)
      .then((response) => response.data)
      .catch(() => res.data);

    cacheTaskSnapshot(updatedTask);
    const updateHighlight = getTaskUpdateHighlightFromTasks(task, updatedTask);
    await interaction.editReply({
      embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
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
