# Style Guide

Code conventions for TickClone. All rules are enforced by tooling; CI fails on violations.

See also: [CONTRIBUTING.md](./CONTRIBUTING.md) for PR process, [ARCHITECTURE.md](./ARCHITECTURE.md) for project structure.

---

## Formatting & Tooling

| Language | Formatter | Config Location | Command |
|---|---|---|---|
| TypeScript / Svelte | Prettier 3.x | `.prettierrc` in `client/` | `npx prettier --write .` |
| Rust | rustfmt | `rustfmt.toml` in `client/src-tauri/` | `cargo fmt` |
| Go | gofmt + goimports | (built-in) | `gofmt -w . && goimports -w .` |

### Pre-commit Hooks

- Use `husky` (configured in `client/package.json`) and a root-level pre-commit script
- Hooks run: `prettier --check`, `cargo fmt --check`, `gofmt -l`, `tsc --noEmit`
- CI runs identical checks; merge is blocked on failure

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
| Go exported functions / types | PascalCase | `CreateList`, `SyncPushPayload` |
| Go unexported functions / vars | camelCase | `parseRRule`, `defaultUser` |
| Go files | snake_case | `list_handler.go`, `auth_service.go` |
| SQL tables | snake_case, plural | `tasks`, `task_tags`, `sync_log` |
| SQL columns | snake_case | `created_at`, `parent_task_id` |
| CSS custom properties | kebab-case with `--` prefix | `--color-bg-primary`, `--radius-md` |
| Tailwind classes | per Tailwind convention | `text-sm`, `bg-surface-0` |
| REST endpoints | kebab-case, plural nouns | `/api/v1/tasks`, `/api/v1/magic-links` |
| Environment variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `AUTH_REQUIRED` |

---

## File Organization

- One component per file (Svelte)
- One struct per file when it has associated methods (Rust, Go); small related types can share a file
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

**Go:**
```go
import (
    "context"
    "fmt"

    "github.com/labstack/echo/v4"
    "github.com/jackc/pgx/v5/pgxpool"

    "cross-2/internal/models"
)
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

### Go (Server)

- Wrap errors with context: `fmt.Errorf("create list: %w", err)`
- Structured logging with `slog`:
  ```go
  slog.Error("failed to create list", "error", err, "userID", userID)
  ```
- HTTP errors return the standard error envelope (see [API_CONVENTIONS.md](./API_CONVENTIONS.md))
- Never expose internal error details to the client in production

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
- Go: doc comments on all exported functions — `// FunctionName does X.`
- Rust: doc comments on all `pub` items — `/// Does X.`
- TypeScript: JSDoc only on exported functions in `services/` and `stores/`
- No `TODO` comments in committed code — track in issues instead

---

## Logging

| Layer | Library | Format | Output |
|---|---|---|---|
| Go server | `slog` | JSON | stdout |
| Rust / Tauri | `tracing` + `tracing-subscriber` | JSON (release), pretty (dev) | stdout / file |
| TypeScript | `console.*` (dev only) | browser console | devtools |

Rules:
- All logs include: timestamp, level, message, structured fields
- No PII in logs (no emails, no tokens, no passwords)
- Use log levels consistently: `error` (action failed), `warn` (degraded but continuing), `info` (key events), `debug` (dev only)
