# Run Superlattice on a Raspberry Pi 5

Use Raspberry Pi OS 64-bit (Debian-based) or Debian ARM64. `uname -m` should report `aarch64`. The official Node.js 24 image supports ARM64 natively; Compose selects the host architecture. No x86 emulation or additional public bot port is needed.

## Install prerequisites

If Docker Engine and its Compose plugin are already installed, skip installation and enable the services below. For a fresh supported Debian-based Pi OS installation, follow [Docker's Debian installation guide](https://docs.docker.com/engine/install/debian/). These commands configure Docker's official apt repository:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF_DOCKER
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF_DOCKER
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker compose version
```

Use `sudo docker` if your account does not have Docker access. Commands below use `sudo` consistently. The Pi must remain powered and have internet access for continuous operation.

## Create and invite the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications), create an application called **Superlattice**, and copy its **Application ID** from General Information. This is `DISCORD_CLIENT_ID`.
2. Open **Bot**; create the bot if prompted. Use **Reset Token** to obtain its token and store it as `DISCORD_BOT_TOKEN`. Never use a user token or an incoming webhook URL. Leave Presence, Server Members, and Message Content privileged intents disabled. Leave **Interactions Endpoint URL** empty; this application receives interactions over the Gateway.
3. In **OAuth2 → URL Generator** (or guild installation settings), select `bot` and `applications.commands`. Select only **View Channels**, **Send Messages**, and **Embed Links**. Open the generated URL, select the server, and authorize with an account that can manage that server. Do not grant Administrator. The equivalent invitation URL is:

   ```text
   https://discord.com/oauth2/authorize?client_id=YOUR_APPLICATION_ID&scope=bot%20applications.commands&permissions=19456
   ```

4. In Discord user settings, enable **Advanced → Developer Mode**. Right-click your server and choose **Copy Server ID** for `DISCORD_GUILD_ID`. Right-click the destination text channel and choose **Copy Channel ID** for `DISCORD_CHANNEL_ID`.
5. Check channel permission overrides: the bot must be able to view the channel, send messages, and embed links. Use a normal server text channel for the simplest setup. Server members need permission to use application commands. Choose a channel whose members may read all monitored private repositories.

See [Discord's app setup documentation](https://docs.discord.com/developers/quick-start/getting-started) for the portal flow.

## Configure and start the application

Clone with your existing GitHub credentials, then create the private configuration:

```sh
git clone https://github.com/hyperlattice/discordbot.git
cd discordbot
cp .env.example .env
chmod 600 .env
openssl rand -hex 32
nano .env
```

Fill in:

```dotenv
DISCORD_BOT_TOKEN=YOUR_BOT_TOKEN
DISCORD_CLIENT_ID=YOUR_APPLICATION_ID
DISCORD_GUILD_ID=YOUR_SERVER_ID
DISCORD_CHANNEL_ID=YOUR_TEXT_CHANNEL_ID
GITHUB_ORGANIZATION=hyperlattice
GITHUB_WEBHOOK_SECRET=YOUR_GENERATED_SECRET
```

Keep the remaining defaults from `.env.example`. `DISCORD_GUILD_ID` is optional: use it for immediate server-scoped registration, or leave it blank for global server commands. The configured guild also restricts command usage and the notification channel to that server. Compose sets the internal port and data directory explicitly.

Build, register commands once, and start the managed service:

```sh
sudo docker compose build
sudo docker compose run --rm --no-deps discordbot npm run deploy-commands
sudo docker compose up -d --build
sudo docker compose logs -f
```

Press Ctrl-C to leave logs; the container stays running. Inspect separately:

```sh
sudo docker compose ps
curl --fail http://127.0.0.1:3000/healthz
```

The bot should appear online and the health endpoint should return `ok` after Discord login and channel validation. Command registration uses Discord REST, does not start a second Gateway client, and does not run automatically on reconnect. Rerun it after command definitions change.

`restart: unless-stopped` restarts crashes and resumes the service after Pi reboots when Docker is enabled. An explicitly stopped container remains stopped until started again. The existing `deliveries` named volume stores SQLite. Run one application instance per queue. Keep the same checkout directory/Compose project name when migrating so Compose uses the existing volume.

## Give GitHub a public HTTPS endpoint

GitHub cannot call a private LAN address or a Tailscale-only address. Use a public HTTPS reverse proxy or Tailscale Funnel. The Compose port is bound to the Pi's localhost interface so it is available to a local tunnel without opening the port on your LAN.

For Tailscale Funnel:

1. Install Tailscale on the Pi and sign in, following [Tailscale's Linux instructions](https://tailscale.com/download/linux).
2. Run:

   ```sh
   sudo tailscale funnel --bg 3000
   sudo tailscale funnel status
   ```

3. Follow any prompts to enable HTTPS and Funnel for your tailnet. Copy the public HTTPS URL shown by Tailscale, such as `https://your-pi.your-tailnet.ts.net`.
4. From a different device, confirm that `https://your-pi.your-tailnet.ts.net/healthz` returns `ok`.

The `--bg` option keeps Funnel configured in the background and resumes after a restart. Keep the Pi's Tailscale service running. Funnel makes the endpoint public; GitHub signatures protect webhook submissions. See [Funnel requirements](https://tailscale.com/docs/features/tailscale-funnel) and [the Funnel command reference](https://tailscale.com/docs/reference/tailscale-cli/funnel).

If you already have a domain and HTTPS reverse proxy, forward `/github/webhook` to `http://127.0.0.1:3000/github/webhook` and preserve the raw body and GitHub headers. Do not put a login page in front of that path.

## Create one organization webhook

Open [Hyperlattice organization webhook settings](https://github.com/organizations/hyperlattice/settings/hooks), then select **Add webhook**. You must be an organization owner.

| Setting | Value |
| --- | --- |
| Payload URL | `https://YOUR-PUBLIC-HOST/github/webhook` |
| Content type | `application/json` |
| Secret | The exact `GITHUB_WEBHOOK_SECRET` from the Pi's `.env` |
| SSL verification | Enable |
| Events | Select individual events: **Issues** and **Pull requests** |
| Active | Checked |

Create the webhook in the organization settings, not an individual repository. It covers all repositories owned by Hyperlattice, including private repositories and repositories created later. The receiver uses repository-owner checks, so transferred-out repositories are rejected.

GitHub calls the Pi at `/github/webhook`; the Pi formats queued notifications and sends them through the Discord bot account.

## Verify delivery

First run `/ping`, `/status`, `/github`, and `/help` in the configured server. Confirm the bot appears online and `/status` shows the receiver as Listening.

1. In GitHub's webhook page, open **Recent Deliveries**. The automatic `ping` should return HTTP 200 with `pong`.
2. Open an issue in any Hyperlattice repository with a description and assignee. Confirm that Discord receives its title, description, and assignee.
3. Request a user or team review on a PR. Confirm that Discord shows its requested reviewers.
4. Check the Pi's logs if a delivery is missing:

   ```sh
   sudo docker compose logs --tail=100 -f discordbot
   ```

Issue and PR deliveries return HTTP 202 after durable queue insertion. Unsupported actions return HTTP 204. Duplicate delivery IDs return HTTP 202 with `Already received`.

## Recover after failures

- **Bot offline or container restarting:** Inspect `docker compose logs --tail=100`. Verify `DISCORD_BOT_TOKEN` is the bot token, `DISCORD_CLIENT_ID` is its application ID, and outbound HTTPS/WebSocket connections to Discord are available. No privileged intents should be enabled or requested. Recreate the container after changing `.env`.
- **Channel startup failure:** Copy a server text channel ID, invite the bot to that server, and allow View Channel, Send Messages, and Embed Links in its channel overrides. Forum/category channels cannot directly receive these messages. Threads additionally require Send Messages in Threads, accessible membership, and an available thread.
- **Slash commands missing:** Run the registration command again. Check that the application is invited with `applications.commands`, the guild ID is the server where you are testing, and users may Use Application Commands. Leave Interactions Endpoint URL blank. Global commands can take time to propagate.
- **Duplicate slash commands after a scope change:** Clear the old scope using `npm run deploy-commands -- --clear` with its original guild setting, then register in the new scope. See the README.
- **Funnel unreachable:** Inspect `sudo tailscale funnel status`, `sudo systemctl status tailscaled`, and the local `/healthz` endpoint. Enable Funnel/HTTPS according to tailnet policy.

- **HTTP 401 from the Pi:** The GitHub webhook secret and Pi secret differ, or the forwarded body was modified.
- **HTTP 403 from the Pi:** Check `GITHUB_ORGANIZATION` and the event repository's owner.
- **No GitHub delivery:** Check that the webhook is active and is installed in the organization settings.
- **Queued but absent from Discord:** Check the bot token, channel ID, bot membership, and channel permissions. Run `/status` to inspect the connection. The service retries delivery failures with backoff.
- **Pi or internet outage:** Restore service, then redeliver failed requests from GitHub's **Recent Deliveries** page. GitHub does not retry them automatically.
- **`manual retry required` in logs:** Correct the Discord or network configuration and run:

   ```sh
   sudo docker compose exec discordbot node server.mjs --retry-failed
   ```

   The running worker picks up requeued alerts. A GitHub redelivery of an already-queued failed alert is deduplicated; use this command to retry that queue entry.

The receiver accepts bodies up to 2 MiB. If a larger delivery fails with HTTP 413, inspect its size before adjusting that limit in `lib/receiver.mjs`.

## Update and preserve data

```sh
git pull --ff-only
sudo docker compose up -d --build
```

Keep the `deliveries` volume during updates. Do not run `docker compose down -v` unless you intend to delete queued alerts and duplicate-delivery history. Back up the Pi and this volume. Keep `.env` out of Git. If a credential leaks, rotate it at its source and update the Pi configuration.

To change `.env` values, run `sudo docker compose up -d --force-recreate` afterward. A container restart alone does not load changed environment values.
