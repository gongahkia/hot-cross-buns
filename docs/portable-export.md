# Hot Cross Buns Portable Export

Portable exports use a directory package with the `.hcbexport` extension. The
format is intended for lossless migration between Macs while Hot Cross Buns is
still Google-backed. It is not a local-first source-of-truth backend.

## Layout

```text
HotCrossBuns-Portable-YYYYMMDD-HHMMSS.hcbexport/
  manifest.json
  hot-cross-buns-state.json
  Attachments/
    copied-local-file-or-image
```

`hot-cross-buns-state.json` contains the cached app state:

- Google account metadata cached by the app
- task lists and tasks
- calendars and events
- app settings
- sync checkpoints
- queued pending mutations

Local image/file pointers remain in task notes and event details as markdown
links. During import, pointers whose files were bundled are rewritten to point
at copies in the importing Mac's Application Support attachments folder.

## Manifest

`manifest.json` is JSON with these fields:

- `formatVersion`: current archive schema version. Unknown versions are refused.
- `exportedAt`: export timestamp.
- `appVersion`: app version that wrote the archive when available.
- `stateFile`: state payload file name, currently `hot-cross-buns-state.json`.
- `attachmentDirectory`: attachment folder name, currently `Attachments`.
- `attachments`: reachable local pointers that were bundled.
- `skippedPointers`: original file URLs that were missing, unreadable, or
  corrupted at export time.
- `notes`: human-readable format notes.

Each attachment entry contains:

- `kind`: `image` or `file`.
- `displayName`: label preserved from the markdown pointer.
- `originalURL`: original file URL from the exporting Mac.
- `bundledRelativePath`: relative path to the copied file inside the archive.
- `sha256`: optional SHA-256 checksum of the bundled file.
- `byteCount`: optional bundled file size in bytes.

The checksum fields are optional so older archives remain importable. When
present, import preview and import both verify them. A bundled file that fails
integrity checks is treated as corrupt and is not copied or relinked.

## Import Semantics

Portable import is destructive for cached Hot Cross Buns data on the importing
Mac. Users must confirm replacement before local cached tasks, events,
calendars, task lists, settings, sync checkpoints, and queued mutations are
replaced by the archive state.

Before confirmation, the app performs a dry-run comparison against the current
cache:

- added, removed, and changed tasks
- added, removed, and changed events
- added, removed, and changed calendars
- added, removed, and changed task lists
- whether settings will change
- queued mutation count from the archive
- bundled, missing, corrupt, and skipped attachment counts

The details view is read-only. Opening it does not mutate local data.

## Attachment Relinking

Import copies reachable bundled attachments into the importing Mac's app-owned
attachments folder under Application Support, then rewrites matching local
pointer URLs in task notes and event details.

Import does not rewrite pointers when:

- the original pointer was listed in `skippedPointers`
- the bundled attachment is missing from the archive
- the bundled attachment fails checksum or byte-count validation
- the archive uses an unsafe relative path

Those pointers remain in the imported text and can be repaired manually from
Settings -> Data control -> Review local pointers.

## Compatibility And Non-goals

The `.hcbexport` format is a migration package, not a live sync database. It
does not provide:

- peer-to-peer sync
- CRDT or conflict merging
- append-only logs
- encrypted local-first payloads
- CLI parity
- Syncthing/iCloud/rsync transport adapters

Those were outside the archived implementation.
