import { SlashCommandBuilder } from 'discord.js';
import { autocompleteKnownAssignees, resolveKnownAssigneeSelection } from '../../services/vikunja-assignees.js';
import { unlinkAssigneeFromDiscordUser } from '../../services/assignee-links.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('alert-assignee-unlink')
  .setDescription('Remove an assignee-to-Discord reminder ping link')
  .addStringOption((opt) =>
    opt.setName('assignee')
      .setDescription('Vikunja assignee identity to unlink')
      .setRequired(true)
      .setAutocomplete(true)
  );

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const assigneeSelection = interaction.options.getString('assignee', true);

  const knownAssignee = await resolveKnownAssigneeSelection(assigneeSelection).catch(() => null);
  const assignee = knownAssignee ?? parseManualAssigneeSelection(assigneeSelection);

  if (!assignee) {
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          'Could not identify assignee `' + assigneeSelection + '`.' +
          '\nUse autocomplete or enter `id:<vikunja_user_id>` / `username:<vikunja_username>`.'
        ),
      ],
    });
    return;
  }

  const removed = await unlinkAssigneeFromDiscordUser(assignee);
  if (!removed) {
    await interaction.editReply({
      embeds: [buildErrorEmbed('No link currently exists for that assignee.')],
    });
    return;
  }

  const assigneeLabel = assignee.displayName || assignee.username || ('User #' + assignee.id);
  await interaction.editReply({
    embeds: [buildSuccessEmbed('Removed reminder ping link for assignee `' + assigneeLabel + '`.')],
  });
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'assignee') {
    const choices = await autocompleteKnownAssignees(focused.value).catch(() => []);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}

function parseManualAssigneeSelection(rawInput) {
  const input = String(rawInput ?? '').trim();
  if (!input) return null;

  if (/^id:\d+$/i.test(input)) {
    return {
      id: Number(input.split(':')[1]),
      label: 'User #' + input.split(':')[1],
    };
  }

  if (/^\d+$/.test(input)) {
    return {
      id: Number(input),
      label: 'User #' + input,
    };
  }

  if (/^username:/i.test(input)) {
    const username = input.slice('username:'.length).trim();
    if (!username) return null;
    return {
      username,
      label: username,
    };
  }

  return {
    username: input,
    displayName: input,
    label: input,
  };
}