import { ChannelType, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getAllProjects } from '../../services/vikunja.js';
import { autocompleteProjects, resolveProjectSelection } from '../../services/vikunja-lookups.js';
import {
  listProjectChannelLinks,
  removeProjectChannelLink,
  setProjectChannelLink,
} from '../../services/project-channel-links.js';
import { buildErrorEmbed, buildSuccessEmbed } from '../../utils/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('webhook-channel')
  .setDescription('Manage project-to-Discord channel routing for webhook posts')
  .addSubcommand((subcommand) =>
    subcommand
      .setName('set')
      .setDescription('Set the Discord channel for webhook posts from a project')
      .addStringOption((opt) =>
        opt.setName('project')
          .setDescription('Project to route')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addChannelOption((opt) =>
        opt.setName('channel')
          .setDescription('Discord channel that should receive this project\'s webhooks')
          .setRequired(true)
          .addChannelTypes(ChannelType.GuildText)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('remove')
      .setDescription('Remove the Discord channel mapping for a project')
      .addStringOption((opt) =>
        opt.setName('project')
          .setDescription('Project to unmap')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('list')
      .setDescription('List all project-to-channel webhook routing mappings')
  );

/**
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const action = interaction.options.getSubcommand(true);

  if (action === 'set') {
    const projectSelection = interaction.options.getString('project', true);
    const channel = interaction.options.getChannel('channel', true);

    const project = await resolveProjectSelection(projectSelection);
    if (!project) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
      });
      return;
    }

    await setProjectChannelLink(project.id, channel.id);
    await interaction.editReply({
      embeds: [
        buildSuccessEmbed(
          'Webhook channel set for project `' + project.title + '` -> <#' + channel.id + '>.'
        ),
      ],
    });
    return;
  }

  if (action === 'remove') {
    const projectSelection = interaction.options.getString('project', true);

    const project = await resolveProjectSelection(projectSelection);
    if (!project) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('Could not find a project matching `' + projectSelection + '`.')],
      });
      return;
    }

    const removed = await removeProjectChannelLink(project.id);
    if (!removed) {
      await interaction.editReply({
        embeds: [buildErrorEmbed('No webhook channel mapping currently exists for `' + project.title + '`.')],
      });
      return;
    }

    await interaction.editReply({
      embeds: [buildSuccessEmbed('Removed webhook channel mapping for `' + project.title + '`.')],
    });
    return;
  }

  if (action === 'list') {
    const links = await listProjectChannelLinks();

    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle('Webhook Channel Mappings')
      .setTimestamp();

    if (!links.length) {
      embed.setDescription('No project channel mappings configured yet.');
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const projects = await getAllProjects()
      .then((res) => (Array.isArray(res.data) ? res.data : []))
      .catch(() => []);

    const titleById = new Map(
      projects.map((project) => [Number(project.id), String(project.title ?? '').trim()])
    );

    const lines = links.slice(0, 25).map((link) => {
      const projectTitle = titleById.get(link.projectId) || ('Project #' + link.projectId);
      return '- `' + projectTitle + '` (#' + link.projectId + ') -> <#' + link.channelId + '>';
    });

    embed.setDescription(lines.join('\n'));

    if (links.length > 25) {
      embed.setFooter({ text: 'Showing 25 of ' + links.length + ' mappings.' });
    }

    await interaction.editReply({ embeds: [embed] });
  }
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused(true);

  if (focused.name === 'project') {
    const choices = await autocompleteProjects(focused.value);
    await interaction.respond(choices);
    return;
  }

  await interaction.respond([]);
}