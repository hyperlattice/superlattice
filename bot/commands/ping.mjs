import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';

export const data = new SlashCommandBuilder().setName('ping').setDescription('Check bot and WebSocket latency.');
export async function execute(interaction, { client }) {
  const start = Date.now();
  await interaction.deferReply();
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x238636).setTitle('Pong!')
    .addFields(
      { name: 'Bot latency', value: `${Date.now() - start} ms`, inline: true },
      { name: 'WebSocket latency', value: client.ws.ping < 0 ? 'Measuring…' : `${Math.round(client.ws.ping)} ms`, inline: true },
    )] });
}
