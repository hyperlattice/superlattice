import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder().setName('status').setDescription('Show bot and GitHub receiver health.');
export async function execute(interaction, { client, config, receiverStatus, startedAt }) {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x238636).setTitle('Superlattice status')
    .addFields(
      { name: 'Bot', value: client.isReady() ? 'Online' : 'Connecting', inline: true },
      { name: 'Uptime', value: `${Math.floor(seconds / 86400)}d ${Math.floor(seconds / 3600) % 24}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`, inline: true },
      { name: 'Memory', value: `${(process.memoryUsage().rss / 1024 ** 2).toFixed(1)} MiB RSS`, inline: true },
      { name: 'Discord latency', value: client.ws.ping < 0 ? 'Measuring…' : `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'GitHub receiver', value: receiverStatus(), inline: true },
      { name: 'GitHub organization', value: config.organization, inline: true },
    ).setTimestamp()] });
}
