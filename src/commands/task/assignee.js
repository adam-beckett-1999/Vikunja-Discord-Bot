import { SlashCommandBuilder } from 'discord.js';
import {
  addAssigneeToTask,
  getTask,
  removeAssigneeFromTask,
} from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import {
  autocompleteKnownAssignees,
  resolveKnownAssigneeSelection,
} from '../../services/vikunja-assignees.js';
import { cacheTaskSnapshot } from '../../services/task-update-context.js';
import { buildErrorEmbed, buildTaskEmbed } from '../../utils/embeds.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';

export const data = new SlashCommandBuilder()
  .setName('task-assignee')
  .setDescription('List, add, or remove assignees on a task')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to inspect/update assignees for')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('add')
      .setDescription('Comma-separated assignees to add (e.g. username, id:123)')
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('remove')
      .setDescription('Comma-separated assignees to remove (e.g. username, id:123)')
      .setAutocomplete(true)
  );

function parseAssigneeList(value) {
  if (!value) return [];

  const deduped = new Map();

  for (const token of String(value).split(',')) {
    const normalized = token.trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, normalized);
    }
  }

  return [...deduped.values()];
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const projectSelection = interaction.options.getString('project', true);
  const taskSelection = interaction.options.getString('task', true);
  const addRaw = interaction.options.getString('add');
  const removeRaw = interaction.options.getString('remove');

  const addInput = parseAssigneeList(addRaw);
  const removeInput = parseAssigneeList(removeRaw);

  const overlapping = addInput.filter((entry) => removeInput.some((other) => other.toLowerCase() === entry.toLowerCase()));
  if (overlapping.length) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('The same assignee cannot be added and removed in one command: ' + overlapping.join(', '))],
    });
    return;
  }

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
    const currentTask = (await getTask(task.id)).data;

    // List mode when no mutation options are provided.
    if (!addInput.length && !removeInput.length) {
      cacheTaskSnapshot(currentTask);
      await interaction.editReply({
        embeds: [buildTaskEmbed(currentTask, 'Assignees', project.title)],
      });
      return;
    }

    const resolveResults = await Promise.all([
      ...addInput.map((value) => resolveKnownAssigneeSelection(value).catch(() => null)),
      ...removeInput.map((value) => resolveKnownAssigneeSelection(value).catch(() => null)),
    ]);

    const addResolved = resolveResults.slice(0, addInput.length);
    const removeResolved = resolveResults.slice(addInput.length);

    const unresolvedAdd = [];
    const unresolvedRemove = [];

    const addIds = addResolved
      .map((assignee, index) => {
        if (Number.isFinite(assignee?.id)) return Number(assignee.id);
        unresolvedAdd.push(addInput[index]);
        return null;
      })
      .filter((id) => Number.isFinite(id));

    const removeIds = removeResolved
      .map((assignee, index) => {
        if (Number.isFinite(assignee?.id)) return Number(assignee.id);
        unresolvedRemove.push(removeInput[index]);
        return null;
      })
      .filter((id) => Number.isFinite(id));

    if (unresolvedAdd.length || unresolvedRemove.length) {
      const addLine = unresolvedAdd.length
        ? 'Could not resolve add assignee(s): ' + unresolvedAdd.join(', ') + '.'
        : '';
      const removeLine = unresolvedRemove.length
        ? 'Could not resolve remove assignee(s): ' + unresolvedRemove.join(', ') + '.'
        : '';

      await interaction.editReply({
        embeds: [
          buildErrorEmbed(
            [addLine, removeLine, 'Use autocomplete or ensure assignees have appeared on at least one task.']
              .filter(Boolean)
              .join('\n')
          ),
        ],
      });
      return;
    }

    for (const assigneeId of addIds) {
      await addAssigneeToTask(task.id, assigneeId);
    }

    for (const assigneeId of removeIds) {
      await removeAssigneeFromTask(task.id, assigneeId);
    }

    const updatedTask = (await getTask(task.id)).data;
    cacheTaskSnapshot(updatedTask);

    const updateHighlight = getTaskUpdateHighlightFromTasks(currentTask, updatedTask);
    await interaction.editReply({
      embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to update task assignees: ' + msg)] });
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
    return;
  }

  if (focused.name === 'add' || focused.name === 'remove') {
    const raw = String(focused.value ?? '');
    const tokens = raw.split(',');
    const activeFragment = tokens[tokens.length - 1]?.trim() ?? '';

    const choices = await autocompleteKnownAssignees(activeFragment).catch(() => []);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}