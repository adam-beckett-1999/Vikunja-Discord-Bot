import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  SlashCommandBuilder,
} from 'discord.js';
import { getAllProjects, getAllTasks, getTasksByProject } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import { buildTaskListEmbed, buildErrorEmbed } from '../../utils/embeds.js';

const TASK_LIST_PAGE_SIZE = 10;
const VIKUNJA_MAX_PER_PAGE = 50;

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
  await interaction.deferReply({ flags: 64 });

  const projectSelection = interaction.options.getString('project');
  const search = interaction.options.getString('search') ?? undefined;

  const params = { page: 1, per_page: VIKUNJA_MAX_PER_PAGE };
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
        const fallbackParams = { page: 1, per_page: VIKUNJA_MAX_PER_PAGE };
        return getTasksByProject(project.id, fallbackParams);
      });
      title = 'Tasks in ' + project.title;
    } else {
      res = await getAllTasks(params).catch(async (err) => {
        if (!search) {
          logTaskListAllProjectsFallback(err);
          return {
            data: await getAllTasksAcrossProjects(),
          };
        }

        if (!shouldRetryWithoutServerSearch(err, search)) {
          logTaskListSearchAllProjectsFallback(search, err);
          return {
            data: await getAllTasksAcrossProjects(),
          };
        }

        logTaskListSearchFallback('all', search, err);
        const fallbackParams = { page: 1, per_page: VIKUNJA_MAX_PER_PAGE };
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

    if (tasks.length <= TASK_LIST_PAGE_SIZE) {
      await interaction.editReply({ embeds: [buildTaskListEmbed(tasks, title)] });
      return;
    }

    await sendPagedTaskListReply(interaction, tasks, title);
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

function logTaskListAllProjectsFallback(err) {
  const status = Number(err?.response?.status);
  const message = String(err?.response?.data?.message ?? err?.message ?? 'unknown error');
  console.warn(
    '[task-list] Falling back to all-project aggregation'
    + ' | query=""'
    + ' | status=' + (Number.isFinite(status) ? String(status) : 'n/a')
    + ' | reason=' + message
  );
}

async function getAllTasksAcrossProjects() {
  const projectsResponse = await getAllProjects();
  const projects = Array.isArray(projectsResponse?.data) ? projectsResponse.data : [];
  const projectTitleById = new Map(
    projects
      .filter((project) => Number.isFinite(Number(project?.id)))
      .map((project) => [Number(project.id), String(project?.title ?? '').trim()])
  );

  const responses = [];
  for (const project of projects) {
    const response = await getTasksByProject(project.id, { page: 1, per_page: VIKUNJA_MAX_PER_PAGE }).catch((err) => {
      const status = Number(err?.response?.status);
      const message = String(err?.response?.data?.message ?? err?.message ?? 'unknown error');
      console.warn(
        '[task-list] Project task fetch failed during aggregation'
        + ' | projectId=' + project.id
        + ' | status=' + (Number.isFinite(status) ? String(status) : 'n/a')
        + ' | reason=' + message
      );
      return { data: [] };
    });

    responses.push(response);
  }

  const deduped = new Map();
  for (const response of responses) {
    const tasks = Array.isArray(response?.data) ? response.data : [];
    for (const task of tasks) {
      const id = Number(task?.id);
      if (!Number.isFinite(id)) continue;

      const projectId = Number(task?.project_id ?? task?.project?.id);
      const projectTitle = projectTitleById.get(projectId);
      if (projectTitle) {
        task.project_title = projectTitle;
      }

      deduped.set(id, task);
    }
  }

  return [...deduped.values()];
}

async function sendPagedTaskListReply(interaction, tasks, title) {
  const pages = chunkTasks(tasks, TASK_LIST_PAGE_SIZE);
  const pageCount = pages.length;
  let currentPageIndex = 0;

  await interaction.editReply({
    embeds: [buildTaskListEmbed(pages[currentPageIndex], title, {
      summaryTasks: tasks,
      pageInfo: { currentPage: currentPageIndex + 1, totalPages: pageCount },
    })],
    components: [buildTaskListPaginationRow(interaction.id, currentPageIndex, pageCount)],
  });

  const replyMessage = await interaction.fetchReply();
  const collector = replyMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 5 * 60 * 1000,
    filter: (componentInteraction) => componentInteraction.user.id === interaction.user.id
      && componentInteraction.customId.startsWith('task-list:' + interaction.id + ':'),
  });

  collector.on('collect', async (componentInteraction) => {
    const direction = componentInteraction.customId.endsWith(':next') ? 1 : -1;
    currentPageIndex = Math.max(0, Math.min(pageCount - 1, currentPageIndex + direction));

    await componentInteraction.update({
      embeds: [buildTaskListEmbed(pages[currentPageIndex], title, {
        summaryTasks: tasks,
        pageInfo: { currentPage: currentPageIndex + 1, totalPages: pageCount },
      })],
      components: [buildTaskListPaginationRow(interaction.id, currentPageIndex, pageCount)],
    });
  });

  collector.on('end', async () => {
    await interaction.editReply({
      components: [buildTaskListPaginationRow(interaction.id, currentPageIndex, pageCount, true)],
    }).catch(() => {});
  });
}

function chunkTasks(tasks, pageSize) {
  const pages = [];
  for (let index = 0; index < tasks.length; index += pageSize) {
    pages.push(tasks.slice(index, index + pageSize));
  }
  return pages.length ? pages : [[]];
}

function buildTaskListPaginationRow(interactionId, currentPageIndex, pageCount, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('task-list:' + interactionId + ':prev')
      .setLabel('Previous')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPageIndex === 0),
    new ButtonBuilder()
      .setCustomId('task-list:' + interactionId + ':next')
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPageIndex >= pageCount - 1)
  );
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'project') return interaction.respond([]);

  const choices = await autocompleteProjects(focused.value);
  await interaction.respond(choices);
}
