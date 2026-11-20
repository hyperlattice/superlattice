import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Events, GatewayIntentBits, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { readConfig, readDiscordConfig } from '../lib/config.mjs';
import { createBot, connectBot } from '../bot/client.mjs';
import { createMessageSender, fetchDeliveryChannel } from '../bot/delivery.mjs';
import { createInteractionHandler } from '../bot/interactions.mjs';
import { registerCommands } from '../bot/register.mjs';
import { DeliveryStore } from '../lib/deliveries.mjs';
import { createApplication } from '../lib/application.mjs';

const env = { DISCORD_BOT_TOKEN: 'fake-secret', DISCORD_CLIENT_ID: '123456789012345678',
  DISCORD_CHANNEL_ID: '223456789012345678', DISCORD_GUILD_ID: '323456789012345678', GITHUB_WEBHOOK_SECRET: 's'.repeat(64) };
const config = readConfig(env);
const logger = { log() {}, error() {}, warn() {} };
function mockClient(send = async () => ({ id: 'receipt' })) {
  const channel = { guildId: config.guildId, isSendable: () => true, isThread: () => false,
    permissionsFor: () => ({ has: () => true }), send };
  return { channel, client: { channels: { fetch: async id => { assert.equal(id, config.channelId); return channel; } },
    user: {}, isReady: () => true, destroy: async () => {} } };
}

test('configuration rejects missing values, invalid IDs, short secrets and invalid ports without leaking values', () => {
  for (const key of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CHANNEL_ID', 'GITHUB_WEBHOOK_SECRET']) {
    assert.throws(() => readConfig({ ...env, [key]: '' }), new RegExp(key));
  }
  for (const key of ['DISCORD_CLIENT_ID', 'DISCORD_CHANNEL_ID', 'DISCORD_GUILD_ID']) {
    assert.throws(() => readConfig({ ...env, [key]: 'bad-secret-value' }), error => !error.message.includes('bad-secret-value'));
  }
  assert.throws(() => readConfig({ ...env, GITHUB_WEBHOOK_SECRET: 'short' }), /32/);
  assert.throws(() => readConfig({ ...env, GITHUB_ORGANIZATION: 'bad/org' }), /GITHUB_ORGANIZATION/);
  for (const port of ['0', '65536', 'abc']) assert.throws(() => readConfig({ ...env, PORT: port }), /PORT/);
  assert.equal(readConfig({ ...env, DISCORD_GUILD_ID: '' }).guildId, undefined);
  assert.equal(readDiscordConfig({ ...env, DISCORD_CHANNEL_ID: '' }, { registration: true }).clientId, config.clientId);
});

test('bot uses only Guilds intent and suppresses mentions', async () => {
  const client = createBot({ config }, { logger });
  assert.equal(client.options.intents.bitfield, GatewayIntentBits.Guilds);
  assert.deepEqual(client.options.allowedMentions, { parse: [], repliedUser: false });
  await client.destroy();
});

test('startup waits for ready, validates application, and bounds failed connections', async () => {
  const client = new EventEmitter();
  client.application = { id: config.clientId };
  client.login = async token => { assert.equal(token, config.token); client.emit(Events.ClientReady); };
  await connectBot(client, config);
  client.application.id = 'wrong';
  await assert.rejects(connectBot(client, config), /startup failed/);
  client.login = () => new Promise(() => {});
  await assert.rejects(connectBot(client, config, { timeoutMs: 5 }), /startup failed/);
  assert.equal(client.listenerCount(Events.ClientReady), 0);
});

