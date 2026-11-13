# Run Hyperlattice alerts on a Raspberry Pi

Use a 64-bit Raspberry Pi OS or Debian installation. These steps assume Docker Engine, the Compose plugin, Git, curl, and OpenSSL are installed. Follow [Docker's Debian installation guide](https://docs.docker.com/engine/install/debian/) for Docker Engine and Compose.

## Configure the service

1. Clone this private repository using your existing GitHub SSH or HTTPS credentials:

   ```sh
   git clone https://github.com/hyperlattice/discordbot.git
   cd discordbot
   cp .env.example .env
   chmod 600 .env
   ```

2. In Discord, open **Server Settings → Integrations → Webhooks**. Create a webhook and select your destination text channel. Copy its URL.

3. Generate a shared secret:

   ```sh
   openssl rand -hex 32
   ```

4. Edit `.env` on the Pi:

   ```dotenv
   GITHUB_ORGANIZATION=hyperlattice
   GITHUB_WEBHOOK_SECRET=the-random-secret-you-generated
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/ID/TOKEN
   ```

   Replace both placeholders. Keep these values private. Use the normal Discord webhook URL without `/github`. Ensure the Discord channel's members may read content from all monitored private repositories.

5. Build and start the receiver:

   ```sh
   sudo docker compose up -d --build
   curl --fail http://127.0.0.1:3000/healthz
   sudo docker compose ps
   ```

   The health request returns `ok`. The container restarts after reboot when Docker is enabled. SQLite is stored in the named `deliveries` volume. Run only one receiver instance against that queue.

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

Do not use the Discord webhook URL as GitHub's payload URL. GitHub calls your Pi, and the Pi formats and posts to Discord.

## Verify delivery

1. In GitHub's webhook page, open **Recent Deliveries**. The automatic `ping` should return HTTP 200 with `pong`.
2. Open an issue in any Hyperlattice repository with a description and assignee. Confirm that Discord receives its title, description, and assignee.
3. Request a user or team review on a PR. Confirm that Discord shows its requested reviewers.
4. Check the Pi's logs if a delivery is missing:

   ```sh
   sudo docker compose logs --tail=100 -f discordbot
   ```

Issue and PR deliveries return HTTP 202 after durable queue insertion. Unsupported actions return HTTP 204. Duplicate delivery IDs return HTTP 202 with `Already received`.

## Recover after failures

- **HTTP 401 from the Pi:** The GitHub webhook secret and Pi secret differ, or the forwarded body was modified.
- **HTTP 403 from the Pi:** Check `GITHUB_ORGANIZATION` and the event repository's owner.
- **No GitHub delivery:** Check that the webhook is active and is installed in the organization settings.
- **Queued but absent from Discord:** Check the Discord URL and channel permissions. The service retries delivery failures with backoff.
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
