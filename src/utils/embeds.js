import { EmbedBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import config from '../config.js';
import { formatLabelNameList, formatTaskLabelsForEmbed } from './task-labels.js';
import { formatTaskAssigneesForEmbed } from './task-assignees.js';
import { formatTaskRemindersForEmbed } from './task-reminders.js';

const MAX_EMBED_DESCRIPTION_LENGTH = 4096;

/** Priority label map matching Vikunja's values (0–5). */
const PRIORITY_LABELS = {
  0: 'Unset',
  1: 'Low',
  2: 'Medium',
  3: 'High',
  4: 'Urgent',
  5: 'DO NOW',
};

/** Priority colour map. */
const PRIORITY_COLOURS = {
  0: 0x95a5a6,
  1: 0x3498db,
  2: 0xf1c40f,
  3: 0xe67e22,
  4: 0xe74c3c,
  5: 0x8e44ad,
};

/**
 * Build a Discord embed for a Vikunja task.
 *
 * @param {object} task - Raw task object from the Vikunja API.
 * @param {string} [action] - Optional action label for the embed title (e.g. "Created").
 * @param {string} [projectName] - Optional resolved project name for clearer display.
 * @param {{field: string, before: string, after: string}|null} [updateHighlight]
 * @returns {EmbedBuilder}
 */
export function buildTaskEmbed(task, action, projectName, updateHighlight) {
  const priority = task.priority ?? 0;
  const colour = PRIORITY_COLOURS[priority] ?? 0x95a5a6;

  const embed = new EmbedBuilder()
    .setColor(colour)
    .setTitle(action ? action + ': ' + task.title : task.title)
    .setFooter({ text: 'Task ID: ' + task.id });

  const rawDescription = pickTaskDescription(task);
  if (rawDescription) {
    const formatted = formatTaskDescription(rawDescription);
    // Truncate long descriptions to Discord's 4096 character limit for embed descriptions.
    const description = formatted.length > MAX_EMBED_DESCRIPTION_LENGTH
      ? formatted.slice(0, MAX_EMBED_DESCRIPTION_LENGTH - 1).trimEnd() + '…'
      : formatted;
    embed.setDescription(description);
  } else {
    embed.setDescription('No description.');
  }

  embed.addFields({ name: 'Priority', value: PRIORITY_LABELS[priority] ?? 'Unknown', inline: true });

  if (task.due_date && task.due_date !== '0001-01-01T00:00:00Z') {
    const due = DateTime.fromISO(String(task.due_date), { zone: 'utc' });
    if (due.isValid) {
      embed.addFields({ name: 'Due Date', value: due.setZone(config.bot.timeZone).toFormat("yyyy-MM-dd HH:mm '('ZZZZ')'"), inline: true });
    }
  }

  const resolvedProjectName = projectName
    ?? task?.project?.title
    ?? task?.project_title
    ?? (task.project_id ? '#' + task.project_id : undefined);

  if (resolvedProjectName) {
    embed.addFields({ name: 'Project', value: String(resolvedProjectName), inline: true });
  }

  const assigneesFieldValue = formatTaskAssigneesForEmbed(task);
  if (assigneesFieldValue) {
    embed.addFields({ name: 'Assignees', value: assigneesFieldValue });
  }

  const remindersFieldValue = formatTaskRemindersForEmbed(task);
  if (remindersFieldValue) {
    embed.addFields({ name: 'Reminders', value: remindersFieldValue });
  }

  const labelsFieldValue = formatTaskLabelsForEmbed(task);
  if (labelsFieldValue) {
    embed.addFields({ name: 'Labels', value: labelsFieldValue });
  }

  if (task.done) {
    embed.addFields({ name: 'Status', value: '✅ Done', inline: true });
  } else {
    embed.addFields({ name: 'Status', value: '🔲 Pending', inline: true });
  }

  if (updateHighlight?.field) {
    const hasLabelDiff = updateHighlight.field === 'Labels'
      && (Array.isArray(updateHighlight.added) || Array.isArray(updateHighlight.removed));

    if (hasLabelDiff) {
      const added = Array.isArray(updateHighlight.added) ? updateHighlight.added : [];
      const removed = Array.isArray(updateHighlight.removed) ? updateHighlight.removed : [];

      const lines = ['**Labels**'];
      lines.push('Added: ' + formatLabelNameList(added));
      lines.push('Removed: ' + formatLabelNameList(removed));

      embed.addFields({
        name: 'Updated',
        value: lines.join('\n'),
      });
    } else {
      embed.addFields({
        name: 'Updated',
        value: '**' + updateHighlight.field + '**\n' + updateHighlight.before + ' → ' + updateHighlight.after,
      });
    }
  }

  embed.setTimestamp(task.updated ? new Date(task.updated) : new Date());

  return embed;
}

/**
 * Build a dedicated alert embed for reminder fired webhook events.
 *
 * @param {object} task
 * @param {string|undefined} projectName
 * @param {string|null} reminderInstant
 * @param {string|undefined} eventTime
 * @returns {EmbedBuilder}
 */
export function buildReminderFiredEmbed(task, projectName, reminderInstant, eventTime) {
  const embed = new EmbedBuilder()
    .setColor(0xf39c12)
    .setTitle('Reminder: ' + task.title)
    .setFooter({ text: 'Task ID: ' + task.id });

  const summary = pickTaskDescription(task);
  if (summary) {
    const formattedSummary = formatTaskDescription(summary);
    embed.setDescription(formattedSummary.length > 240
      ? formattedSummary.slice(0, 239).trimEnd() + '…'
      : formattedSummary);
  } else {
    embed.setDescription('A scheduled reminder was triggered for this task.');
  }

  if (reminderInstant) {
    const reminderDate = DateTime.fromISO(String(reminderInstant), { zone: 'utc' });
    if (reminderDate.isValid) {
      embed.addFields({ name: 'Reminder Time', value: reminderDate.setZone(config.bot.timeZone).toFormat("yyyy-MM-dd HH:mm '('ZZZZ')'"), inline: true });
    }
  }

  if (task.due_date && task.due_date !== '0001-01-01T00:00:00Z') {
    const due = new Date(task.due_date);
    embed.addFields({ name: 'Due Date', value: due.toUTCString(), inline: true });
  }

  const resolvedProjectName = projectName
    ?? task?.project?.title
    ?? task?.project_title
    ?? (task.project_id ? '#' + task.project_id : undefined);

  if (resolvedProjectName) {
    embed.addFields({ name: 'Project', value: String(resolvedProjectName), inline: true });
  }

  const assigneesFieldValue = formatTaskAssigneesForEmbed(task);
  if (assigneesFieldValue) {
    embed.addFields({ name: 'Assignees', value: assigneesFieldValue });
  }

  embed.addFields({
    name: 'Status',
    value: task.done ? 'Done' : 'Pending',
    inline: true,
  });

  const timestamp = eventTime ? new Date(eventTime) : null;
  if (timestamp && !Number.isNaN(timestamp.getTime())) {
    embed.setTimestamp(timestamp);
  } else {
    embed.setTimestamp(task.updated ? new Date(task.updated) : new Date());
  }

  return embed;
}

function pickTaskDescription(task) {
  const candidates = [
    task?.description,
    task?.description_html,
    task?.descriptionHtml,
    task?.content,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return '';
}

function decodeHtmlEntities(input) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function formatTaskDescription(description) {
  let text = String(description ?? '');

  text = decodeHtmlEntities(text);

  // Preserve task checklist semantics where Vikunja encodes done state on <li>.
  text = text
    .replace(/<li[^>]*data-checked\s*=\s*"true"[^>]*>/gi, '\n- [x] ')
    .replace(/<li[^>]*data-checked\s*=\s*"false"[^>]*>/gi, '\n- [ ] ')
    .replace(/<li[^>]*>/gi, '\n- ');

  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/ul>/gi, '\n')
    .replace(/<\/ol>/gi, '\n');

  // Drop remaining markup after preserving structure above.
  text = text.replace(/<[^>]+>/g, '');

  // Clean up line noise and spacing while preserving paragraph separation.
  text = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || 'No description.';
}

/**
 * Build a simple error embed.
 * @param {string} message
 * @returns {EmbedBuilder}
 */
export function buildErrorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xe74c3c)
    .setTitle('Error')
    .setDescription(message);
}

