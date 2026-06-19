import { Events } from 'discord.js';
import { buildErrorEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;
export const once = false;

/**
 * @param {import('discord.js').Interaction} interaction
 * @param {import('discord.js').Collection<string, {data: object, execute: Function}>} commands
 */
export async function execute(interaction, commands) {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);

  if (!command) {
    console.error('[Interaction] Unknown command: ' + interaction.commandName);
    await interaction.reply({
      embeds: [buildErrorEmbed('Unknown command: `' + interaction.commandName + '`')],
      ephemeral: true,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error('[Interaction] Error executing command ' + interaction.commandName, err);
    const embed = buildErrorEmbed('An unexpected error occurred while running this command.');
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ embeds: [embed] }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [embed], ephemeral: true }).catch(() => {});
    }
  }
}
