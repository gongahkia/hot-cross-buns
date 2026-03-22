# Contributing

How to contribute to TickClone. Read this before opening a PR.

See also: [STYLE_GUIDE.md](./STYLE_GUIDE.md) for code conventions, [ARCHITECTURE.md](./ARCHITECTURE.md) for project structure.

---

## Prerequisites

- Node.js 20+
- Rust (stable toolchain via rustup)
- Go 1.22+
- Docker & Docker Compose
- Linux system deps for Tauri:
  ```bash
  sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev
  ```

---

## Quick Start

```bash
# 1. Clone
git clone <repo-url> && cd cross-2

# 2. Environment
cp .env.example .env

# 3. Start PostgreSQL
docker compose up -d db

# 4. Start sync server
cd server && go run ./cmd/server

# 5. Start desktop app (separate terminal)
cd client && npm install && npm run tauri dev
```

---

## Git Workflow

**Trunk-based development:**
- `main` is the only long-lived branch
- Feature branches are short-lived, branched from `main`
- All changes go through PRs; direct pushes to `main` are blocked
- PRs are squash-merged (one commit per PR)

**Branch naming:**

```
<type>/<short-description>
```

| Prefix | When |
|---|---|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `refactor/` | Code restructuring |
| `test/` | Adding or updating tests |
| `docs/` | Documentation |
| `chore/` | Build, CI, dependencies |

Examples: `feat/task-crud-commands`, `fix/sync-conflict-resolution`, `docs/api-conventions`

---

## Commit Conventions

[Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

| Type | When |
|---|---|
| `feat` | New feature or capability |
| `fix` | Bug fix |
| `refactor` | Code change (no new feature, no bug fix) |
| `test` | Adding or updating tests |
| `docs` | Documentation only |
| `chore` | Build, CI, dependency updates |
| `style` | Formatting (no logic change) |
| `perf` | Performance improvement |

**Scopes:** `client`, `server`, `sync`, `ui`, `db`, `ci`, `schema`

**Rules:**
- Subject line max 72 characters
- Imperative mood ("add" not "added")
- No period at end of subject
- Body wraps at 80 characters

**Examples:**
```
feat(client): add task CRUD Tauri commands
fix(server): handle null due_date in task creation
test(sync): add two-client conflict resolution test
docs(api): document error response format
```

---

## PR Process

1. Create a feature branch from `main`
2. Make changes, commit with conventional commits
3. Push branch, open PR against `main`
4. PR title follows conventional commit format
5. PR description uses the template below
6. CI must pass (format checks, lint, tests)
7. Squash-merge into `main`
8. Delete the feature branch after merge

### PR Template

```markdown
## What
<1-2 sentence summary of the change>

## Why
<motivation / context / issue link>

## How to test
<steps to verify the change works>

## Checklist
- [ ] Follows STYLE_GUIDE.md conventions
- [ ] Tests added or updated
- [ ] No format violations (prettier, gofmt, cargo fmt)
- [ ] No hardcoded colors (uses CSS variables)
- [ ] API changes follow API_CONVENTIONS.md
```

---

## Testing

**Philosophy:** Test-after — write implementation first, then add tests for critical paths and edge cases. Target ~70-80% coverage on business logic (stores, services, repositories). Don't test trivial getters.

**Priority:** Correctness > UX > Speed

| Scope | Framework | Command |
|---|---|---|
| Go server (unit + integration) | `go test` + testcontainers | `cd server && go test ./... -v` |
| Rust / Tauri | `cargo test` | `cd client/src-tauri && cargo test` |
| Svelte components + stores | Vitest + Testing Library | `cd client && npm run test` |
| E2E (critical user flows) | Playwright | `cd client && npm run test:e2e` |

**What to test:**
- All Tauri IPC commands (CRUD, sync, recurrence)
- Store logic (derived state, undo stack, filter combinations)
- Sync conflict resolution (concurrent edits, offline queue)
- API handlers (happy path, validation errors, auth)
- E2E: create task, complete task, drag reorder, sync cycle

**What NOT to test:**
- Trivial getters/setters
- Svelte template rendering (test behavior, not markup)
- Third-party library internals

---

## Environment Variables

`.env.example` is committed with documented placeholders. `.env` is gitignored.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `MAGIC_LINK_SECRET` | Yes | — | JWT signing key (32+ chars) |
| `PORT` | No | `8080` | Server HTTP port |
| `AUTH_REQUIRED` | No | `true` | Set `false` for local-only mode |
| `SMTP_HOST` | No | — | Email server for magic links |
| `SMTP_PORT` | No | `587` | Email server port |
| `SMTP_USER` | No | — | Email auth username |
| `SMTP_PASS` | No | — | Email auth password |
| `SMTP_FROM` | No | — | Sender email address |
| `CORS_ORIGINS` | No | `*` | Allowed CORS origins |

Never commit secrets. If you add a new env var, add it to `.env.example` with a placeholder value.

---

## Code Review Checklist

- [ ] Follows naming conventions per [STYLE_GUIDE.md](./STYLE_GUIDE.md)
- [ ] No hardcoded colors — uses CSS custom properties (see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md))
- [ ] API changes follow [API_CONVENTIONS.md](./API_CONVENTIONS.md)
- [ ] Error messages are user-friendly (no internal jargon in UI)
- [ ] No PII in logs (no emails, tokens, passwords)
- [ ] New env vars documented in `.env.example`
- [ ] Destructive operations (delete, purge) have confirmation UX
