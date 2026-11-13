import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { DeliveryStore } from './lib/deliveries.mjs';
import { createReceiver } from './lib/receiver.mjs';
import { sendMessage } from './scripts/notify.mjs';

const directory = process.env.DATA_DIR || './data';
mkdirSync(directory, { recursive: true });
const store = new DeliveryStore(join(directory, 'deliveries.sqlite'));
if (process.argv.includes('--retry-failed')) {
  console.log(`Requeued ${store.retryFailed()} failed deliveries.`);
  store.close();
} else {
  if (!process.env.DISCORD_WEBHOOK_URL) throw new Error('Set DISCORD_WEBHOOK_URL.');
  const server = createReceiver({
    secret: process.env.GITHUB_WEBHOOK_SECRET,
    organization: process.env.GITHUB_ORGANIZATION || 'hyperlattice', store,
  });
  let running = true;
  let serving = false;
  const worker = async () => {
    while (running) {
      try {
        if (!await store.deliverOne(message => sendMessage(process.env.DISCORD_WEBHOOK_URL, message))) {
          store.prune();
          await sleep(1000);
        }
      } catch {
        console.error('Delivery queue unavailable. Check persistent storage.');
        await sleep(5000);
      }
    }
  };
  let workerPromise;
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {
    serving = true;
    console.log('GitHub webhook receiver listening.');
    workerPromise = worker();
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    running = false;
    if (serving) await new Promise(resolve => server.close(resolve));
    await workerPromise;
    store.close();
  });
}
