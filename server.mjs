import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DeliveryStore } from './lib/deliveries.mjs';
import { readConfig } from './lib/config.mjs';
import { createApplication } from './lib/application.mjs';
import { createBot } from './bot/client.mjs';

async function main() {
  if (process.argv.includes('--retry-failed')) {
    const directory = process.env.DATA_DIR || './data';
    mkdirSync(directory, { recursive: true });
    const store = new DeliveryStore(join(directory, 'deliveries.sqlite'));
    try { console.log(`Requeued ${store.retryFailed()} failed deliveries.`); } finally { store.close(); }
    return;
  }
  const config = readConfig();
  mkdirSync(config.directory, { recursive: true });
  const store = new DeliveryStore(join(config.directory, 'deliveries.sqlite'));
  let app;
  const client = createBot({ config, startedAt: Date.now(), receiverStatus: () => app.receiverStatus() });
  app = createApplication({ config, client, store });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    // Leave pending work durable if an external request never settles.
    const deadline = setTimeout(() => {
      console.error('Shutdown deadline exceeded; pending deliveries will resume on restart.');
      process.exit(1);
    }, 150_000);
    deadline.unref();
    app.stop().catch(() => {
      console.error('Unable to shut down cleanly.'); process.exitCode = 1;
    }).finally(() => clearTimeout(deadline));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try { await app.start(); } catch {
    if (!stopping) {
      process.exitCode = 1;
      console.error('Startup failed. Check bot credentials, application/channel IDs, permissions, network and storage.');
    }
    await app.stop();
  }
}

main().catch(error => {
  // Configuration errors contain variable names only, never their values.
  console.error(error.message?.match(/^(DISCORD_|GITHUB_|PORT )/) ? error.message : 'Application failed to start. Check configuration and storage.');
  process.exitCode = 1;
});
