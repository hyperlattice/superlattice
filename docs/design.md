# Notification design

The caller creates a Discord incoming webhook and stores `DISCORD_WEBHOOK_URL` in the monitored repository. GitHub Actions runs `node scripts/notify.mjs` for issue and PR activity. The CLI reads `GITHUB_EVENT_PATH`, formats the event with `buildMessage(eventName, payload)`, then calls `sendMessage(webhookUrl, message)`.

The pure formatter owns supported actions and Discord size limits. The sender owns URL validation, HTTP delivery confirmation, timeouts, and bounded retries. The CLI owns environment and file input. There is no database or shared state.

## Synthesis decision

Two independent design candidates compared a hosted webhook receiver with GitHub Actions. Both recommended Actions for this scope. Against coverage, secret safety, setup burden, testability, and maintainability, Actions meets the required events with fewer operational requirements. The receiver offers centralized installation and durable queueing but requires hosting, signature validation, and persistent storage. No independent cross-judge ran because no alternate session configuration was available.

Use the Actions candidate as the base. Adopt the receiver candidate's explicit delivery confirmation and bounded retry policy. Reject server deployment and a Discord gateway process because this task only needs outbound channel messages.

Accept per-repository installation, Actions queue latency, and possible duplicates in exchange for no hosting. Preserve descriptions as bounded excerpts with the GitHub URL. Keep GitHub identities as text because Discord mentions require a separate identity map and explicit opt-in.

Verification uses the actual formatter and sender, with HTTP responses injected in tests, plus a CLI fixture preview and GitHub CI. Live Discord delivery requires the user's channel webhook secret and a manual setup run.
