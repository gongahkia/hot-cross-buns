# Style Guide

Code conventions for Hot Cross Buns.

See also: [CONTRIBUTING.md](./CONTRIBUTING.md) for PR process, [ARCHITECTURE.md](./ARCHITECTURE.md) for project structure.

---

## Formatting & Tooling

| Language | Formatter | Config Location | Command |
|---|---|---|---|
| Swift | Xcode / swift-format once configured | `apps/apple/` | `swift-format` or Xcode Format |
| TypeScript / Svelte legacy | Prettier 3.x | `apps/desktop/` | `npm run format` once configured |
| Rust legacy | rustfmt | `apps/desktop/src-tauri/` | `cargo fmt` |

### Pre-commit Hooks

- Add hooks after `apps/apple` exists.
- Swift checks should cover formatting, build, and unit tests.
- Legacy Tauri checks are optional while the app is deprecated.

### Prettier Config

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all",
  "tabWidth": 2,
  "semi": true,
  "svelteStrictMode": true,
  "plugins": ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"]
}
```

### rustfmt.toml

```toml
edition = "2021"
max_width = 100
use_field_init_shorthand = true
```

---

## Naming Conventions

| Context | Convention | Example |
|---|---|---|
| TS variables / functions | camelCase | `selectedListId`, `loadTasks()` |
| TS types / interfaces | PascalCase | `Task`, `SyncPullResponse` |
| TS constants | UPPER_SNAKE_CASE | `MAX_SUBTASK_DEPTH` |
| Svelte components | PascalCase filename | `TaskList.svelte`, `SyncSettings.svelte` |
| Svelte stores | camelCase | `lists`, `selectedTaskId` |
| Rust functions / variables | snake_case | `create_task`, `db_path` |
| Rust types / structs | PascalCase | `AppState`, `TaskUpdatePayload` |
| Rust constants | UPPER_SNAKE_CASE | `MAX_BATCH_SIZE` |
| Swift types | PascalCase | `TaskSyncService`, `CalendarEventMirror` |
| Swift values / functions | lowerCamelCase | `selectedCalendarID`, `syncNow()` |
| Swift enum cases | lowerCamelCase | `nearRealtime` |
| Swift files | PascalCase by primary type | `TaskSyncService.swift` |
| SQL tables | snake_case, plural | `tasks`, `task_tags`, `sync_log` |
| SQL columns | snake_case | `created_at`, `parent_task_id` |
| CSS custom properties | kebab-case with `--` prefix | `--color-bg-primary`, `--radius-md` |
| Tailwind classes | per Tailwind convention | `text-sm`, `bg-surface-0` |
| Google resource IDs | preserve upstream casing | `taskListID`, `calendarID` |

---

## File Organization

- One SwiftUI screen or component per file when practical.
- Keep Google API adapters, sync scheduling, persistence, and UI in separate modules.
- One component per file in legacy Svelte.
- One struct per file when it has associated methods in legacy Rust; small related types can share a file.
- Group imports in all languages: **stdlib → external → internal**, separated by blank lines

**TypeScript:**
```typescript
// Side-effect imports
import './app.css';

// External packages
import { onMount } from 'svelte';
import { invoke } from '@tauri-apps/api/core';

// Internal ($lib aliases)
import { lists } from '$lib/stores/lists';

// Relative
import TaskRow from './TaskRow.svelte';
```

**Rust:**
```rust
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::State;

use crate::models::Task;
use crate::error::AppError;
```

---

## Error Handling

### Swift

- Define domain-specific error types for auth, Google API, cache, and sync failures.
- Preserve underlying errors for diagnostics, but show human-readable messages in UI.
- Use explicit loading, empty, error, and offline states in SwiftUI.
- Never log OAuth access tokens, refresh tokens, authorization codes, or full event/task descriptions.

### Rust (Tauri)

- Define custom error types with `thiserror` in `src-tauri/src/error.rs`
- Tauri commands return `Result<T, String>` where String is a human-readable message
- Log with `tracing`:
  ```rust
  tracing::error!(?err, user_id, "failed to create task");
  ```

### TypeScript (Svelte)

- Wrap all `invoke()` calls in try/catch
- User-facing errors shown as toast notifications (human-readable, no stack traces)
- Console errors include full context for debugging:
  ```typescript
  try {
    await invoke('create_task', { payload });
  } catch (err) {
    console.error('Failed to create task:', err);
    showToast('Could not create task. Please try again.');
  }
  ```

---

## Comments & Documentation

- Code should be self-documenting; avoid redundant comments
- Add `WHY:` comments for non-obvious decisions (matches PRD style)
- Swift: document public types and non-obvious sync behavior.
- Rust: doc comments on all `pub` items — `/// Does X.`
- TypeScript: JSDoc only on exported functions in `services/` and `stores/`
- No `TODO` comments in committed code — track in issues instead

---

## Logging

| Layer | Library | Format | Output |
|---|---|---|---|
| Swift app | `Logger` / `OSLog` | structured | Console.app / unified logging |
| Rust / Tauri | `tracing` + `tracing-subscriber` | JSON (release), pretty (dev) | stdout / file |
| TypeScript | `console.*` (dev only) | browser console | devtools |

Rules:
- All logs include: timestamp, level, message, structured fields
- No PII in logs (no emails, no tokens, no passwords)
- Use log levels consistently: `error` (action failed), `warn` (degraded but continuing), `info` (key events), `debug` (dev only)
