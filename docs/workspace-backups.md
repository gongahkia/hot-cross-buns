# Workspace backup and recovery

Settings → Data → **Export workspace** downloads a consistent SQLite snapshot after all earlier worker requests finish. It includes tasks, subtasks, lists, notes, calendars, recurrence, scheduled blocks, settings, relationships, FTS, undo history, pending Google changes and sync checkpoints. It contains personal planner content; keep it somewhere you control. Browser access tokens are never included because they exist only in memory.

**Import workspace…** selects a backup (up to 128 MiB), validates its SQLite format, application schema, integrity and relationships on a separate worker connection, and displays counts and warnings. Type `REPLACE` to confirm complete replacement. This is not a merge. Export the existing workspace first if you want to keep it. A review expires after ten minutes or any intervening workspace change, including another tab's changes. A failed validation or IndexedDB commit preserves the existing durable workspace. Success reloads the interface from the replaced data.

Imported Google accounts require reconnection. Pending Google changes become conflicts requiring individual review in Diagnostics; importing does not send them to Google. Local resources remain available even for desktop backups whose local fallback was retired. Undo/history and Google operation receipts are retained.

## Desktop backups and WAL

Use an application-created backup or SQLite's online backup API, not a copy of a running database file. SQLite can keep committed changes in the companion `-wal` file; a copied main file may be incomplete even when it has a valid header. The browser rejects WAL-mode files and does not patch their header bytes or claim to recover omitted WAL content.

If an application backup retains WAL mode, use SQLite tooling to produce a self-contained backup. For example, with the SQLite CLI installed:

```sh
sqlite3 /path/to/desktop-workspace.db ".backup '/path/to/consistent-backup.sqlite'"
sqlite3 /path/to/consistent-backup.sqlite 'PRAGMA journal_mode=DELETE; PRAGMA integrity_check;'
```

The first command must read the original database where its WAL is present, or an already consistent application backup. The second operates on the backup, not your live workspace. Its integrity result should be `ok`. Changing journal mode on a file already copied without its required WAL cannot recover missing transactions. Backups with supported application schemas 3 through 9 are migrated on the staged connection; future schemas are rejected without replacing the workspace. [SQLite's WAL documentation](https://sqlite.org/wal.html) and [online backup API](https://sqlite.org/backup.html) explain these constraints.

## Browser storage failures

Data belongs to this browser profile and exact origin. A different port, hostname, preview URL, private profile, or browser has a separate workspace. Transfer it using export/import. Clearing site data deletes the workspace. Private browsing storage usually disappears when the session closes.

Persistent-storage requests report the browser's actual decision and usage/quota estimates when supported. A grant protects against automatic eviction under storage pressure; it does not prevent deliberate deletion or device loss. Keep exports even when storage is persistent. Quota failures leave the prior snapshot intact: export a backup, free disk space or allow site storage, and retry.

Initialization errors show recovery controls. Export the preserved bytes before attempting a reviewed valid replacement, or reload after updating the application. Unsupported/corrupt databases are never silently erased or reseeded. IndexedDB version upgrades close older writers; if an old tab blocks an upgrade, close it and reload. An application update waits until all tabs close before replacing the offline shell, preserving active editors.
