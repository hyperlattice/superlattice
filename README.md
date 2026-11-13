# Hyperlattice GitHub alerts for Discord

One organization webhook sends issue and PR activity from **all current and future Hyperlattice repositories** to one Discord channel. Run this receiver on your Raspberry Pi. Nothing needs to be copied into the monitored repositories.

Alerts include the title, link, description, author, assignees, and requested PR reviewers, including teams. Assignment and reviewer changes send new messages. GitHub usernames appear as text without Discord pings. Long descriptions show an excerpt with a link to GitHub.

Follow [the Raspberry Pi setup guide](docs/raspberry-pi.md) to deploy it.

You need:

- A Raspberry Pi running a 64-bit OS, Docker Engine, and Docker Compose.
- A public HTTPS URL that forwards to the Pi, using Tailscale Funnel or your own HTTPS reverse proxy.
- One Discord incoming webhook URL for your destination text channel.
- One random webhook secret, shared between the Pi and GitHub.
- Organization-owner access to create the Hyperlattice organization webhook.

No Discord bot token, GitHub personal access token, or per-repository Actions secret is needed by the service.

## Events

| Item | Alerts |
| --- | --- |
| Issues | Opened, edited, reopened, closed, assigned, unassigned |
| Pull requests | Opened, edited, reopened, closed or merged, assigned, unassigned, review requested, review request removed, ready for review, converted to draft |

In GitHub's organization webhook settings, select **Issues** and **Pull requests**. The receiver filters these event families to the actions above. Completed reviews and comments do not send alerts.

## Delivery behavior

The receiver verifies GitHub's SHA-256 signature against the raw body and rejects repositories outside `GITHUB_ORGANIZATION`. It writes accepted alerts to a SQLite queue before returning HTTP 202. One worker sends the messages and retries delivery failures. Pending alerts survive container and Pi restarts when the data volume is preserved.

GitHub delivery IDs prevent repeated alerts from duplicate deliveries for 30 days after sending. A crash after Discord accepts a message but before the queue records success can still cause a duplicate. This service does not promise exactly-once delivery.

The worker makes up to eight queue attempts. Each attempt uses the sender's bounded HTTP retries. After exhaustion it logs `manual retry required`. Fix the cause, then requeue failed alerts using the command in the setup guide. Sent message bodies are cleared from SQLite. Pending and failed alerts retain their contents on disk.

The Pi must be online to receive events. GitHub does not automatically redeliver failed webhook requests. After an outage, use the organization webhook's **Recent Deliveries** page to redeliver failures. This service receives new events and does not import historical issues or PRs.

## Development

Install Node.js 24 or later. There are no npm dependencies to install.

```sh
npm test
```

Preview a PR alert without posting to Discord:

```sh
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=test/fixtures/pr.json npm run preview
```

Tests cover a signed HTTP request through persistent storage to an HTTP Discord stand-in, cross-repository coverage, signature rejection, duplicate delivery, queue recovery, message limits, and the CLI preview. CI also builds and starts the Docker image.

## Migrating from the original Actions version

The per-repository `Discord alerts` workflow has been removed from this repo. The new receiver replaces it. If you copied the old workflow into other repositories, remove it to avoid duplicate alerts. The old `DISCORD_WEBHOOK_URL` GitHub Actions secret can be removed after you configure the Pi. Store that URL in the Pi's `.env` instead.

Official references: [GitHub organization webhooks](https://docs.github.com/en/webhooks/types-of-webhooks#organization-webhooks), [signature verification](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries), [webhook redelivery](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries), and [Discord webhook setup](https://support.discord.com/hc/en-us/articles/228383668-Intro-to-Webhooks).
