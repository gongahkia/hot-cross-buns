# Native Parity Spec

## Scope

This document tracks native behavior from the Swift app that is not part of the first Hot Cross Buns 2 core milestone. These features are documented now so the initial architecture does not block them.

## Included In Core V1

Mac core v1 includes:

- app window lifecycle
- app menu
- tray/menu bar icon
- global quick capture hotkey
- basic local notifications
- custom protocol deep links
- Keychain-backed tokens

## Deferred Native Parity

### Spotlight Indexing

Goal: let users find tasks, events, and notes from system search.

Deferred because Electron does not provide this as a direct cross-platform primitive. Implementation likely needs a macOS helper or native module.

Required future behavior:

- index sanitized task/event/note titles and metadata
- deep link results back into the app
- remove deleted or disconnected-account records
- respect user opt-out

### App Intents And App Shortcuts

Goal: expose quick actions to system automation surfaces.

Deferred because this is macOS-specific and likely requires native helper code.

Potential actions:

- open Today
- create task
- create event
- quick capture

### Share Extension

Goal: create tasks or notes from text, URLs, and webpages shared from other apps.

Deferred because it requires a native macOS extension target or helper package.

Future implementation must define:

- accepted content types
- handoff format into Electron app
- behavior when main app is not running
- privacy handling for shared webpage content

### Rich Notification Actions

Goal: snooze, complete, open, or dismiss from notification actions.

Deferred until basic notification scheduling is stable.

Future implementation must route actions through the same domain services as UI and MCP writes.

### Background Refresh

Goal: refresh opportunistically when the app is not foregrounded.

Deferred until foreground sync is correct. Google push remains out of v1 because Calendar webhooks require an HTTPS receiver and Tasks does not provide the same simple public push model.

## Native Helper Policy

Native helpers are allowed only when:

- Electron cannot provide the feature safely.
- The helper has a narrow API.
- The helper is covered by tests or a manual verification checklist.
- The helper does not bypass the main service permission model.
- The helper is optional where the platform does not support the feature.

## Acceptance Criteria For Adding A Deferred Feature

- Feature has a small ADR or spec update.
- Platform support and fallback behavior are documented.
- Renderer still talks only through preload APIs.
- Sensitive data stays out of helper logs and IPC payloads.
- Feature has at least one automated test or documented manual smoke test.

