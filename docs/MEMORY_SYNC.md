# Memory sync

HCB keeps its existing memory and note stores. Syncthing transports a separate
portable representation; HCB imports changes through the owning stores and
invalidates local retrieval indexes. Different model runtimes can use the same
saved knowledge, but identical responses across models are not promised.

In Settings → Memory & privacy, expand **Device sync**. Connect an existing,
unpaused, send-and-receive Syncthing folder using its folder ID, local API address
and API key. Pair devices in Syncthing first. HCB writes only the
`hcb-memory-profile` subfolder. Syncthing API credentials stay in HCB's private
auth store, scoped to the endpoint and folder; they never enter the sync folder.
Each device needs its own connection setup. Sync is off until explicitly enabled.

The existing local supervisor checks for updates on startup and every 15 seconds.
It uses a separate bounded worker, so network sync does not block scheduled-job
dispatch. Syncthing and HCB's supervisor must be running for automatic transfer
and import. **Sync now**, or asking HCB to sync its memory, runs the same pipeline.
Pausing disables automatic exchange and manual sync. Resuming through the agent
requires review; it cannot configure folders, supply credentials or pair devices.

## Scope and conflict behavior

- Memories retain their IDs, scope, evidence, timestamps, expiry and recall policy.
- Saved reference notes retain their IDs, text, source labels and dependencies.
- Forgetting markers, concept aliases and historical exclusions travel with them.
  Forgetting wins over a concurrent edit; a new device does not silently revive
  the forgotten concept. Explicit subsequent restoration retains causal order.
- Concurrent edits to the same record are preserved for an exact version choice
  in Device sync. A stale choice is rejected. No last-write-wins fact merging is
  performed. Existing semantic-conflict controls still apply to separate records.
- Local source-file references keep their original paths and fingerprints. They
  do not grant filesystem access on another device, and missing sources remain
  subject to existing recall checks. Goal-scoped records retain their goal IDs;
  syncing a record does not create or activate the goal or its scheduled work.
- Credentials, permission grants, model installations, configuration, active task
  owners, databases, caches and scheduled execution ownership are excluded.
  Skills, routine activation and pending proposals are not imported as authority.

The source Markdown category files remain the supported editable views in HCB.
Read-only copies under `current/<device-id>/` provide readable context for local
models and inspection. Editing a copy there does not mutate the owning store;
edit through HCB or its original local category file. Files under `changes/` are
immutable Markdown revisions with bounded structured headers. Do not edit or
rename them. Tampering, links, foreign paths and unsupported schemas fail closed.

Older revisions can retain prior text, as can existing chat history and backups.
Forgetting controls future recall; it is not a secure-erasure promise. Only pair
this folder with devices permitted to hold that personal reference data.

## Delivery status

A local write, Syncthing transfer and HCB import are separate stages. Offline or
unpaired devices remain pending. Syncthing's connected-device completion response
reports transport progress. HCB additionally writes a revision-bound import
receipt; matching receipts confirm another HCB profile imported that revision.
A file-transfer status alone does not imply that another HCB is running.

The format currently bounds history to 16,384 revisions and 64 MiB of packet
content, with 256 KiB per packet and 32 concurrent heads per record. Reaching a
limit stops sync with an error and retains the local stores. Automatic history
compaction is not implemented; do not delete ancestor revisions manually.

## Verification

```sh
go test ./internal/memorysync ./internal/memory ./internal/knowledge ./internal/config
go test ./cmd/hot-cross-buns -run TestMemorySync
node --test web/tests/caret.test.mjs
python3 scripts/memory-sync-e2e.py --syncthing /absolute/path/to/syncthing
```

The end-to-end script generates two temporary Syncthing configurations and two
HCB profiles, disables external discovery, relays, upgrades and telemetry, and
uses loopback listeners. It verifies automatic preference import, import receipts,
offline delivery status and catch-up after reconnection. All subprocesses are
stopped on exit. Fixture profiles and logs remain under the ignored local-dev
folder (or `--output`) for diagnosis. It never opens the user's HCB or Syncthing
profile and does not need cloud model credentials.
