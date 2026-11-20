import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { buildMessage } from '../scripts/notify.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/pr.json', import.meta.url)));
const pr = () => structuredClone(fixture);

test('PR alert shows description, author, assignees, user and team reviewers', () => {
  const message = buildMessage('pull_request', pr());
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
    const embed = buildMessage('pull_request', event).embeds[0];
    assert.match(embed.title, /review request removed/);
    assert.equal(embed.fields.find(f => f.name === 'Requested reviewers').value, 'None');
    assert.equal(embed.fields.find(f => f.name === 'Changed person or team').value, team ? '@backend' : '@reviewer');
  }
});

test('all configured actions produce alerts, merge is distinct, unrelated events skip', () => {
  for (const action of ['opened', 'edited', 'reopened', 'closed', 'assigned', 'unassigned',
    'review_requested', 'review_request_removed', 'ready_for_review', 'converted_to_draft']) {
    const event = pr(); event.action = action;
    assert.ok(buildMessage('pull_request', event));
  }
  const event = pr(); event.action = 'closed'; event.pull_request.merged = true;
  assert.match(buildMessage('pull_request', event).embeds[0].title, /merged/);
  assert.equal(buildMessage('push', event), null);
  assert.equal(buildMessage('pull_request', { ...event, action: 'synchronize' }), null);
  assert.equal(buildMessage('issues', { ...event, issue: { pull_request: {} } }), null);
});

test('missing descriptions and reviewer lists render readable fallbacks', () => {
  const event = pr();
  event.pull_request.body = null;
  delete event.pull_request.requested_reviewers;
  delete event.pull_request.requested_teams;
  event.pull_request.assignees = [];
  const embed = buildMessage('pull_request', event).embeds[0];
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
  const embed = buildMessage('pull_request', event).embeds[0];
  assert.ok(embed.title.length <= 256);
  assert.ok(embed.description.length <= 4096);
  assert.match(embed.description, /Read the full description/);
  for (const field of embed.fields) assert.ok(field.value.length <= 1024);
  const text = embed.title + embed.description + embed.footer.text + embed.fields.map(f => f.name + f.value).join('');
  assert.ok(text.length <= 6000);
  assert.ok(text.isWellFormed());
});

test('manual setup test and CLI preview work without a webhook secret', () => {
  assert.match(buildMessage('workflow_dispatch', {}).content, /connected/);
  const result = spawnSync(process.execPath, ['scripts/notify.mjs', '--dry-run'], {
    encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_NAME: 'pull_request', GITHUB_EVENT_PATH: 'test/fixtures/pr.json', DISCORD_BOT_TOKEN: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).embeds[0].url, fixture.pull_request.html_url);
});
