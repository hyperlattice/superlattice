# Superlattice

Superlattice is a Discord bot and GitHub organization webhook receiver, designed to run continuously on a Raspberry Pi 5. It posts issue and PR notifications from all current and future **Hyperlattice** repositories and responds to `/ping`, `/status`, `/github`, and `/help` with embeds.

Follow the [Raspberry Pi deployment guide](docs/raspberry-pi.md) for Discord application creation, invitations, Docker installation, Tailscale Funnel, GitHub webhooks, and troubleshooting.

## Quick start

Use Node.js 24 and a Discord application invited to your server with the `bot` and `applications.commands` scopes. Give it **View Channel**, **Send Messages**, and **Embed Links** in the notification channel. No privileged Gateway intents are needed. Create an application and copy its bot token in the [Discord Developer Portal](https://discord.com/developers/applications); see [Discord's application setup guide](https://docs.discord.com/developers/quick-start/getting-started).

```sh
npm ci
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
# Edit .env: fill in the bot token, application ID, channel ID,
# optional server ID, and the generated GitHub webhook secret.
npm run deploy-commands
npm start
```

For the Pi, after configuring `.env`:

```sh
docker compose build
docker compose run --rm --no-deps discordbot npm run deploy-commands
docker compose up -d --build
docker compose logs -f
docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Developer Portal → Bot |
| `DISCORD_CLIENT_ID` | Yes | Application ID from General Information |
| `DISCORD_GUILD_ID` | No | Server ID; selects guild registration and restricts commands/notification channel to that server. Blank selects global server-only commands |
| `DISCORD_CHANNEL_ID` | Yes | Notification destination, normally a server text channel |
| `GITHUB_ORGANIZATION` | No | Organization login, default `hyperlattice` |
| `GITHUB_WEBHOOK_SECRET` | Yes | Shared GitHub HMAC secret, at least 32 characters |
| `PORT` | No | HTTP listener port, default `3000` |
| `DATA_DIR` | No | SQLite directory, default `./data` |

Compose sets `PORT=3000` and `DATA_DIR=/app/data`, mounts the existing named `deliveries` volume, and publishes only `127.0.0.1:3000`. Keep `.env` private and excluded from Git. The application validates configuration before opening its database. Registration only needs the token, application ID, and optional guild ID. No GitHub API token is required.

## Slash commands

| Command | Response |
| --- | --- |
| `/ping` | Pong, acknowledgement round-trip latency, WebSocket latency |
| `/status` | Connection status, process uptime, RSS memory, Discord latency, receiver status, monitored organization |
| `/github` | Linked organization and monitored events |
| `/help` | Available commands and descriptions |

Commands use the Gateway with only the `Guilds` intent. Leave the application's **Interactions Endpoint URL** empty so Discord sends interactions through the Gateway. Everyone allowed to use application commands in the server can use these read-only commands; server administrators can restrict them in Discord's integration settings.

`npm run deploy-commands` bulk overwrites this application's command definitions in the configured scope. It updates commands by name, removes stale definitions, and does not create duplicate definitions in that scope. It runs separately from bot startup; rerun it after adding or changing commands. Guild commands are suited to development; global commands can take time to propagate. Global and guild commands are separate scopes in the [Discord application commands API](https://docs.discord.com/developers/interactions/application-commands).

When switching scopes, first clear the old scope using its current `.env` values:

```sh
npm run deploy-commands -- --clear
# Change DISCORD_GUILD_ID in .env (blank for global, server ID for guild).
npm run deploy-commands
```

This application owns all commands in the selected application/scope; bulk registration replaces them. Add command modules under `bot/commands/` and include them in `bot/commands/index.mjs`; registration and `/help` use that shared registry.

## GitHub events and delivery

| Item | Alerts |
| --- | --- |
| Issues | Opened, edited, reopened, closed, assigned, unassigned |
| Pull requests | Opened, edited, reopened, closed or merged, assigned, unassigned, review requested, review request removed, ready for review, converted to draft |

Alerts preserve descriptions, authors, assignees, and PR reviewers including teams. Long descriptions include a link to the full text. GitHub mentions never ping Discord users or roles. Comments, completed reviews, pushes, and PR synchronization events are skipped.

The receiver validates SHA-256 HMAC against the raw request body, checks the repository owner, and commits alerts to SQLite before responding HTTP 202. One worker sends messages using `client.channels.fetch()` and `channel.send()`, validates channel permissions, and marks a delivery sent only after Discord returns a message receipt. The stored API-format messages from the previous receiver remain compatible; no schema or data migration is needed.

Failures retry up to eight queue attempts with persisted exponential backoff (30 seconds up to one hour). discord.js manages request buckets and bounded network/server retries; rate-limit rejections return to the durable queue with a delay at least as long as Discord's cooldown. Gateway reconnects pause delivery attempts. Failed rows remain available for manual requeue:

```sh
docker compose exec discordbot node server.mjs --retry-failed
```

Pending alerts survive restarts. Sent bodies are cleared; delivery IDs deduplicate for 30 days after sending. A crash after Discord accepts a message and before SQLite records success can produce a duplicate. Run one application instance per volume. Keep the volume during updates.

The Pi must be reachable to receive events. [GitHub does not automatically redeliver failed webhook requests](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries); use Recent Deliveries after an outage. This bot does not import historical issues or PRs.

## Testing

```sh
npm ci
npm test
GITHUB_EVENT_NAME=pull_request GITHUB_EVENT_PATH=test/fixtures/pr.json npm run preview
```

Tests use mocked Discord and real local HTTP/SQLite boundaries, without tokens or network access. They cover signature checks, organization filtering, formatting, duplicate suppression, queue persistence, retry exhaustion, rate limits, command responses and registration, invalid configuration, startup cleanup, and graceful shutdown under SIGINT/SIGTERM. CI also builds the Docker image and runs the mocked suite inside it.

For a live check, invoke all four slash commands in your server, create a GitHub issue with a description/assignee, and request a PR review. Confirm the messages and check Recent Deliveries for HTTP 202. Redelivering the same GitHub delivery should return `Already received` without a second alert. A signed GitHub webhook `ping` returns `pong`; that handshake does not post a Discord message.

The preview command only prints JSON. To send the fixture through the bot manually, use `node --env-file=.env scripts/notify.mjs` with `GITHUB_EVENT_NAME` and `GITHUB_EVENT_PATH` set. This bypasses the webhook queue and is for manual diagnostics.

## Architecture and migration

`lib/receiver.mjs` owns HTTP authentication and filtering; `lib/notifications.mjs` retains the existing formatter; `lib/deliveries.mjs` owns persistent delivery and deduplication. `bot/` owns Discord connection, sending, commands, and registration. `lib/application.mjs` coordinates the worker and lifecycle; `server.mjs` validates configuration and handles process signals. See [design notes](docs/design.md).

To upgrade an existing installation, keep its Compose project/directory and `deliveries` volume. Add the four `DISCORD_*` bot settings, remove `DISCORD_WEBHOOK_URL`, invite the bot, register commands, and rebuild. Existing queued alerts remain deliverable. Remove any old per-repository notification workflows to avoid duplicate alerts. The previous Discord incoming webhook can be deleted once bot delivery is verified.
