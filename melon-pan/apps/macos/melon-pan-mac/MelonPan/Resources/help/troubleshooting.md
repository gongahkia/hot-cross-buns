# Troubleshooting

If sign-in fails, confirm the app has Google credentials configured for this build and that the browser OAuth callback can reach localhost.

If sync is stuck, open Diagnostics and check account state, network reachability, pending mutations, and recent push or pull errors. Use Drain when queued mutations need to be replayed.

If Drive is stale, refresh the Drive tree and verify that your target folder is inside the configured root scope.

If the local cache is corrupted during development, use the cache path shown in Diagnostics before deleting anything. Export logs or a diagnostics report before wiping state when you need a reproducible bug report.
