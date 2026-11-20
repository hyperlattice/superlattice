import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createBot, connectBot } from '../bot/client.mjs';
import { createMessageSender } from '../bot/delivery.mjs';
import { readDiscordConfig } from '../lib/config.mjs';

import { buildMessage } from '../lib/notifications.mjs';
export { buildMessage } from '../lib/notifications.mjs';

export async function main(env = process.env, argv = process.argv.slice(2)) {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_EVENT_NAME) {
    throw new Error('GITHUB_EVENT_PATH and GITHUB_EVENT_NAME are required. See README.md for a local preview.');
  }
  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const message = buildMessage(env.GITHUB_EVENT_NAME, payload);
  if (!message) { console.log('Event skipped.'); return; }
  if (argv.includes('--dry-run')) { console.log(JSON.stringify(message, null, 2)); return; }
  const config = readDiscordConfig(env);
  const client = createBot({ config, startedAt: Date.now(), receiverStatus: () => 'Not running (CLI)' });
  try {
    await connectBot(client, config);
    await createMessageSender(client, config)(message);
  } finally { await client.destroy(); }
  console.log('Discord alert delivered.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Notification failed. Check event input and Discord configuration.'); process.exitCode = 1; });
}
