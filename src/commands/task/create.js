import { SlashCommandBuilder } from 'discord.js';
import { createTask } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import { buildTaskEmbed, buildErrorEmbed, buildTaskOpenLinkComponents } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-create')
  .setDescription('Create a new task in a Vikunja project')
  .addStringOption((opt) =>
    opt.setName('project')
      .setDescription('Project to add the task to')
      .setRequired(true)
      .setAutocomplete(true)
  )
  .addStringOption((opt) =>
    opt.setName('title')
      .setDescription('Task title')
      .setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName('description')
      .setDescription('Task description (optional)')
  )
  .addStringOption((opt) =>
    opt.setName('due')
      .setDescription('Due date in YYYY-MM-DD format (optional)')
  )
  .addIntegerOption((opt) =>
    opt.setName('priority')
      .setDescription('Priority: 0=Unset, 1=Low, 2=Medium, 3=High, 4=Urgent, 5=DO NOW')
      .setMinValue(0)
      .setMaxValue(5)
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply();

  const projectSelection = interaction.options.getString('project', true);
  const project = await resolveProjectSelection(projectSelection);
  if (!project) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
    });
    return;
  }

  const title = interaction.options.getString('title', true);
  const description = interaction.options.getString('description') ?? undefined;
  const dueRaw = interaction.options.getString('due') ?? undefined;
  const priority = interaction.options.getInteger('priority') ?? 0;

  const taskData = { title, priority };
  if (description) taskData.description = description;
  if (dueRaw) {
    const parsed = new Date(dueRaw);
    if (isNaN(parsed.getTime())) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Invalid due date. Use YYYY-MM-DD format.')],
      });
      return;
    }
    taskData.due_date = parsed.toISOString();
  }

  try {
    const res = await createTask(project.id, taskData);
    await interaction.editReply({
      embeds: [buildTaskEmbed(res.data, 'Created', project.title)],
      components: buildTaskOpenLinkComponents(res.data),
    });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to create task: ' + msg)] });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'project') return interaction.respond([]);

  const choices = await autocompleteProjects(focused.value);
  await interaction.respond(choices);
}
