# GitHub alerts for Discord

Send issues and pull requests to a specific Discord text channel through GitHub Actions. Each alert includes the title, GitHub link, description, author, assignees, and requested PR reviewers, including teams. Reviewer and assignment changes send new alerts with the changed person or team.

The Discord webhook determines the destination channel. You need one incoming webhook and one GitHub Actions secret. You do not need a Discord application, bot token, hosted server, or GitHub repository webhook.

## Connect your channel

1. In Discord, open **Server Settings → Integrations → Webhooks**. You need permission to manage webhooks.
2. Create a webhook, name it `GitHub alerts`, and select the destination text channel.
3. Copy the webhook URL. Keep the URL private because anyone with it can post to that channel.
4. Open [this repository's Actions secrets](https://github.com/hyperlattice/discordbot/settings/secrets/actions).
5. Add a repository secret named `DISCORD_WEBHOOK_URL`. Paste the copied URL as its value.
6. Open [Actions](https://github.com/hyperlattice/discordbot/actions/workflows/discord-alerts.yml), select **Discord alerts**, and click **Run workflow** on `main`.
7. Confirm that the channel receives `GitHub → Discord alerts are connected.`

Use the normal webhook URL, such as `https://discord.com/api/webhooks/ID/TOKEN`. Do not append `/github`. That suffix belongs to Discord's separate built-in GitHub integration. This code posts its own message format.

Do not add anything under GitHub **Settings → Webhooks** for this implementation. GitHub Actions receives repository events directly.

## Monitor another repository

This installation monitors `hyperlattice/discordbot`. It does not automatically watch other repositories in the organization.

1. Copy `.github/workflows/discord-alerts.yml` and `scripts/notify.mjs` into the repository you want to monitor.
2. Commit both files to that repository's default branch.
3. Add its `DISCORD_WEBHOOK_URL` Actions secret with the same channel webhook, or use another webhook for a different channel.
4. Enable GitHub Actions if the repository has disabled it.
5. Run **Discord alerts** manually in that repository, then open an issue or request a PR review.

For many organization repositories, you can use an organization Actions secret and grant access to selected repositories. Each repository still needs the workflow and script. Only connect private repositories to a Discord channel whose members may read their content.

## Choose alert events

Edit the `types` lists in `.github/workflows/discord-alerts.yml` to adjust these defaults:

| Item | Events |
| --- | --- |
| Issues | Opened, edited, reopened, closed, assigned, unassigned |
| Pull requests | Opened, edited, reopened, closed or merged, assigned, unassigned, review requested, review request removed, ready for review, converted to draft |

Issues have assignees but no requested reviewers. PR alerts show the reviewers still requested at event time. Completed reviews do not send alerts. GitHub usernames appear as text; alerts do not ping Discord users or roles. Descriptions longer than 3000 characters show an excerpt and a link to the full description.

Every event sends a new message. Actions can queue notifications, and rerunning a workflow or retrying an ambiguous network failure can duplicate a message. This implementation does not keep a synchronized message per issue.

## Preview and test locally

Install Node.js 24 or later. There are no npm dependencies to install.

In PowerShell:

```powershell
$env:GITHUB_EVENT_NAME = 'pull_request_target'
$env:GITHUB_EVENT_PATH = 'test/fixtures/pr.json'
npm run preview
npm test
```

The preview prints the Discord payload without sending it. Tests check formatting, assignment and reviewer changes, Unicode and embed limits, retry behavior, secret-safe failures, and the CLI preview.

## Troubleshoot delivery

- **Missing secret:** Add `DISCORD_WEBHOOK_URL` to the monitored repository's Actions secrets, not an environment secret.
- **HTTP 401 or 404:** Replace a deleted or invalid Discord webhook URL.
- **HTTP 403:** Check that the webhook can still post in the destination channel.
- **No run appears:** Confirm the files are on the default branch, Actions is enabled, and the event is in the configured `types` list.
- **Rate limit or temporary failure:** The script retries up to four total attempts and honors Discord's `retry_after` up to 120 seconds. Check failed runs in Actions and rerun after correcting the cause.
- **Private fork PRs:** GitHub organization or repository policies can restrict workflows. Check Actions settings if those events do not run.

If the webhook URL leaks, delete or rotate it in Discord and update the GitHub secret.

## Maintain the workflow safely

The notification workflow uses `pull_request_target` to receive PR metadata in the trusted base repository context. It checks out only the repository's default branch, disables persisted Git credentials, and grants read-only contents permission. PR titles and descriptions are read from the event JSON file and never inserted into shell commands. Never change this job to check out or execute PR-head code while it has access to the Discord secret.

Third-party actions are pinned to commit SHAs. Review updates before changing those pins. The separate test workflow runs PR code without the Discord secret.

Official references: [Discord webhook setup](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks), [Discord webhook API](https://docs.discord.com/developers/resources/webhook), and [GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