test('delivery uses fetched channel, disables all mentions, and awaits a confirmed receipt', async () => {
  let confirm;
  const { client } = mockClient(payload => {
    assert.equal(payload.content, '@everyone');
    assert.deepEqual(payload.allowedMentions, { parse: [], repliedUser: false });
    assert.equal('allowed_mentions' in payload, false);
    return new Promise(resolve => { confirm = resolve; });
  });
  let delivered = false;
  const pending = createMessageSender(client, config)({ content: '@everyone', allowed_mentions: { parse: ['everyone'] } }).then(() => { delivered = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false);
  confirm({ id: 'receipt' });
  await pending;
  assert.equal(delivered, true);
});

test('delivery refuses unsuitable channels, missing permissions, wrong server and missing receipt', async () => {
  const { client, channel } = mockClient();
  channel.isSendable = () => false;
  await assert.rejects(fetchDeliveryChannel(client, config), /sendable/);
  channel.isSendable = () => true;
  channel.guildId = 'other';
  await assert.rejects(fetchDeliveryChannel(client, config), /outside/);
  channel.guildId = config.guildId;
  channel.permissionsFor = () => null;
  await assert.rejects(fetchDeliveryChannel(client, config), /needs/);
  channel.isThread = () => true;
  channel.permissionsFor = () => ({ has: bits => bits.includes(PermissionFlagsBits.SendMessagesInThreads) });
  assert.equal(await fetchDeliveryChannel(client, config), channel);
  channel.send = async () => ({});
  await assert.rejects(createMessageSender(client, config)({}), /delivery failed/);
});

test('rate-limit and network failures remain durable, honor cooldown and retry successfully', async () => {
  const store = new DeliveryStore(':memory:');
  try {
    store.enqueue('retry', { content: 'hello' });
    const start = Date.now() + 1000;
    const { client, channel } = mockClient(async () => { throw Object.assign(new Error('fake-secret'), { timeToReset: 90_000 }); });
    const send = createMessageSender(client, config);
    await store.deliverOne(send, start);
    assert.equal(store.db.prepare('SELECT status FROM deliveries').get().status, 'pending');
    assert.equal(await store.deliverOne(() => assert.fail('Too soon'), start + 89_999), false);
    channel.send = async () => { throw new Error('network'); };
    await store.deliverOne(send, start + 90_000);
    channel.send = async () => ({ id: 'receipt' });
    await store.deliverOne(send, start + 150_000);
    assert.equal(store.db.prepare('SELECT status FROM deliveries').get().status, 'sent');
  } finally { store.close(); }
});

function interaction(commandName) {
  const calls = [];
  return { commandName, guildId: config.guildId, calls, inGuild: () => true, isChatInputCommand: () => true,
    async reply(payload) { calls.push(payload); this.replied = true; },
    async deferReply() { this.deferred = true; }, async editReply(payload) { calls.push(payload); },
    async followUp(payload) { calls.push(payload); } };
}
const context = { config, client: { isReady: () => true, ws: { ping: 42 } }, startedAt: Date.now() - 65_000, receiverStatus: () => 'Listening' };

test('all slash commands respond with expected embed contents', async () => {
  const handle = createInteractionHandler(context, { logger });
  const responses = {};
  for (const name of ['ping', 'status', 'github', 'help']) {
    const item = interaction(name); await handle(item);
    responses[name] = item.calls[0].embeds[0].toJSON();
  }
  assert.equal(responses.ping.title, 'Pong!');
  assert.equal(responses.ping.fields[1].value, '42 ms');
  assert.match(responses.ping.fields[0].value, /\d+ ms/);
  assert.equal(responses.status.fields.find(f => f.name === 'GitHub receiver').value, 'Listening');
  assert.match(responses.status.fields.find(f => f.name === 'Memory').value, /MiB/);
  assert.equal(responses.github.url, 'https://github.com/hyperlattice');
  assert.match(responses.github.fields[1].value, /merged/);
  assert.deepEqual(responses.help.fields.map(f => f.name), ['/ping', '/status', '/github', '/help']);
});

test('commands reject wrong servers, ignore noncommands, and handle errors before and after deferral', async () => {
  const handle = createInteractionHandler(context, { logger });
  const item = interaction('unknown'); await handle(item);
  assert.equal(item.calls[0].flags, MessageFlags.Ephemeral);
  const wrong = interaction('help'); wrong.guildId = 'other'; await handle(wrong);
  assert.match(wrong.calls[0].content, /configured server/);
  const noncommand = interaction('help'); noncommand.isChatInputCommand = () => false; await handle(noncommand);
  assert.equal(noncommand.calls.length, 0);
  const failed = interaction('help'); let first = true;
  failed.reply = async payload => { if (first) { first = false; throw new Error('fake-secret'); } failed.calls.push(payload); };
  await handle(failed);
  assert.match(failed.calls[0].content, /Unable/);
  const deferred = interaction('ping'); let attempts = 0;
  deferred.editReply = async payload => { if (++attempts === 1) throw new Error('offline'); deferred.calls.push(payload); };
  await handle(deferred);
  assert.match(deferred.calls[0].content, /Unable/);
});

test('registration bulk overwrites the selected scope without logging into Gateway', async () => {
  for (const guildId of [config.guildId, undefined]) {
    const calls = [];
    const rest = { put: async (...args) => calls.push(args) };
    assert.equal(await registerCommands({ ...config, guildId }, rest), 4);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], guildId ? `/applications/${config.clientId}/guilds/${guildId}/commands` : `/applications/${config.clientId}/commands`);
    assert.deepEqual(calls[0][1].body.map(command => command.name), ['ping', 'status', 'github', 'help']);
    if (!guildId) assert.deepEqual(calls[0][1].body[0].contexts, [0]);
  }
});

