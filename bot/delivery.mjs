import { PermissionFlagsBits } from 'discord.js';

export async function fetchDeliveryChannel(client, config) {
  const channel = await client.channels.fetch(config.channelId);
  if (!channel?.isSendable() || !channel.guildId) {
    throw new Error('DISCORD_CHANNEL_ID must identify a sendable server channel.');
  }
  if (config.guildId && channel.guildId !== config.guildId) throw new Error('Notification channel is outside DISCORD_GUILD_ID.');
  const permissions = channel.permissionsFor(client.user);
  const sendPermission = channel.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, sendPermission, PermissionFlagsBits.EmbedLinks])) {
    throw new Error('Bot needs View Channel, Send Messages and Embed Links in the notification channel.');
  }
  return channel;
}

export function createMessageSender(client, config) {
  return async message => {
    if (!client.isReady()) throw new Error('Discord is reconnecting.');
    try {
      const channel = await fetchDeliveryChannel(client, config);
      // Persisted payloads use the Discord API's snake_case; discord.js expects camelCase.
      const { allowed_mentions, ...body } = message;
      const sent = await channel.send({ ...body, allowedMentions: { parse: [], repliedUser: false } });
      if (!sent?.id) throw new Error('Discord did not confirm delivery.');
      return sent;
    } catch (error) {
      const failure = new Error('Discord delivery failed. Check connectivity and channel permissions.');
      // discord.js RateLimitError.timeToReset is milliseconds; API retry_after is seconds.
      failure.retryAfterMs = Number(error?.timeToReset ?? (error?.rawError?.retry_after * 1000)) || 0;
      throw failure;
    }
  };
}
