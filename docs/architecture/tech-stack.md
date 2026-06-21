# Tech Stack ADR

## Decision

Hot Cross Buns will use an Electron-first desktop stack:

- Electron for the app shell, native desktop lifecycle, tray, menu, global shortcuts, notifications, deep links, and packaging.
- React + TypeScript for renderer UI.
- Vite for renderer development and production builds.
- Tailwind CSS with Hot Cross Buns design tokens for fast, consistent UI work.
- SQLite for local cache, settings, sync checkpoints, offline mutation queue, diagnostics, and task-backed note mirrors.
- Node service modules in Electron main or dedicated workers for Google sync, local data, MCP, and native integration.

The first implementation milestone targets macOS only. The architecture must not block Windows or Linux support.

## Rationale

The rebuild is motivated by Swift build and debugging friction. The replacement stack should optimize for ordinary edit-debug loops, inspectable UI state, easy agent contributions, and broad ecosystem support. Electron is heavier than native Swift or Tauri, but it gives the most direct path to:

- Chromium DevTools for UI, network, storage, and performance debugging.
- A mature Node and TypeScript ecosystem for OAuth, Google APIs, SQLite, MCP, logging, and tests.
- Playwright Electron automation for launch and user-flow smoke tests.
- First-class desktop APIs for tray, menus, global shortcuts, notifications, and deep links.
- Predictable rendering behavior across desktop platforms because Chromium is bundled.

Vite is the default renderer build tool because it gives a fast dev server, HMR, TypeScript support, and simple React integration.

## Alternatives Considered

### Tauri v2

Tauri remains the strongest alternative. It is smaller at runtime, has a Rust backend, supports tray/global shortcut/updater plugins, and uses the OS webview instead of bundling Chromium.

Rejected as the default because Hot Cross Buns is optimizing for debuggability and agent velocity over binary size. Tauri also introduces Rust ownership and plugin-boundary complexity. It is a better fit if runtime footprint becomes a hard product constraint.

Reference docs:

- https://v2.tauri.app/concept/architecture/
- https://v2.tauri.app/learn/system-tray/
- https://v2.tauri.app/plugin/updater/

### Wails

Wails v2 is credible for a Go-backed webview app, and Go would compile quickly. It is not the default because the stable v2 ecosystem is less aligned with this app's native desktop surface than Electron, while Wails v3 is still too early to anchor this rebuild.

Reference docs:

- https://wails.io/docs/next/introduction/
- https://v3.wails.io/status/

### Flutter, Qt, Avalonia, React Native macOS, Neutralino

These are not the default because they either introduce a new UI language/runtime, move away from the existing CSS/token assets, add licensing or platform-specific UI concerns, or provide a weaker fit for local Node/TypeScript agent workflows.

## Required Baseline Libraries

Use these unless a later ADR replaces them:

- UI: `react`, `react-dom`, `typescript`, `vite`, `tailwindcss`
- Icons: `lucide-react`
- Accessible primitives: Radix UI packages as needed
- Server/cache state: `@tanstack/react-query`
- Local UI state: Zustand or Jotai; choose one before app scaffold, do not mix both
- Long lists: `@tanstack/react-virtual`
- Validation: `zod`
- Dates: `date-fns` or `luxon`; choose one before app scaffold
- Testing: `vitest`, React Testing Library, Playwright Electron
- Google: `googleapis` / `google-auth-library`
- Secrets: `keytar` or a maintained native keychain wrapper
- SQLite: `better-sqlite3` by default, isolated behind a repository/service layer

## Hard Boundaries

- Renderer code must not access Node globals, filesystem, Google credentials, SQLite, or tokens directly.
- All renderer-to-main calls go through a preload API with typed request and response schemas.
- Main/worker services own local data, Google sync, MCP, tray, shortcuts, notifications, updater, and native integrations.
- Native module choices must be hidden behind adapters so packaging failures can be isolated.

## Follow-Up Decisions Before Scaffold

- Package manager: default to `pnpm` unless the repo owner chooses otherwise.
- UI state library: choose Zustand or Jotai.
- Date library: choose `date-fns` or `luxon`.
- SQLite encryption strategy: decide whether v1 needs SQLCipher or file-level encryption; until then, tokens still never live in SQLite.
