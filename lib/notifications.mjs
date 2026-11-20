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