/**
 * Build a simple success embed.
 * @param {string} message
 * @returns {EmbedBuilder}
 */
export function buildSuccessEmbed(message) {
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('Success')
    .setDescription(message);
}

/**
 * Build an embed for a list of projects.
 * @param {object[]} projects
 * @returns {EmbedBuilder}
 */
export function buildProjectListEmbed(projects) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Vikunja Projects')
    .setTimestamp();

  if (!projects.length) {
    embed.setDescription('No projects found.');
    return embed;
  }

  const lines = projects
    .slice(0, 25) // Discord embeds support at most 25 fields
    .map((p) => '`' + p.id + '` — ' + p.title);

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Build an embed for a list of tasks.
 * @param {object[]} tasks
 * @param {string}   title  - Embed title
 * @returns {EmbedBuilder}
 */
export function buildTaskListEmbed(tasks, title) {
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(title ?? 'Tasks')
    .setTimestamp();

  if (!tasks.length) {
    embed.setDescription('No tasks found.');
    return embed;
  }

  const lines = tasks.slice(0, 25).map((t) => {
    const status = t.done ? '✅' : '🔲';
    return status + ' `' + t.id + '` — ' + t.title;
  });

  embed.setDescription(lines.join('\n'));

  if (tasks.length > 25) {
    embed.setFooter({ text: 'Showing 25 of ' + tasks.length + ' tasks.' });
  }

  return embed;
}
