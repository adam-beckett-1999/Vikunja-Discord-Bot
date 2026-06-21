import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import config from '../../config.js';
import {
  addTaskReminder,
  getTask,
  removeTaskReminder,
} from '../../services/vikunja.js';
import {
  autocompleteProjects,
  autocompleteTasks,
  parseSelectionId,
  resolveProjectSelection,
  resolveTaskSelection,
} from '../../services/vikunja-lookups.js';
import { buildErrorEmbed, buildTaskEmbed } from '../../utils/embeds.js';
import { extractTaskReminderInstants, formatReminderInstantForDisplay } from '../../utils/task-reminders.js';
import { getTaskUpdateHighlightFromTasks } from '../../utils/task-update-highlight.js';

export const data = new SlashCommandBuilder()
  .setName('task-reminder')
  .setDescription('Add, list, or remove reminders on a Vikunja task (YYYY-MM-DD HH:mm)')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('add')
      .setDescription('Add a reminder using YYYY-MM-DD HH:mm (24h) in BOT_TIMEZONE')
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
        opt.setName('at')
          .setDescription('Date/time as YYYY-MM-DD HH:mm, e.g. 2026-06-21 18:00')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List reminders on a task')
      .addStringOption((opt) =>
        opt.setName('project')
          .setDescription('Project containing the task')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption((opt) =>
        opt.setName('task')
          .setDescription('Task to inspect')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove a reminder from a task by its list index')
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
      .addIntegerOption((opt) =>
        opt.setName('index')
          .setDescription('Reminder number from /task-reminder list')
          .setMinValue(1)
          .setRequired(true)
      )
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const action = interaction.options.getSubcommand(true);
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
    if (action === 'list') {
      const res = await getTask(task.id);
      const currentTask = res.data;
      const reminders = extractTaskReminderInstants(currentTask);

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Task Reminders: ' + currentTask.title)
        .setFooter({ text: 'Task ID: ' + currentTask.id })
        .setTimestamp();

      embed.addFields({ name: 'Project', value: project.title, inline: true });
      embed.addFields({
        name: 'Reminders',
        value: reminders.length
          ? reminders.map((value, index) => (index + 1) + '. ' + formatReminderForConfiguredTimeZone(value)).join('\n')
          : 'none',
      });
      embed.addFields({ name: 'Timezone', value: config.bot.timeZone, inline: true });

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (action === 'add') {
      const atRaw = interaction.options.getString('at', true);
      const reminderInstant = parseReminderInstant(atRaw);

      if (!reminderInstant) {
        await interaction.editReply({
          embeds: [buildErrorEmbed('Invalid reminder date/time. Use `YYYY-MM-DD HH:mm` in `' + config.bot.timeZone + '` (e.g. `2026-06-21 18:00`).')],
        });
        return;
      }

      const beforeTask = (await getTask(task.id)).data;
      await addTaskReminder(task.id, reminderInstant);
      const updatedTask = (await getTask(task.id)).data;
      const updateHighlight = getTaskUpdateHighlightFromTasks(beforeTask, updatedTask);

      await interaction.editReply({
        embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
      });
      return;
    }

    if (action === 'remove') {
      const index = interaction.options.getInteger('index', true);
      const beforeTask = (await getTask(task.id)).data;
      const reminders = extractTaskReminderInstants(beforeTask);

      if (index > reminders.length) {
        await interaction.editReply({
          embeds: [buildErrorEmbed('Reminder index `' + index + '` is out of range. Use `/task-reminder list` first.')],
        });
        return;
      }

      const reminderInstant = reminders[index - 1];
      await removeTaskReminder(task.id, reminderInstant);
      const updatedTask = (await getTask(task.id)).data;
      const updateHighlight = getTaskUpdateHighlightFromTasks(beforeTask, updatedTask);

      await interaction.editReply({
        embeds: [buildTaskEmbed(updatedTask, 'Updated', project.title, updateHighlight)],
      });
      return;
    }
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({
      embeds: [buildErrorEmbed('Failed to update task reminders: ' + msg)],
    });
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

function parseReminderInstant(rawValue) {
  const text = String(rawValue ?? '').trim();
  if (!text) return null;

  const parsed = DateTime.fromFormat(text, 'yyyy-MM-dd HH:mm', {
    zone: config.bot.timeZone,
    setZone: true,
    locale: 'en',
  });

  if (!parsed.isValid) return null;
  return parsed.toUTC().toISO();
}

function formatReminderForConfiguredTimeZone(instant) {
  const parsed = DateTime.fromISO(String(instant), { zone: 'utc' });
  if (!parsed.isValid) return formatReminderInstantForDisplay(instant);

  return parsed
    .setZone(config.bot.timeZone)
    .toFormat("yyyy-MM-dd HH:mm '('ZZZZ')'");
}