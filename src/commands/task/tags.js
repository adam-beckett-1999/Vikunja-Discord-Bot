import { SlashCommandBuilder } from 'discord.js';
import {
  addTagToTask,
  createTag,
  getAllTags,
  getTask,
  removeTagFromTask,
} from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { cacheTaskSnapshot, markManualTaskUpdate } from '../../services/task-update-context.js';
import { buildErrorEmbed, buildTaskEmbed } from '../../utils/embeds.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';
import { normalizeTagName } from '../../utils/task-tags.js';

export const data = new SlashCommandBuilder()
  .setName('task-tags')
  .setDescription('Add or remove one or more tags on a task')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project containing the task')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('task')
      .setDescription('Task to update tags for')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('add')
      .setDescription('Comma-separated tags to add (e.g. backend, urgent)')
  )
  .addStringOption((opt) =>
    opt.setName('remove')
      .setDescription('Comma-separated tags to remove (e.g. bug, blocked)')
  );

function parseTagList(value) {
  if (!value) return [];
  const unique = new Map();

  for (const item of String(value).split(',')) {
    const normalized = normalizeTagName(item);
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }

  return [...unique.values()];
}

function pickTaskTags(task) {
  const rawTags = Array.isArray(task?.labels)
    ? task.labels
    : Array.isArray(task?.tags)
      ? task.tags
      : [];

  const unique = new Map();

  for (const raw of rawTags) {
    if (!raw || typeof raw !== 'object') continue;
    const name = normalizeTagName(raw.title ?? raw.name ?? raw.label);
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

async function ensureGlobalTagMap() {
  const response = await getAllTags();
  const tags = Array.isArray(response?.data) ? response.data : [];

  const byName = new Map();
  for (const tag of tags) {
    const name = normalizeTagName(tag?.title ?? tag?.name ?? tag?.label);
    if (!name) continue;
    byName.set(name.toLowerCase(), {
      id: tag.id,
      title: name,
      hex_color: tag.hex_color ?? tag.hexColor ?? tag.color,
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

  const toAdd = parseTagList(addRaw);
  const toRemove = parseTagList(removeRaw);

  if (!toAdd.length && !toRemove.length) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Provide at least one tag in `add` or `remove`.')],
    });
    return;
  }

  const overlapping = toAdd.filter((name) => toRemove.some((r) => r.toLowerCase() === name.toLowerCase()));
  if (overlapping.length) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('The same tag cannot be added and removed in one command: ' + overlapping.join(', '))],
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
    const currentTags = pickTaskTags(currentTask);
    const currentByName = new Map(currentTags.map((tag) => [tag.title.toLowerCase(), tag]));

    const removeTagIds = toRemove
      .map((name) => currentByName.get(name.toLowerCase())?.id)
      .filter((id) => Number.isFinite(Number(id)));

    let globalTagByName = await ensureGlobalTagMap().catch(() => new Map());
    const addTagIds = [];

    for (const addName of toAdd) {
      const key = addName.toLowerCase();
      if (currentByName.has(key)) continue;

      let tag = globalTagByName.get(key);
      if (!tag) {
        const createResponse = await createTag(addName);
        const created = createResponse?.data ?? {};
        tag = {
          id: created.id,
          title: normalizeTagName(created.title ?? created.name ?? addName),
          hex_color: created.hex_color ?? created.hexColor ?? created.color,
        };

        if (!tag.id) {
          globalTagByName = await ensureGlobalTagMap();
          tag = globalTagByName.get(key);
        }
      }

      if (!tag?.id) {
        throw new Error('Could not resolve created tag id for "' + addName + '".');
      }

      addTagIds.push(Number(tag.id));
    }

    const expectedWebhookUpdates = removeTagIds.length + addTagIds.length;
    if (expectedWebhookUpdates > 0) {
      // Suppress all webhook task.updated echoes generated by this command batch.
      markManualTaskUpdate(task.id, expectedWebhookUpdates);
    }

    for (const tagId of removeTagIds) {
      await removeTagFromTask(task.id, tagId);
    }

    for (const tagId of addTagIds) {
      await addTagToTask(task.id, tagId);
    }

    const updatedTask = (await getTask(task.id)).data;

    cacheTaskSnapshot(updatedTask);

    const updateHighlight = getTaskUpdateHighlightFromTasks(currentTask, updatedTask);
    await interaction.editReply({
      embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to update task tags: ' + msg)] });
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
