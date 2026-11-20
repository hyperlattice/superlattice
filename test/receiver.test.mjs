import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeliveryStore } from '../lib/deliveries.mjs';
import { createReceiver } from '../lib/receiver.mjs';
import { createMessageSender } from '../bot/delivery.mjs';
import { PermissionFlagsBits } from 'discord.js';

const secret = 'a'.repeat(64);
const fixture = JSON.parse(await readFile(new URL('./fixtures/pr.json', import.meta.url)));

async function listen(server) {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'discordbot-'));
  const path = join(directory, 'queue.sqlite');
  const store = new DeliveryStore(path);
  const server = createReceiver({ secret, organization: 'hyperlattice', store });
  const url = await listen(server);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { store, path, url };
}

function post(url, { payload = fixture, event = 'pull_request', id = 'delivery-1', signature, raw } = {}) {
  const body = raw ?? JSON.stringify(payload);
  return fetch(url + '/github/webhook', {
    method: 'POST', body,
    headers: {
      'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': id,
      'x-hub-signature-256': signature ?? 'sha256=' + createHmac('sha256', secret).update(body).digest('hex'),
    },
  });
}

test('signed PR is visible to a reopened database connection and delivers through the bot without duplicates', async t => {
  const { store, path, url } = await setup(t);
  assert.equal((await post(url)).status, 202);
  const restarted = new DeliveryStore(path);
  let outgoing;
  const channel = {
    guildId: 'guild', isSendable: () => true, isThread: () => false,
    permissionsFor: () => ({ has: bits => bits.includes(PermissionFlagsBits.EmbedLinks) }),
    send: async payload => { outgoing = payload; return { id: '123' }; },
  };
  const client = { isReady: () => true, channels: { fetch: async () => channel }, user: {} };
  try {
    assert.equal(await restarted.deliverOne(createMessageSender(client, { channelId: 'channel' })), true);
    assert.equal(outgoing.embeds[0].description, fixture.pull_request.body);
    assert.equal(outgoing.embeds[0].fields.find(f => f.name === 'Requested reviewers').value, '@reviewer, @hyperlattice/backend');
    assert.deepEqual(outgoing.allowedMentions, { parse: [], repliedUser: false });
    const duplicate = await post(url);
    assert.equal(await duplicate.text(), 'Already received');
    assert.equal(await store.deliverOne(() => assert.fail('Duplicate must not send')), false);
  } finally { restarted.close(); }
});

test('one organization webhook accepts different current and future repositories', async t => {
  const { store, url } = await setup(t);
  for (const [index, name] of ['rl_traffic', 'marine_ml', 'future-repo'].entries()) {
    const payload = structuredClone(fixture);
    payload.repository.full_name = `hyperlattice/${name}`;
    payload.pull_request.html_url = `https://github.com/hyperlattice/${name}/pull/42`;
    assert.equal((await post(url, { payload, id: `delivery-${index}` })).status, 202);
  }
  const repositories = [];
  while (await store.deliverOne(async message => repositories.push(message.embeds[0].footer.text.split(' • ')[0]))) {}
  assert.deepEqual(repositories.sort(), ['hyperlattice/future-repo', 'hyperlattice/marine_ml', 'hyperlattice/rl_traffic']);
});

test('invalid signatures, altered bodies, wrong organization, malformed JSON, and oversized bodies never queue', async t => {
  const { store, url } = await setup(t);
  for (const signature of ['', 'sha256=bad', 'sha256=' + '0'.repeat(64)]) {
    assert.equal((await post(url, { signature })).status, 401);
  }
  const signature = 'sha256=' + createHmac('sha256', secret).update(JSON.stringify(fixture)).digest('hex');
  assert.equal((await post(url, { raw: JSON.stringify(fixture) + ' ', signature })).status, 401);
  const payload = structuredClone(fixture); payload.repository.owner.login = 'another-org';
  assert.equal((await post(url, { payload })).status, 403);
  assert.equal((await post(url, { raw: '{' })).status, 400);
  assert.equal((await post(url, { raw: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413);
  assert.equal(await store.deliverOne(() => assert.fail('Invalid request queued')), false);
});

test('health, signed ping, unsupported events, and method/path checks', async t => {
  const { url } = await setup(t);
  assert.equal(await (await fetch(url + '/healthz')).text(), 'ok');
  assert.equal(await (await post(url, { event: 'ping', payload: { zen: 'test' } })).text(), 'pong');
  assert.equal((await post(url, { event: 'push' })).status, 204);
  assert.equal((await post(url, { payload: { ...fixture, action: 'synchronize' } })).status, 204);
  assert.equal((await fetch(url + '/github/webhook')).status, 405);
  assert.equal((await fetch(url + '/unknown')).status, 404);
  assert.equal((await fetch(url + '/github/webhook', { method: 'POST', body: '{}' })).status, 415);
});

test('queued deliveries persist, retry after failure, and can recover from terminal failure', async t => {
  const { store } = await setup(t);
  store.enqueue('retry-1', { content: 'retry me' });
  const start = Date.now() + 1000;
  let attempts = 0;
  await store.deliverOne(async () => { attempts++; throw new Error('Offline'); }, start);
  assert.equal(await store.deliverOne(() => assert.fail('Too early'), start + 29_000), false);
  await store.deliverOne(async message => { attempts++; assert.equal(message.content, 'retry me'); }, start + 30_000);
  assert.equal(attempts, 2);
  store.enqueue('failed-1', { content: 'failed' });
  for (let i = 0; i < 8; i++) await store.deliverOne(async () => { throw new Error('Offline'); }, start + (i + 1) * 3600_000);
  assert.equal(await store.deliverOne(() => assert.fail('Terminal failure must stop'), start + 10 * 3600_000), false);
  assert.equal(store.retryFailed(), 1);
  assert.equal(await store.deliverOne(async () => {}), true);
});

test('sent payloads are cleared, deduplication persists for 30 days, and prune retains pending work', async t => {
  const { store } = await setup(t);
  store.enqueue('sent-1', { content: 'private body' });
  const now = Date.now();
  await store.deliverOne(async () => {}, now);
  store.enqueue('pending-1', { content: 'unsent body' });
  assert.equal(store.db.prepare('SELECT message FROM deliveries WHERE id = ?').get('sent-1').message, '{}');
  store.prune(now + 31 * 86400_000);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM deliveries').get().n, 1);
  assert.equal(store.db.prepare('SELECT id FROM deliveries').get().id, 'pending-1');
});
