# Sync & Conflicts

Pull refreshes local state from Google Drive or Google Docs. Push sends queued editor changes as Docs batchUpdate operations. Drain replays pending mutations that were deferred after an offline or failed sync path.

Conflicts appear when local edits and remote revisions cannot be merged silently. Open the Conflicts pane to inspect pending mutations, revision mismatches, and pre-push snapshots.

Use Diagnostics when sync is stuck. It exposes recent pull, push, drain, and cache state so you can tell whether the issue is auth, network reachability, missing Drive data, or a queued mutation.

The macOS shell exposes sync actions through the editor toolbar, command palette, History, Diagnostics, and Conflicts panes.
