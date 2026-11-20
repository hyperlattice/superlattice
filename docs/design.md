# Superlattice application design

One process runs a Discord Gateway client, GitHub HTTP receiver, and sequential SQLite delivery worker. Docker Compose owns restart policy and the persistent volume. The existing organization webhook, raw-body signature validation, owner checks, delivery IDs, message formatting, and SQLite schema are retained.

## Boundaries

- `lib/config.mjs` validates configuration without displaying secrets.
- `lib/receiver.mjs` owns HTTP routes, the 2 MiB body limit, constant-time HMAC verification, organization checks, and enqueue-before-202 behavior.
- `lib/notifications.mjs` retains the formatter and supported actions. It has no Discord SDK dependency. `scripts/notify.mjs` re-exports it for existing preview users and offers a manual bot delivery diagnostic.
- `lib/deliveries.mjs` owns SQLite durability, deduplication, retry state, failed-delivery recovery, and 30-day sent-row pruning. It accepts an async send function and remains independent of Discord commands.
- `bot/delivery.mjs` fetches and validates the configured channel on startup and each send, converts stored `allowed_mentions` into SDK options, suppresses all mentions, and requires a message receipt.
- `bot/client.mjs` requests only the nonprivileged Guilds intent, bounds initial login, checks the application ID, and attaches safe error listeners. The SDK reconnects the Gateway automatically.
- `bot/commands/` provides a shared registry of definitions and handlers. `bot/interactions.mjs` dispatches server commands and handles failures without logging raw Discord errors.
- `bot/register.mjs` uses the application commands REST API to bulk replace one scope only when explicitly run. `--clear` removes definitions from the selected scope before switching guild/global registration.
- `lib/application.mjs` starts the receiver/worker after Discord and channel validation. `server.mjs` owns configuration, storage construction, and OS signal handling.

## Reliability

A single worker calls `deliverOne(send)` sequentially. Rows remain pending while Discord is working. Success requires a receipt from `channel.send()`. Network/server retries are bounded by the SDK. SDK rate-limit rejections are converted into persisted queue delays, using the larger of the exponential backoff and Discord's cooldown. Reconnecting clients pause the worker so Gateway outages do not exhaust queue attempts. Eight failed queue attempts require manual requeue.

Messages accepted by GitHub remain durable across process restarts. Ambiguous sends can duplicate: a crash after Discord accepts a message but before SQLite commits its success leaves a pending row. No exactly-once guarantee is made. Existing queue rows remain compatible because the schema and stored message format have not changed. Sent bodies are cleared, while failed/pending bodies remain available for recovery. Run one worker instance per volume.

SIGTERM/SIGINT stop intake, abort idle sleeps, let an active delivery settle, destroy the Discord client, and close SQLite. HTTP keep-alive connections close normally; incomplete inbound requests are forcibly closed after five seconds. Repeated shutdown calls share one promise. If an external operation never settles, a 150-second process deadline exits with pending work intact, before Compose's three-minute grace period. A signal during initial Discord connection aborts startup and cleans up resources.

`/healthz` indicates that HTTP intake is alive, not that every Discord send will succeed. `/status` shows Gateway state and receiver state. Compose does not automatically restart an unhealthy but running process; it restarts process failures and resumes after host reboot when Docker is enabled.

## Verification

Tests use real local HTTP requests and SQLite with mocked Discord SDK boundaries. Coverage includes formatting, signature tampering, organization filtering, duplicate IDs, disk persistence, receipts, failed sends, cooldown/backoff, retry exhaustion, command responses, registration routes, startup failures, draining in-flight delivery, and real subprocess SIGINT/SIGTERM handling. CI builds the image and runs the same mocked tests inside it. Physical ARM64 deployment and real Discord/GitHub integration still require a configured Pi and credentials.
