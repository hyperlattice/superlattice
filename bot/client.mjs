import { Client, Events, GatewayIntentBits } from 'discord.js';
import { createInteractionHandler } from './interactions.mjs';

export function createBot(context, { logger = console } = {}) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    presence: { status: 'online' },
    allowedMentions: { parse: [], repliedUser: false },
    rest: { timeout: 15_000, retries: 2, rejectOnRateLimit: () => true },
  });
  client.on(Events.InteractionCreate, createInteractionHandler({ ...context, client }, { logger }));
  client.on(Events.Error, () => logger.error('Discord client error. Check connectivity.'));
  client.on(Events.ShardError, () => logger.error('Discord Gateway connection error.'));
  client.on(Events.ShardDisconnect, () => logger.warn('Discord Gateway disconnected; awaiting reconnection.'));
  client.rest.on('error', () => logger.error('Discord REST request failed.'));
  return client;
}

export async function connectBot(client, config, { timeoutMs = 60_000, signal } = {}) {
  let timer;
  let onReady;
  let onAbort;
  const ready = new Promise(resolve => { onReady = resolve; client.once(Events.ClientReady, onReady); });
  try {
    await Promise.race([
      (async () => { await client.login(config.token); await ready; })(),
      new Promise((_, reject) => {
        onAbort = () => reject(new Error('Discord startup cancelled.'));
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Discord connection timed out.')), timeoutMs); }),
    ]);
    if (client.application.id !== config.clientId) throw new Error('Discord application ID mismatch.');
  } catch {
    throw new Error('Discord startup failed. Check DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID and connectivity.');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    client.off(Events.ClientReady, onReady);
  }
}
