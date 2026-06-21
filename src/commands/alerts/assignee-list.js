import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { listAssigneeLinks } from '../../services/assignee-links.js';

export const data = new SlashCommandBuilder()
  .setName('alert-assignee-list')
  .setDescription('List Vikunja assignee to Discord reminder ping links');

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

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
}