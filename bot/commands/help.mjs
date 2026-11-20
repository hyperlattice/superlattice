import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('List available Superlattice commands.');
export async function execute(interaction, { commands }) {
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x238636).setTitle('Superlattice commands')
    .addFields([...commands.values()].map(command => ({ name: `/${command.data.name}`, value: command.data.description })))] });
}
