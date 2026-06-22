import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { listAssigneeLinks, linkAssigneeToDiscordUser, unlinkAssigneeFromDiscordUser } from '../../services/assignee-links.js';
import { autocompleteKnownAssignees, resolveKnownAssigneeSelection } from '../../services/vikunja-assignees.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('alert-assignee')
  .setDescription('Manage Vikunja assignee reminder ping links')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('link')
      .setDescription('Link a Vikunja assignee identity to a Discord user for reminder pings')
      .addStringOption((opt) =>
        opt.setName('assignee')
          .setDescription('Vikunja assignee (global across your connected instance)')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addUserOption((opt) =>
        opt.setName('discord-user')
          .setDescription('Discord user to ping for this assignee')
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('unlink')
      .setDescription('Remove an assignee-to-Discord reminder ping link')
      .addStringOption((opt) =>
        opt.setName('assignee')
          .setDescription('Vikunja assignee identity to unlink')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List Vikunja assignee to Discord reminder ping links')
  );

export async function execute(interaction) {
  await interaction.deferReply({ flags: 64 });

  const action = interaction.options.getSubcommand(true);

  if (action === 'list') {
    const links = await listAssigneeLinks();

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Reminder Ping Links')
      .setTimestamp();

    if (!links.length) {
      embed.setDescription('No assignee links configured yet.');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const lines = links.slice(0, 25).map((link) => {
      const assignee = link.vikunjaDisplayName
        || (link.vikunjaUsername ? '@' + link.vikunjaUsername : null)
        || ('User #' + link.vikunjaUserId);
      return '- ' + assignee + ' -> <@' + link.discordUserId + '>';
    });

    embed.setDescription(lines.join('\n'));

    if (links.length > 25) {
      embed.setFooter({ text: 'Showing 25 of ' + links.length + ' links.' });
    }

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const assigneeSelection = interaction.options.getString('assignee', true);
  const knownAssignee = await resolveKnownAssigneeSelection(assigneeSelection).catch(() => null);
  const assignee = knownAssignee ?? parseManualAssigneeSelection(assigneeSelection);

  if (!assignee) {
    await interaction.editReply({
      embeds: [
        buildErrorEmbed(
          'Could not identify assignee `' + assigneeSelection + '`.'
          + '\nUse autocomplete or enter `id:<vikunja_user_id>` / `username:<vikunja_username>`.'
        ),
      ],
    });
    return;
  }

  if (action === 'link') {
    const discordUser = interaction.options.getUser('discord-user', true);

    try {
      await linkAssigneeToDiscordUser(assignee, discordUser.id);

      const assigneeLabel = assignee.displayName || assignee.username || ('User #' + assignee.id);
      await interaction.editReply({
        embeds: [
          buildSuccessEmbed(
            'Linked Vikunja assignee `' + assigneeLabel + '` to <@' + discordUser.id + '>.'
            + '\nReminder alerts for tasks assigned to this user will mention them in Discord.'
          ),
        ],
      });
    } catch (err) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Could not store assignee link: ' + (err.message ?? 'Unknown error'))],
      });
    }
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