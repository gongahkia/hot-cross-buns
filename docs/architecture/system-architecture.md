# System Architecture

Hot Cross Buns is a native Qt desktop client for Google Calendar and Google Tasks.

```text
Qt Quick views
  -> AppController (Qt GUI thread)
  -> C++ domain/read/mutation services
      -> SQLite cache, settings, pending mutations
      -> Google OAuth, Calendar, Tasks, Drive clients
      -> platform adapters: credential store, tray, notifications, deep links
```

Google Calendar and Google Tasks are the remote sources of truth. SQLite is a local cache and offline mutation journal. Task-backed notes are ordinary Google Tasks without a due date, projected as notes by the local UI setting; HCB recurrence metadata is an explicit marker in the Google Task notes field.

## Responsibilities

- Qt Quick: input, view state, accessible controls, and model presentation. It does not access SQLite, tokens, or network clients directly.
- `AppController`: validates UI requests, coordinates services, and applies completed results on the GUI thread.
- domain services: validate inputs, run queued SQLite work, create optimistic mutations, and preserve conflict metadata.
- Google clients: bounded HTTP with timeout/cancellation, OAuth bearer credentials, pagination, incremental sync tokens, and API-specific batching.
- platform adapters: macOS Keychain and `UNUserNotificationCenter`; Fedora KDE Secret Service, D-Bus notifications, reminder daemon, tray, and desktop deep links. Windows parity is deferred.

## Data Flow

Reads use local C++ services and QAbstractItemModels. Writes commit local optimistic state plus a pending mutation, then Google sync pushes it with retries and conflict handling. Pulls reconcile remote changes into the cache. Calendar recurrence lines are round-tripped unchanged and instances are resolved by Google’s instances API, then cached locally.

No Electron, React, preload, or IPC layer is part of the current product architecture.
