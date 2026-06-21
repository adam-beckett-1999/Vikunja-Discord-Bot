import { SlashCommandBuilder } from 'discord.js';
import {
  addLabelToTask,
  createLabel,
  getAllLabels,
  getTask,
  removeLabelFromTask,
} from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { cacheTaskSnapshot, markManualTaskUpdate } from '../../services/task-update-context.js';
import { buildErrorEmbed, buildTaskEmbed, buildTaskOpenLinkComponents } from '../../utils/embeds.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';
import { normalizeLabelName } from '../../utils/task-labels.js';

export const data = new SlashCommandBuilder()
  .setName('task-labels')
  .setDescription('Add or remove one or more labels on a task')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to update labels for')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('add')
      .setDescription('Comma-separated labels to add (e.g. backend, urgent)')
  )
  .addStringOption((opt) =>
    opt.setName('remove')
      .setDescription('Comma-separated labels to remove (e.g. bug, blocked)')
  );

function parseLabelList(value) {
  if (!value) return [];
  const unique = new Map();

  for (const item of String(value).split(',')) {
    const normalized = normalizeLabelName(item);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }

  return [...unique.values()];
}

function pickTaskLabels(task) {
  const rawLabels = Array.isArray(task?.labels)
    ? task.labels
    : Array.isArray(task?.tags)
      ? task.tags
      : [];

  const unique = new Map();

  for (const raw of rawLabels) {
    if (!raw || typeof raw !== 'object') continue;
    const name = normalizeLabelName(raw.title ?? raw.name ?? raw.label);
    if (!name) continue;

    const key = name.toLowerCase();
    unique.set(key, {
      id: raw.id,
      title: name,
      hex_color: raw.hex_color ?? raw.hexColor ?? raw.color,
    });
  }

  return [...unique.values()];
}

async function ensureGlobalLabelMap() {
  const response = await getAllLabels();
  const labels = Array.isArray(response?.data) ? response.data : [];

  const byName = new Map();
  for (const label of labels) {
    const name = normalizeLabelName(label?.title ?? label?.name ?? label?.label);
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      id: label.id,
      title: name,
      hex_color: label.hex_color ?? label.hexColor ?? label.color,
    });
  }

  return byName;
}

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const projectSelection = interaction.options.getString('project', true);
  const taskSelection = interaction.options.getString('task', true);
  const addRaw = interaction.options.getString('add');
  const removeRaw = interaction.options.getString('remove');

  const toAdd = parseLabelList(addRaw);
  const toRemove = parseLabelList(removeRaw);

  if (!toAdd.length && !toRemove.length) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Provide at least one label in `add` or `remove`.')],
    });
    return;
  }

  const overlapping = toAdd.filter((name) => toRemove.some((r) => r.toLowerCase() === name.toLowerCase()));
  if (overlapping.length) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('The same label cannot be added and removed in one command: ' + overlapping.join(', '))],
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
    const currentTaskResponse = await getTask(task.id);
    const currentTask = currentTaskResponse.data;
    const currentLabels = pickTaskLabels(currentTask);
    const currentByName = new Map(currentLabels.map((label) => [label.title.toLowerCase(), label]));

    const removeLabelIds = toRemove
      .map((name) => currentByName.get(name.toLowerCase())?.id)
      .filter((id) => Number.isFinite(Number(id)));

    let globalLabelByName = await ensureGlobalLabelMap().catch(() => new Map());
    const addLabelIds = [];

    for (const addName of toAdd) {
      const key = addName.toLowerCase();
      if (currentByName.has(key)) continue;

      let label = globalLabelByName.get(key);
      if (!label) {
        const createResponse = await createLabel(addName);
        const created = createResponse?.data ?? {};
        label = {
          id: created.id,
          title: normalizeLabelName(created.title ?? created.name ?? addName),
          hex_color: created.hex_color ?? created.hexColor ?? created.color,
        };

        if (!label.id) {
          globalLabelByName = await ensureGlobalLabelMap();
          label = globalLabelByName.get(key);
        }
      }

      if (!label?.id) {
        throw new Error('Could not resolve created label id for "' + addName + '".');
      }

      addLabelIds.push(Number(label.id));
    }

    const expectedWebhookUpdates = removeLabelIds.length + addLabelIds.length;
    if (expectedWebhookUpdates > 0) {
      // Suppress all webhook task.updated echoes generated by this command batch.
      markManualTaskUpdate(task.id, expectedWebhookUpdates);
    }

    for (const labelId of removeLabelIds) {
      await removeLabelFromTask(task.id, labelId);
    }

    for (const labelId of addLabelIds) {
      await addLabelToTask(task.id, labelId);
    }

    const updatedTask = (await getTask(task.id)).data;

    cacheTaskSnapshot(updatedTask);

    const updateHighlight = getTaskUpdateHighlightFromTasks(currentTask, updatedTask);
    await interaction.editReply({
      embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
      components: buildTaskOpenLinkComponents(updatedTask),
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to update task labels: ' + msg)] });
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
