# Hot Cross Buns — Agent Quick Start

Hot Cross Buns is an Electron desktop planner for Google Tasks and Google Calendar. It is a single desktop application, not a hosted web service.

## Start here

1. Read this file.
2. Open the [current architecture diagram](docs/assets/hot-cross-buns-architecture.png) and its [YAML source](docs/architecture/hot-cross-buns-architecture.yaml).
3. Read the owning subsystem documentation before changing behavior. The documentation map is in [docs/README.md](docs/README.md).
4. Use [docs/agents/workflow.md](docs/agents/workflow.md) for the full engineering and safety checklist.

## Commands

```sh
corepack enable
corepack pnpm install
corepack pnpm dev
corepack pnpm build
corepack pnpm test:unit
corepack pnpm test:db
```

The build runs architecture-artifact validation before type checking and bundling.

```sh
corepack pnpm architecture:generate  # regenerate the diagrams-as-code PNG
corepack pnpm architecture:check     # verify generated files are current
```

## Runtime map

```text
React renderer
  → hardened preload (`window.hcb`)
  → validated Electron IPC
  → CoreStore / Google OAuth / GoogleSync services
  → SQLite cache + encrypted OS credential storage
  → direct Google OAuth, Calendar, Tasks, optional Drive/Gmail APIs
```

Key locations:

- `src/renderer/` — React UI and view models.
- `src/preload/` — the narrow, typed renderer-to-main bridge.
- `src/main/ipc/` — request allow-list and runtime validation.
- `src/main/services/` — CoreStore, OAuth, sync, and persistence behavior.
- `src/main/index.ts` — Electron lifecycle, service setup, and background sync.
- `docs/architecture/` — current architecture model, diagram, and maintenance workflow.

## Non-negotiable boundaries

- Keep the renderer unprivileged: no Node, filesystem, SQLite, OAuth credentials, or direct Google calls.
- Add renderer capabilities through preload plus validated IPC only.
- Keep synced Google Tasks and Calendar data authoritative. SQLite is the local cache, settings/checkpoints store, and durable outbox.
- OAuth secrets and tokens stay in Electron `safeStorage`; never place them in renderer state, SQLite, logs, fixtures, or documentation.
- HCB currently has no HCB cloud backend, supported Vault/hoster endpoint, or enabled local MCP listener. Do not imply one in code or docs.
- Drive is metadata-only and Gmail is read-only metadata/snippet capture, each after explicit authorization.

## When changing architecture

Update [docs/architecture/hot-cross-buns-architecture.yaml](docs/architecture/hot-cross-buns-architecture.yaml) whenever a change affects renderer/preload/IPC boundaries, privileged services, local persistence, credentials, sync/OAuth, or external integrations. Then run `corepack pnpm architecture:generate` and commit the YAML source and generated PNG together.

CI requires that review for architecture-sensitive main-process, IPC, preload, OAuth, CoreStore, and sync changes. Details: [diagram workflow](docs/architecture/diagram-workflow.md).

## Google and live testing safety

- Do not ask for, paste, log, or export Google passwords, OAuth secrets, access tokens, refresh tokens, cookies, or Keychain data.
- Never run live Google mutations by default. Read [docs/live-google-testing.md](docs/live-google-testing.md) first; mutations require a designated disposable account and resources.
- Use the mocked Google transport tests for normal development.

## Before handing off

- Run the narrowest relevant tests, plus `corepack pnpm build` for cross-cutting changes.
- Update user-facing docs and the architecture model when contracts or boundaries changed.
- Report known limitations and any tests not run.
