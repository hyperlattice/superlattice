import { setTimeout as sleep } from 'node:timers/promises';
import { createReceiver } from './receiver.mjs';
import { connectBot } from '../bot/client.mjs';
import { createMessageSender, fetchDeliveryChannel } from '../bot/delivery.mjs';

export function createApplication({ config, client, store, logger = console, connect = connectBot,
  validateChannel = fetchDeliveryChannel, send = createMessageSender(client, config) }) {
  const server = createReceiver({ secret: config.secret, organization: config.organization, store });
  const controller = new AbortController();
  let stopping = false;
  let startup;
  let worker;
  let shutdown;

  const wait = ms => sleep(ms, undefined, { signal: controller.signal }).catch(error => {
    if (error.name !== 'AbortError') throw error;
  });
  async function work() {
    while (!stopping) {
      try {
        // Do not burn retry attempts during Gateway reconnects.
        if (!client.isReady()) { await wait(1000); continue; }
        if (!await store.deliverOne(send)) { store.prune(); await wait(1000); }
      } catch {
        logger.error('Delivery queue unavailable. Check persistent storage.');
        await wait(5000);
      }
    }
  }

  return {
    server,
    receiverStatus: () => stopping ? 'Stopping' : server.listening ? 'Listening' : 'Starting',
    start() {
      if (startup) return startup;
      startup = (async () => {
        await connect(client, config, { signal: controller.signal });
        if (stopping) return;
        await validateChannel(client, config);
        if (stopping) return;
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(config.port, '0.0.0.0', () => { server.off('error', reject); resolve(); });
        });
        server.on('error', () => logger.error('GitHub receiver encountered a server error.'));
        logger.log('Discord bot online; GitHub webhook receiver listening.');
        worker = work();
      })();
      return startup;
    },
    stop() {
      if (shutdown) return shutdown;
      stopping = true;
      controller.abort();
      shutdown = (async () => {
        await startup?.catch(() => {});
        try {
          if (server.listening) {
            const closed = new Promise(resolve => server.close(resolve));
            // Bound incomplete inbound requests while allowing active requests to finish.
            const timer = setTimeout(() => server.closeAllConnections(), 5000);
            try { await closed; } finally { clearTimeout(timer); }
          }
          await worker;
        } finally {
          try { await client.destroy(); } finally { store.close(); }
        }
      })();
      return shutdown;
    },
  };
}