test('graceful stop waits for in-flight delivery, closes HTTP, destroys Discord and closes SQLite once', async () => {
  const store = new DeliveryStore(':memory:');
  store.enqueue('shutdown', { content: 'finish me' });
  let confirm;
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  let destroyed = 0;
  let closed = 0;
  const { client } = mockClient();
  client.destroy = async () => { destroyed++; };
  const close = store.close.bind(store);
  store.close = () => { closed++; close(); };
  const app = createApplication({ config: { ...config, port: 0 }, client, store, logger,
    connect: async () => {}, validateChannel: async () => {},
    send: () => { started(); return new Promise(resolve => { confirm = resolve; }); } });
  await app.start(); await sending;
  const url = `http://127.0.0.1:${app.server.address().port}/healthz`;
  assert.equal(await (await fetch(url)).text(), 'ok');
  const stopping = app.stop();
  assert.equal(app.stop(), stopping);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 0);
  confirm({ id: 'receipt' });
  await stopping;
  assert.equal(destroyed, 1); assert.equal(closed, 1);
  await assert.rejects(fetch(url));
});

test('startup failure releases bot and database resources', async () => {
  let destroyed = false; let closed = false;
  const { client } = mockClient(); client.destroy = async () => { destroyed = true; };
  const app = createApplication({ config, client, store: { close: () => { closed = true; } }, logger,
    connect: async () => { throw new Error('bad credentials'); } });
  await assert.rejects(app.start()); await app.stop();
  assert.equal(destroyed, true); assert.equal(closed, true);
});

test('SIGINT and SIGTERM drain a running application and preserve SQLite for reopening', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const directory = await mkdtemp(join(tmpdir(), 'superlattice-shutdown-'));
    const path = join(directory, 'deliveries.sqlite');
    const code = `
      import { DeliveryStore } from './lib/deliveries.mjs';
      import { createApplication } from './lib/application.mjs';
      const store = new DeliveryStore(${JSON.stringify(path)});
      store.enqueue('pending', {content:'persist'});
      const client = {isReady:()=>false, destroy:async()=>{}};
      const app = createApplication({config:${JSON.stringify({ ...config, port: 0 })},client,store,
        connect:async()=>{},validateChannel:async()=>{},logger:{log(){}}});
      for (const signal of ['SIGINT','SIGTERM']) process.once(signal,()=>app.stop());
      await app.start(); console.log('READY');
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
    const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
    const deadline = setTimeout(() => child.kill('SIGKILL'), 10_000);
    try {
      await new Promise((resolve, reject) => {
        child.stdout.on('data', chunk => { if (chunk.toString().includes('READY')) resolve(); });
        child.once('exit', () => reject(new Error(stderr)));
        child.once('error', reject);
      });
      child.kill(signal);
      assert.deepEqual(await exited, { code: 0, signal: null }, stderr);
      const reopened = new DeliveryStore(path);
      try { assert.equal(reopened.db.prepare('SELECT status FROM deliveries').get().status, 'pending'); }
      finally { reopened.close(); }
    } finally { clearTimeout(deadline); child.kill('SIGKILL'); await rm(directory, { recursive: true, force: true }); }
  }
});

test('SQLite payloads, retry timestamps and deduplication survive closing every database connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'superlattice-persistence-'));
  const path = join(directory, 'deliveries.sqlite');
  let store = new DeliveryStore(path);
  try {
    const start = Date.now() + 1000;
    store.enqueue('persistent', { content: 'saved across restart', allowed_mentions: { parse: [] } });
    await store.deliverOne(async () => { throw new Error('offline'); }, start);
    store.close();
    store = new DeliveryStore(path);
    assert.equal(store.enqueue('persistent', { content: 'duplicate' }), false);
    assert.equal(await store.deliverOne(() => assert.fail('Cooldown lost'), start + 29_000), false);
    await store.deliverOne(async message => { assert.equal(message.content, 'saved across restart'); }, start + 30_000);
    store.close();
    store = new DeliveryStore(path);
    assert.equal(store.enqueue('persistent', {}), false);
    assert.equal(store.db.prepare('SELECT status, attempts, message FROM deliveries').get().status, 'sent');
    assert.equal(await store.deliverOne(() => assert.fail('Sent twice')), false);
  } finally { store.close(); await rm(directory, { recursive: true, force: true }); }
});

test('registration can clear an old scope before moving to global commands', async () => {
  let body;
  await registerCommands(config, { put: async (_, options) => { body = options.body; } }, { clear: true });
  assert.deepEqual(body, []);
});
