import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const actions = {
  issues: new Set(['opened', 'edited', 'reopened', 'closed', 'assigned', 'unassigned']),
  pull_request: new Set(['opened', 'edited', 'reopened', 'closed', 'assigned',
    'unassigned', 'review_requested', 'review_request_removed', 'ready_for_review', 'converted_to_draft']),
};

function clip(value, limit) {
  const text = String(value ?? '');
  if (text.length <= limit) return text;
  return text.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

function people(users) {
  return users?.map(user => `@${user.login}`).join(', ') || 'None';
}

export function buildMessage(eventName, payload) {
  if (eventName === 'workflow_dispatch') {
    return { allowed_mentions: { parse: [] }, content: 'GitHub → Discord alerts are connected.' };
  }
  if (!actions[eventName]?.has(payload.action)) return null;
  const isPr = eventName === 'pull_request';
  const item = isPr ? payload.pull_request : payload.issue;
  if (!isPr && item?.pull_request) return null;
  if (!item || typeof item.title !== 'string' || typeof item.html_url !== 'string'
      || !Number.isInteger(item.number) || !payload.repository?.full_name) {
    throw new Error('Invalid GitHub issue or pull request event.');
  }
  const action = item.merged && payload.action === 'closed' ? 'merged' : payload.action.replaceAll('_', ' ');
  const fields = [
    { name: 'Author', value: clip(people(item.user ? [item.user] : []), 256), inline: true },
    { name: 'Assignees', value: clip(people(item.assignees), 700), inline: true },
  ];
  if (isPr) {
    const teams = item.requested_teams?.map(team => `@${payload.repository.owner?.login || payload.repository.full_name.split('/')[0]}/${team.slug}`) || [];
    const reviewers = [...(item.requested_reviewers?.map(user => `@${user.login}`) || []), ...teams];
    fields.push({ name: 'Requested reviewers', value: clip(reviewers.join(', ') || 'None', 700) });
  }
  const changed = payload.action.startsWith('review_')
    ? payload.requested_reviewer?.login || payload.requested_team?.slug
    : payload.assignee?.login;
  if (changed) fields.push({ name: 'Changed person or team', value: clip(`@${changed}`, 256) });
  const body = item.body?.trim() || '*No description provided.*';
  const description = body.length > 3000
    ? `${clip(body, 2900)}\n\n[Read the full description on GitHub](${item.html_url})`
    : body;
  return {
    allowed_mentions: { parse: [] },
    embeds: [{
      title: clip(`${isPr ? 'PR' : 'Issue'} #${item.number} ${action}: ${item.title}`, 256),
      url: item.html_url,
      description: clip(description, 3300),
      color: action === 'merged' ? 0x8957e5 : action === 'closed' ? 0xda3633 : 0x238636,
      fields,
      footer: { text: clip(`${payload.repository.full_name} • ${payload.sender?.login || 'GitHub'}`, 256) },
    }],
  };
}

export async function sendMessage(webhookUrl, message, { fetchImpl = fetch, sleepImpl = sleep } = {}) {
  let url;
  try { url = new URL(webhookUrl); } catch { throw new Error('Set DISCORD_WEBHOOK_URL to a Discord incoming webhook URL.'); }
  if (url.protocol !== 'https:' || !['discord.com', 'canary.discord.com', 'ptb.discord.com'].includes(url.hostname)
      || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname)
      || url.username || url.password || url.port) {
    throw new Error('DISCORD_WEBHOOK_URL must be a Discord incoming webhook URL without /github.');
  }
  url.searchParams.set('wait', 'true');
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message), signal: AbortSignal.timeout(15_000), redirect: 'error',
      });
    } catch {
      if (attempt === 3) throw new Error('Discord request failed after four attempts. Check connectivity.');
      await sleepImpl(1000 * 2 ** attempt);
      continue;
    }
    if (response.ok) return;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Discord rejected the message (HTTP ${response.status}). Check the webhook and channel permissions.`);
    }
    if (attempt === 3) throw new Error(`Discord delivery failed after four attempts (HTTP ${response.status}).`);
    let delay = 2 ** attempt;
    if (response.status === 429) {
      const details = await response.json().catch(() => ({}));
      const retryAfter = Number(details.retry_after ?? response.headers.get('retry-after'));
      if (Number.isFinite(retryAfter) && retryAfter > 0) delay = retryAfter;
      if (delay > 120) throw new Error('Discord rate limit exceeds 120 seconds. Retry this workflow later.');
    }
    await sleepImpl(Math.ceil(delay * 1000));
  }
}

export async function main(env = process.env, argv = process.argv.slice(2)) {
  if (!env.GITHUB_EVENT_PATH || !env.GITHUB_EVENT_NAME) {
    throw new Error('GITHUB_EVENT_PATH and GITHUB_EVENT_NAME are required. See README.md for a local preview.');
  }
  const payload = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const message = buildMessage(env.GITHUB_EVENT_NAME, payload);
  if (!message) { console.log('Event skipped.'); return; }
  if (argv.includes('--dry-run')) { console.log(JSON.stringify(message, null, 2)); return; }
  await sendMessage(env.DISCORD_WEBHOOK_URL, message);
  console.log('Discord alert delivered.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
