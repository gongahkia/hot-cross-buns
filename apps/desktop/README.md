# Desktop App

This is the Tauri desktop client for TickClone.

## What Lives Here

- `src/`: Svelte UI, stores, and route entrypoints
- `src-tauri/`: Rust command handlers, SQLite setup, sync client, and app bootstrap
- `tests/`: frontend test scaffolding

## Commands

Install dependencies:

```bash
npm ci
```

Run the desktop app:

```bash
npm run tauri dev
```

Frontend checks:

```bash
npm run check
npm test
```

Rust checks:

```bash
cd src-tauri
cargo test
```

## Notes

- The desktop app is designed to be useful without the sync server.
- Local data is stored in SQLite through the Tauri layer.
- Sync settings are persisted locally and reused for manual sync and auto-sync while the app is open.
