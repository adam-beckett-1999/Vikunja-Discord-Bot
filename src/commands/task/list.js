import { SlashCommandBuilder } from 'discord.js';
import { getAllProjects, getAllTasks, getTasksByProject } from '../../services/vikunja.js';
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
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const projectSelection = interaction.options.getString('project');
  const search = interaction.options.getString('search') ?? undefined;

  const params = { page: 1 };
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

      res = await getTasksByProject(project.id, params).catch(async (err) => {
        if (!shouldRetryWithoutServerSearch(err, search)) throw err;

        logTaskListSearchFallback('project', search, err);
        const fallbackParams = { page: 1 };
        return getTasksByProject(project.id, fallbackParams);
      });
      title = 'Tasks in ' + project.title;
    } else {
      res = await getAllTasks(params).catch(async (err) => {
        if (!search) throw err;

        if (!shouldRetryWithoutServerSearch(err, search)) {
          logTaskListSearchAllProjectsFallback(search, err);
          return {
            data: await getAllTasksAcrossProjects(),
          };
        }

        logTaskListSearchFallback('all', search, err);
        const fallbackParams = { page: 1 };
        return getAllTasks(fallbackParams).catch(async (fallbackErr) => {
          logTaskListSearchAllProjectsFallback(search, fallbackErr);
          return {
            data: await getAllTasksAcrossProjects(),
          };
        });
      });
      title = search ? 'Tasks containing "' + search + '"' : 'All Tasks';
    }

    let tasks = Array.isArray(res.data) ? res.data : [];
    if (search) {
      const needle = normalizeSearch(search);
      tasks = tasks.filter((task) => normalizeSearch(task?.title).includes(needle));
    }

    await interaction.editReply({ embeds: [buildTaskListEmbed(tasks, title)] });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to list tasks: ' + msg)] });
  }
}

function shouldRetryWithoutServerSearch(err, search) {
  if (!search) return false;

  const status = Number(err?.response?.status);
  if (status !== 400) return false;

  const message = String(err?.response?.data?.message ?? err?.message ?? '').toLowerCase();
  return message.includes('invalid model');
}

function normalizeSearch(value) {
  return String(value ?? '').trim().toLowerCase();
}

function logTaskListSearchFallback(scope, search, err) {
  const status = Number(err?.response?.status);
  const message = String(err?.response?.data?.message ?? err?.message ?? 'unknown error');
  console.warn(
    '[task-list] Falling back to client-side search'
    + ' | scope=' + scope
    + ' | query="' + String(search ?? '') + '"'
    + ' | status=' + (Number.isFinite(status) ? String(status) : 'n/a')
    + ' | reason=' + message
  );
}

function logTaskListSearchAllProjectsFallback(search, err) {
  const status = Number(err?.response?.status);
  const message = String(err?.response?.data?.message ?? err?.message ?? 'unknown error');
  console.warn(
    '[task-list] Falling back to all-project aggregation'
    + ' | query="' + String(search ?? '') + '"'
    + ' | status=' + (Number.isFinite(status) ? String(status) : 'n/a')
    + ' | reason=' + message
  );
}

async function getAllTasksAcrossProjects() {
  const projectsResponse = await getAllProjects();
  const projects = Array.isArray(projectsResponse?.data) ? projectsResponse.data : [];

  const responses = await Promise.all(projects.map((project) => (
    getTasksByProject(project.id, { page: 1 }).catch((err) => {
      const status = Number(err?.response?.status);
      const message = String(err?.response?.data?.message ?? err?.message ?? 'unknown error');
      console.warn(
        '[task-list] Project task fetch failed during aggregation'
        + ' | projectId=' + project.id
        + ' | status=' + (Number.isFinite(status) ? String(status) : 'n/a')
        + ' | reason=' + message
      );
      return { data: [] };
    })
  )));

  const deduped = new Map();
  for (const response of responses) {
    const tasks = Array.isArray(response?.data) ? response.data : [];
    for (const task of tasks) {
      const id = Number(task?.id);
      if (!Number.isFinite(id)) continue;
      deduped.set(id, task);
    }
  }

  return [...deduped.values()];
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'project') return interaction.respond([]);

  const choices = await autocompleteProjects(focused.value);
  await interaction.respond(choices);
}
