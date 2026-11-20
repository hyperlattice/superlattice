import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder().setName('github').setDescription('Show the monitored GitHub organization and events.');
export async function execute(interaction, { config }) {
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x238636)
    .setTitle(config.organization).setURL(`https://github.com/${config.organization}`)
    .setDescription('Monitoring issues and pull requests across all repositories owned by this organization.')
    .addFields(
      { name: 'Issues', value: 'Opened, edited, reopened, closed, assigned, unassigned.' },
      { name: 'Pull requests', value: 'Opened, edited, reopened, closed or merged, assigned, unassigned, review requested or removed, ready for review, converted to draft.' },
    )] });
}
