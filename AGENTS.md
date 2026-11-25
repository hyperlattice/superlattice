# Writing for Hyperlattice teammates

Follow these instructions when drafting issues, pull requests, review comments, and handoffs.

- Lead with the outcome or request. State what changed, why it matters, or what decision you need from the reader.
- Use concrete names for the affected behavior, files, commands, or workloads. Keep technical terms that add precision and briefly explain project-specific terms a new teammate may not know.
- Keep the summary short. Put supporting details in bullets, and link directly to relevant code, issues, or results.
- For a bug, give the expected behavior, actual behavior, and shortest way to reproduce it. For a proposal, state the problem, the first step, and what would count as done.
- For a PR or handoff, report the checks you ran and their outcomes. Call out material checks you skipped, open questions, and any action the reader needs to take. Label hypotheses and unverified claims clearly.
- For performance changes, report the baseline and new result with units, workload, and hardware. State how you checked correctness and link raw results when available.
- Use the repository's issue or PR template when available. The [Hyperlattice defaults and writing guide](https://github.com/hyperlattice/.github) are the fallback.

Example PR summary (illustrative):

> Batch pending webhook deliveries to reduce database writes during bursts.
>
> Verified with `npm test`. The tests cover normal delivery and retries. Burst throughput still needs measurement.
