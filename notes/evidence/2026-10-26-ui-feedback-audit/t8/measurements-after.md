# T8 batched endpoint probe

The prototype batch endpoints were called directly from the authenticated Playwright page with five groups, after capturing the corresponding five single-group requests and arguments. All five group row payloads matched their single endpoint responses in each run. The temporary API shape was `browse.movement_history_many({ query, groups })` and `browse.operation_contributions_many({ query, records, groups })`. Each group carried an `id`, scope key, and independent sort/paging values; results were keyed by `id` with either `page` or a group-specific `error`. The prototype files and tests were removed after the measurements.

| View | Before Back restore | Batch HTTP probe run 1 | Batch HTTP probe run 2 | Mean | Change vs restore |
|---|---:|---:|---:|---:|---:|
| Movements items | 6.62 s, 5 calls | 4.97 s, 1 call | 4.82 s, 1 call | 4.89 s | 26.1% faster |
| Loans items | 1.13 s, 5 calls | 1.05 s, 1 call | 0.47 s, 1 call | 0.76 s | 32.7% faster |

These probe timings cover the batch HTTP request only, not the complete Back interaction. The Movements gain is below the requested ~30% keep threshold, and the Loans samples vary substantially. Given the task's keep-only-if-clear condition, the prototype was reverted. The before/after API probes are recorded for the decision; no integrated UI after-measurement was possible without editing the Claude-owned restore file.

Raw runs: `benchmark-batch-run1.json`, `benchmark-batch-run2.json`. `benchmark-batch.mjs` is the temporary-prototype measurement script and needs those endpoints restored to replay.
