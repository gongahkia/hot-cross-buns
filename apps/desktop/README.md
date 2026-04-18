# Desktop App

This is the deprecated Tauri desktop client for Hot Cross Buns.

It remains in the repo as reference material for product behavior while the project moves toward a greenfield SwiftUI app backed by Google Tasks and Google Calendar.

## What Lives Here

- `src/`: Svelte UI, stores, and route entrypoints
- `src-tauri/`: Rust command handlers, SQLite setup, legacy sync client, and app bootstrap
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

- This app is deprecated and should not be used as the foundation for the Apple-native rebuild.
- The old Go sync server has been removed from the repo.
- The local SQLite and sync code are useful as behavior references, not as the new canonical schema.
