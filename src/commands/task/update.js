import { SlashCommandBuilder } from 'discord.js';
import { updateTask } from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { buildTaskEmbed, buildErrorEmbed } from '../../utils/embeds.js';

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
  .addIntegerOption((opt) =>
    opt.setName('priority')
      .setDescription('Priority: 0=Unset, 1=Low, 2=Medium, 3=High, 4=Urgent, 5=DO NOW')
      .setMinValue(0)
      .setMaxValue(5)
  )
  .addBooleanOption((opt) =>
    opt.setName('done')
      .setDescription('Mark task as done or pending')
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
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

  const title = interaction.options.getString('title') ?? undefined;
  const description = interaction.options.getString('description') ?? undefined;
  const dueRaw = interaction.options.getString('due') ?? undefined;
  const priority = interaction.options.getInteger('priority') ?? undefined;
  const done = interaction.options.getBoolean('done') ?? undefined;

  const taskData = {};
  if (title !== undefined) taskData.title = title;
  if (description !== undefined) taskData.description = description;
  if (priority !== undefined) taskData.priority = priority;
  if (done !== undefined) taskData.done = done;

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

  if (Object.keys(taskData).length === 0) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('No fields to update were provided.')],
    });
    return;
  }

  try {
    const res = await updateTask(task.id, taskData);
    await interaction.editReply({ embeds: [buildTaskEmbed(res.data, 'Updated')] });
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
