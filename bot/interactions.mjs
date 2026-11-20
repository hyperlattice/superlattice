import { MessageFlags } from 'discord.js';
import { commands } from './commands/index.mjs';

export function createInteractionHandler(context, { logger = console } = {}) {
  return async interaction => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (!interaction.inGuild() || (context.config.guildId && interaction.guildId !== context.config.guildId)) {
        await interaction.reply({ content: 'Use this command in the configured server.', flags: MessageFlags.Ephemeral });
        return;
      }
      const command = commands.get(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'Unknown command. Run /help for available commands.', flags: MessageFlags.Ephemeral });
        return;
      }
      await command.execute(interaction, { ...context, commands });
    } catch {
      // Discord errors can include request bodies and credentials; never log them.
      logger.error('Slash command failed. Check Discord connectivity and channel permissions.');
      try {
        const message = { content: 'Unable to complete this command. Please try again.' };
        if (interaction.deferred) await interaction.editReply({ ...message, embeds: [] });
        else if (interaction.replied) await interaction.followUp({ ...message, flags: MessageFlags.Ephemeral });
        else await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
      } catch { logger.error('Unable to send command error response.'); }
    }
  };
}
