import { SlashCommandBuilder } from 'discord.js';
import { createTask } from '../../services/vikunja.js';
import { buildTaskEmbed, buildErrorEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('task-create')
  .setDescription('Create a new task in a Vikunja project')
  .addIntegerOption((opt) =>
    opt.setName('project')
      .setDescription('Project ID to add the task to')
      .setRequired(true)
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

  const projectId = interaction.options.getInteger('project', true);
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
    const res = await createTask(projectId, taskData);
    await interaction.editReply({ embeds: [buildTaskEmbed(res.data, 'Created')] });
  } catch (err) {
    const msg = err.response?.data?.message ?? err.message;
    await interaction.editReply({ embeds: [buildErrorEmbed('Failed to create task: ' + msg)] });
  }
}
