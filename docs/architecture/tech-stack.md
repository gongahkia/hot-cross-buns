# Tech Stack ADR

## Decision

Hot Cross Buns uses C++20, Qt 6/QML, CMake, and SQLite. The production macOS app is a Qt bundle; QML consumes C++ QAbstractItemModels and invokes a narrow `AppController` surface.

Google Calendar, Google Tasks, and Google Drive metadata are accessed through bounded native HTTP clients. OAuth uses a user-supplied Google Desktop OAuth client ID with PKCE loopback authorization. Credentials use platform adapters and never SQLite.

## Rationale

- Qt gives native desktop lifecycle, accessibility, QML views, notifications, and cross-platform portability without a web runtime.
- C++ domain services keep local search, range layout, mutation validation, batching, and SQLite work close to their data.
- SQLite provides a durable cache, offline queue, checkpoints, settings, FTS, and diagnostics without making HCB a second cloud backend.
- Google APIs remain authoritative for synced resources; undated Google Tasks can optionally be projected as HCB notes.

## Non-Decisions

Linux and Windows packaging/runtime parity are deferred until macOS release validation passes. Electron, React, TypeScript, Vite, Tailwind, preload APIs, and Node SQLite bindings are retired architecture, not supported dependencies.
