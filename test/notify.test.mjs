import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildMessage, sendMessage } from '../scripts/notify.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/pr.json', import.meta.url)));
const webhook = 'https://discord.com/api/webhooks/123/fake-test-token';
const pr = () => structuredClone(fixture);

test('PR alert shows description, author, assignees, user and team reviewers', () => {
  const message = buildMessage('pull_request_target', pr());
  const embed = message.embeds[0];
  assert.match(embed.title, /PR #42 review requested/);
  assert.equal(embed.url, fixture.pull_request.html_url);
  assert.equal(embed.description, fixture.pull_request.body);
  assert.equal(embed.fields.find(f => f.name === 'Assignees').value, '@maintainer');
  assert.equal(embed.fields.find(f => f.name === 'Requested reviewers').value, '@reviewer, @hyperlattice/backend');
  assert.deepEqual(message.allowed_mentions, { parse: [] });
});

test('issue assignment displays description and changed assignee without reviewers', () => {
  const event = { ...pr(), action: 'assigned', issue: fixture.pull_request, assignee: { login: 'maintainer' } };
  const embed = buildMessage('issues', event).embeds[0];
  assert.match(embed.title, /Issue #42 assigned/);
  assert.equal(embed.fields.find(f => f.name === 'Changed person or team').value, '@maintainer');
  assert.ok(!embed.fields.some(f => f.name === 'Requested reviewers'));
});

test('removed reviewer and team remain visible after leaving requested lists', () => {
  for (const team of [false, true]) {
    const event = pr();
    event.action = 'review_request_removed';
    event.pull_request.requested_reviewers = [];
    event.pull_request.requested_teams = [];
    if (team) { delete event.requested_reviewer; event.requested_team = { slug: 'backend' }; }
    const embed = buildMessage('pull_request_target', event).embeds[0];
    assert.match(embed.title, /review request removed/);
    assert.equal(embed.fields.find(f => f.name === 'Requested reviewers').value, 'None');
    assert.equal(embed.fields.find(f => f.name === 'Changed person or team').value, team ? '@backend' : '@reviewer');
  }
});

test('all configured actions produce alerts, merge is distinct, unrelated events skip', () => {
  for (const action of ['opened', 'edited', 'reopened', 'closed', 'assigned', 'unassigned',
    'review_requested', 'review_request_removed', 'ready_for_review', 'converted_to_draft']) {
    const event = pr(); event.action = action;
    assert.ok(buildMessage('pull_request_target', event));
  }
  const event = pr(); event.action = 'closed'; event.pull_request.merged = true;
  assert.match(buildMessage('pull_request_target', event).embeds[0].title, /merged/);
  assert.equal(buildMessage('push', event), null);
  assert.equal(buildMessage('pull_request_target', { ...event, action: 'synchronize' }), null);
  assert.equal(buildMessage('issues', { ...event, issue: { pull_request: {} } }), null);
});

test('missing descriptions and reviewer lists render readable fallbacks', () => {
  const event = pr();
  event.pull_request.body = null;
  delete event.pull_request.requested_reviewers;
  delete event.pull_request.requested_teams;
  event.pull_request.assignees = [];
  const embed = buildMessage('pull_request_target', event).embeds[0];
  assert.match(embed.description, /No description/);
  assert.equal(embed.fields.find(f => f.name === 'Assignees').value, 'None');
  assert.equal(embed.fields.find(f => f.name === 'Requested reviewers').value, 'None');
});

test('large Unicode payload fits Discord per-field and 6000-character embed limits', () => {
  const event = pr();
  event.pull_request.title = '🚀'.repeat(500);
  event.pull_request.body = '🚀'.repeat(10000);
  event.pull_request.assignees = Array.from({ length: 200 }, () => ({ login: 'a'.repeat(39) }));
  event.pull_request.requested_reviewers = event.pull_request.assignees;
  const embed = buildMessage('pull_request_target', event).embeds[0];
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.match(embed.description, /Read the full description/);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024);
  const text = embed.title + embed.description + embed.footer.text + embed.fields.map(f => f.name + f.value).join('');
  assert.ok(text.length <= 6000);
  assert.ok(text.isWellFormed());
});

test('sender posts formatted event JSON with receipt confirmation and mentions disabled', async () => {
  const message = buildMessage('pull_request_target', pr());
  await sendMessage(webhook, message, { fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('wait'), 'true');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), message);
    return new Response('{}', { status: 200 });
  } });
});

test('429 honors fractional retry_after, then retries server and network failures', async () => {
  let calls = 0;
  const delays = [];
  await sendMessage(webhook, {}, {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return new Response('{"retry_after":0.25}', { status: 429 });
      if (calls === 2) return new Response('', { status: 503 });
      if (calls === 3) throw new Error(webhook);
      return new Response('{}');
    },
    sleepImpl: async delay => delays.push(delay),
  });
  assert.equal(calls, 4);
  assert.deepEqual(delays, [250, 2000, 4000]);
});

test('permanent errors stop immediately and never expose webhook or response body', async () => {
  let calls = 0;
  await assert.rejects(sendMessage(webhook, {}, { fetchImpl: async () => {
    calls++; return new Response(webhook, { status: 401 });
  } }), error => error.message.includes('401') && !error.message.includes('fake-test-token'));
  assert.equal(calls, 1);
  await assert.rejects(sendMessage(webhook, {}, {
    fetchImpl: async () => { throw new Error(webhook); }, sleepImpl: async () => {},
  }), error => /four attempts/.test(error.message) && !error.message.includes('fake-test-token'));
});

test('invalid webhook hosts, redirects, and /github suffix are refused before sending', async () => {
  for (const url of ['', 'https://example.com/api/webhooks/123/token', webhook + '/github', webhook.replace('https:', 'http:')]) {
    await assert.rejects(sendMessage(url, {}, { fetchImpl: () => assert.fail('Must not send') }));
  }
});

test('manual setup test and CLI preview work without a webhook secret', () => {
  assert.match(buildMessage('workflow_dispatch', {}).content, /connected/);
  const result = spawnSync(process.execPath, ['scripts/notify.mjs', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: 'test/fixtures/pr.json', DISCORD_WEBHOOK_URL: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).embeds[0].url, fixture.pull_request.html_url);
});
