# Organization webhook receiver

One Hyperlattice organization webhook sends `issues` and `pull_request` events to the Raspberry Pi's `/github/webhook` endpoint. GitHub organization webhooks cover every repository owned by the organization, so the design needs no per-repository workflow or API polling.

## Shape

`createReceiver({ secret, organization, store })` owns the HTTP boundary. It limits body size, verifies the raw-body SHA-256 HMAC with constant-time comparison, checks the repository owner, and invokes the existing `buildMessage(eventName, payload)` formatter. That formatter owns supported actions, assignee and reviewer display, and Discord message limits.

`DeliveryStore` owns the SQLite queue and delivery-ID deduplication. `enqueue(id, message)` commits before the HTTP 202 response. A single worker calls `deliverOne(send)` sequentially, keeping network work out of the request handler. Failed attempts are retried with persisted backoff. Pending rows require no in-flight recovery after a process crash because they remain pending until Discord confirms success.

`sendMessage(webhookUrl, message)` owns Discord URL validation, receipt confirmation, timeouts, and bounded HTTP retries. `server.mjs` owns configuration, process lifecycle, and the worker loop. Docker Compose owns restart policy and the persistent volume. Tailscale Funnel or an existing HTTPS reverse proxy exposes the receiver to GitHub.

## Synthesis decision

The original design compared per-repository Actions with a hosted receiver. Requiring every Hyperlattice repository makes the receiver the better fit. The user chose instant organization-webhook delivery and a Raspberry Pi host. Adopt the receiver candidate's durable queue and signature validation while retaining the tested formatter and sender. Remove the per-repository notification workflow to give alert delivery one owner.

Accept maintaining a home server and public HTTPS endpoint in exchange for immediate events and automatic coverage of new repositories. Accept possible duplicates after an ambiguous Discord send. Deduplication lasts 30 days after successful sending. Clear sent message bodies, retain failed work for operator recovery, and keep all storage in the mounted volume.

## Verification

Behavior tests send real signed HTTP requests to the receiver, reopen the same SQLite database, and deliver the queued message through the sender to a local HTTP Discord stand-in. They verify multiple repository names, rejected signatures, foreign organizations, body limits, duplicate suppression, queue retries, and terminal-failure recovery. CI builds and smoke-tests the Docker image on Linux. Deployment on the physical Pi and live GitHub-to-Discord verification require the user's Pi and secrets.
